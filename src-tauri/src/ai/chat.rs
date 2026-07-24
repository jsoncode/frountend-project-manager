use futures_util::StreamExt;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::store::{load_config, AiModel, AiModelType};

const EVENT_CHAT_CHUNK: &str = "ai://chat-chunk";
const HTTP_TIMEOUT_SECS: u64 = 120;

static CANCEL_FLAGS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageDto {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub request_id: String,
    pub model_id: String,
    pub messages: Vec<ChatMessageDto>,
    pub stream: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatChunkEvent {
    pub request_id: String,
    pub delta: Option<String>,
    pub reasoning_delta: Option<String>,
    pub done: bool,
    pub error: Option<String>,
}

fn chat_completions_url(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    if b.ends_with("/chat/completions") {
        return b.to_string();
    }
    if b.ends_with("/v1") {
        return format!("{b}/chat/completions");
    }
    format!("{b}/v1/chat/completions")
}

fn emit_chunk(app: &AppHandle, event: ChatChunkEvent) {
    let _ = app.emit(EVENT_CHAT_CHUNK, event);
}

fn emit_error_done(app: &AppHandle, request_id: &str, error: String) {
    emit_chunk(
        app,
        ChatChunkEvent {
            request_id: request_id.to_string(),
            delta: None,
            reasoning_delta: None,
            done: true,
            error: Some(error),
        },
    );
}

fn emit_done(app: &AppHandle, request_id: &str) {
    emit_chunk(
        app,
        ChatChunkEvent {
            request_id: request_id.to_string(),
            delta: None,
            reasoning_delta: None,
            done: true,
            error: None,
        },
    );
}

fn resolve_model(app: &AppHandle, model_id: &str) -> Result<AiModel, String> {
    let cfg = load_config(app)?;
    let model = cfg
        .models
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("model not found: {model_id}"))?;
    match model.model_type {
        AiModelType::Text | AiModelType::Multimodal => Ok(model),
        AiModelType::Image | AiModelType::Audio | AiModelType::Video => {
            Err("model type is not supported for chat (need text or multimodal)".into())
        }
    }
}

fn insert_cancel_flag(request_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    CANCEL_FLAGS
        .lock()
        .insert(request_id.to_string(), flag.clone());
    flag
}

fn remove_cancel_flag(request_id: &str) {
    CANCEL_FLAGS.lock().remove(request_id);
}

/// Mark a running chat request as cancelled. No-op if the id is unknown.
pub fn cancel_chat(request_id: &str) -> Result<(), String> {
    if let Some(flag) = CANCEL_FLAGS.lock().get(request_id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

fn build_messages_json(messages: &[ChatMessageDto]) -> Vec<Value> {
    messages
        .iter()
        .map(|m| {
            serde_json::json!({
                "role": m.role,
                "content": m.content,
            })
        })
        .collect()
}

fn extract_reasoning(obj: &Value) -> Option<String> {
    obj.get("reasoning_content")
        .or_else(|| obj.get("reasoning"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

async fn run_non_stream(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    token: &str,
    model_name: &str,
    messages: &[ChatMessageDto],
    request_id: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        emit_done(app, request_id);
        return Ok(());
    }

    let body = serde_json::json!({
        "model": model_name,
        "messages": build_messages_json(messages),
        "stream": false,
    });

    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if cancel.load(Ordering::SeqCst) {
        emit_done(app, request_id);
        return Ok(());
    }

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {status}: {text}"));
    }

    let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let message = json
        .pointer("/choices/0/message")
        .ok_or_else(|| "missing choices[0].message".to_string())?;

    let content = message
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let reasoning = extract_reasoning(message);

    if !content.is_empty() || reasoning.is_some() {
        emit_chunk(
            app,
            ChatChunkEvent {
                request_id: request_id.to_string(),
                delta: if content.is_empty() {
                    None
                } else {
                    Some(content)
                },
                reasoning_delta: reasoning,
                done: false,
                error: None,
            },
        );
    }

    emit_done(app, request_id);
    Ok(())
}

async fn run_stream(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    token: &str,
    model_name: &str,
    messages: &[ChatMessageDto],
    request_id: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let body = serde_json::json!({
        "model": model_name,
        "messages": build_messages_json(messages),
        "stream": true,
    });

    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let bytes = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buffer.find('\n') {
            let mut line = buffer[..pos].to_string();
            buffer.drain(..=pos);
            if line.ends_with('\r') {
                line.pop();
            }
            let line = line.trim();
            if line.is_empty() || !line.starts_with("data:") {
                continue;
            }
            let data = line["data:".len()..].trim();
            if data == "[DONE]" {
                emit_done(app, request_id);
                return Ok(());
            }
            let Ok(json) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            let Some(delta) = json.pointer("/choices/0/delta") else {
                continue;
            };
            let content = delta
                .get("content")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let reasoning = extract_reasoning(delta);
            if content.is_none() && reasoning.is_none() {
                continue;
            }
            emit_chunk(
                app,
                ChatChunkEvent {
                    request_id: request_id.to_string(),
                    delta: content,
                    reasoning_delta: reasoning,
                    done: false,
                    error: None,
                },
            );
        }
    }

    // Cancelled or connection closed without [DONE]
    emit_done(app, request_id);
    Ok(())
}

/// Validate model, spawn the HTTP request, and return immediately.
pub fn start_chat(app: AppHandle, req: ChatRequest) -> Result<(), String> {
    let model = resolve_model(&app, &req.model_id)?;
    let url = chat_completions_url(&model.base_url);
    let token = model.token.clone();
    let model_name = model.model_name.clone();
    let cancel = insert_cancel_flag(&req.request_id);
    let request_id = req.request_id.clone();
    let stream = req.stream;
    let messages = req.messages;

    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                emit_error_done(&app, &request_id, e.to_string());
                remove_cancel_flag(&request_id);
                return;
            }
        };

        let result = if stream {
            run_stream(
                &app,
                &client,
                &url,
                &token,
                &model_name,
                &messages,
                &request_id,
                &cancel,
            )
            .await
        } else {
            run_non_stream(
                &app,
                &client,
                &url,
                &token,
                &model_name,
                &messages,
                &request_id,
                &cancel,
            )
            .await
        };

        if let Err(e) = result {
            emit_error_done(&app, &request_id, e);
        }
        remove_cancel_flag(&request_id);
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::chat_completions_url;

    #[test]
    fn url_already_complete() {
        assert_eq!(
            chat_completions_url("https://api.example.com/v1/chat/completions"),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn url_ends_with_v1() {
        assert_eq!(
            chat_completions_url("https://api.example.com/v1/"),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn url_bare_base() {
        assert_eq!(
            chat_completions_url("https://api.example.com"),
            "https://api.example.com/v1/chat/completions"
        );
    }
}
