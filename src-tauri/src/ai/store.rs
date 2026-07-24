use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

static AI_CONFIG_IO: Mutex<()> = Mutex::new(());
static AI_CHATS_IO: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AiModelType {
    Text,
    Image,
    Audio,
    Video,
    Multimodal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    pub id: String,
    pub remark: String,
    pub base_url: String,
    pub model_name: String,
    pub token: String,
    #[serde(rename = "type")]
    pub model_type: AiModelType,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub models: Vec<AiModel>,
    pub last_model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversation {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AiMessageRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AiAttachmentKind {
    TerminalSelection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAttachment {
    pub kind: AiAttachmentKind,
    pub text: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: AiMessageRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<AiAttachment>>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiChats {
    pub conversations: Vec<AiConversation>,
    pub messages: HashMap<String, Vec<AiMessage>>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn ai_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(ai_dir(app)?.join("ai-config.json"))
}

fn chats_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(ai_dir(app)?.join("ai-chats.json"))
}

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

fn read_json_or_default<T: for<'de> Deserialize<'de> + Default>(path: &PathBuf) -> Result<T, String> {
    if !path.exists() {
        return Ok(T::default());
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(T::default());
    }
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn load_config(app: &AppHandle) -> Result<AiConfig, String> {
    let _guard = AI_CONFIG_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    read_json_or_default(&config_path(app)?)
}

pub fn save_config(app: &AppHandle, cfg: &AiConfig) -> Result<AiConfig, String> {
    let _guard = AI_CONFIG_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    write_json(&config_path(app)?, cfg)?;
    Ok(cfg.clone())
}

pub fn load_chats(app: &AppHandle) -> Result<AiChats, String> {
    let _guard = AI_CHATS_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    read_json_or_default(&chats_path(app)?)
}

pub fn save_chats(app: &AppHandle, chats: &AiChats) -> Result<(), String> {
    let _guard = AI_CHATS_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    write_json(&chats_path(app)?, chats)
}

/// Store helper for model upsert; models are usually saved via `save_config` wholesale.
#[allow(dead_code)]
pub fn upsert_model(app: &AppHandle, model: AiModel) -> Result<AiConfig, String> {
    let mut cfg = load_config(app)?;
    if let Some(existing) = cfg.models.iter_mut().find(|m| m.id == model.id) {
        *existing = model;
    } else {
        cfg.models.push(model);
    }
    save_config(app, &cfg)
}

/// Store helper for model delete; models are usually saved via `save_config` wholesale.
#[allow(dead_code)]
pub fn delete_model(app: &AppHandle, id: &str) -> Result<AiConfig, String> {
    let mut cfg = load_config(app)?;
    cfg.models.retain(|m| m.id != id);
    if cfg.last_model_id.as_deref() == Some(id) {
        cfg.last_model_id = None;
    }
    save_config(app, &cfg)
}

/// Store helper to toggle model active flag.
#[allow(dead_code)]
pub fn set_model_active(app: &AppHandle, id: &str, active: bool) -> Result<AiConfig, String> {
    let mut cfg = load_config(app)?;
    let Some(model) = cfg.models.iter_mut().find(|m| m.id == id) else {
        return Err(format!("model not found: {id}"));
    };
    model.active = active;
    save_config(app, &cfg)
}

pub fn list_conversations(app: &AppHandle) -> Result<Vec<AiConversation>, String> {
    let mut list = load_chats(app)?.conversations;
    list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(list)
}

pub fn get_messages(app: &AppHandle, conversation_id: &str) -> Result<Vec<AiMessage>, String> {
    let chats = load_chats(app)?;
    Ok(chats
        .messages
        .get(conversation_id)
        .cloned()
        .unwrap_or_default())
}

pub fn create_conversation(
    app: &AppHandle,
    title: Option<String>,
) -> Result<AiConversation, String> {
    let mut chats = load_chats(app)?;
    let now = now_ms();
    let title = title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "新对话".into());
    let conv = AiConversation {
        id: Uuid::new_v4().to_string(),
        title,
        model_id: None,
        created_at: now,
        updated_at: now,
    };
    chats.conversations.push(conv.clone());
    chats.messages.insert(conv.id.clone(), Vec::new());
    save_chats(app, &chats)?;
    Ok(conv)
}

pub fn rename_conversation(
    app: &AppHandle,
    id: &str,
    title: &str,
) -> Result<AiConversation, String> {
    let mut chats = load_chats(app)?;
    let Some(conv) = chats.conversations.iter_mut().find(|c| c.id == id) else {
        return Err(format!("conversation not found: {id}"));
    };
    conv.title = title.trim().to_string();
    conv.updated_at = now_ms();
    let result = conv.clone();
    save_chats(app, &chats)?;
    Ok(result)
}

pub fn delete_conversation(app: &AppHandle, id: &str) -> Result<(), String> {
    let mut chats = load_chats(app)?;
    let before = chats.conversations.len();
    chats.conversations.retain(|c| c.id != id);
    if chats.conversations.len() == before {
        return Err(format!("conversation not found: {id}"));
    }
    chats.messages.remove(id);
    save_chats(app, &chats)
}

pub fn append_message(app: &AppHandle, msg: AiMessage) -> Result<AiMessage, String> {
    let mut chats = load_chats(app)?;
    let Some(conv) = chats
        .conversations
        .iter_mut()
        .find(|c| c.id == msg.conversation_id)
    else {
        return Err(format!("conversation not found: {}", msg.conversation_id));
    };
    conv.updated_at = now_ms();
    chats
        .messages
        .entry(msg.conversation_id.clone())
        .or_default()
        .push(msg.clone());
    save_chats(app, &chats)?;
    Ok(msg)
}
