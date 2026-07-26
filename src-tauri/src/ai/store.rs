use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use uuid::Uuid;

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
    #[serde(default)]
    pub last_conversation_id: Option<String>,
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
pub struct AiMessageStats {
    pub output_tokens: u32,
    pub tokens_per_sec: f64,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_to_first_token_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debug: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stats: Option<AiMessageStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiChats {
    pub conversations: Vec<AiConversation>,
    pub messages: std::collections::HashMap<String, Vec<AiMessage>>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn load_config(_app: &AppHandle) -> Result<AiConfig, String> {
    Ok(crate::db::kv_get_json("ai_config")?.unwrap_or_default())
}

pub fn save_config(_app: &AppHandle, cfg: &AiConfig) -> Result<AiConfig, String> {
    crate::db::kv_set_json("ai_config", cfg)?;
    Ok(cfg.clone())
}

pub fn list_conversations(_app: &AppHandle) -> Result<Vec<AiConversation>, String> {
    crate::db::ai_list_conversations()
}

pub fn get_messages(_app: &AppHandle, conversation_id: &str) -> Result<Vec<AiMessage>, String> {
    crate::db::ai_get_messages(conversation_id)
}

pub fn create_conversation(
    _app: &AppHandle,
    title: Option<String>,
) -> Result<AiConversation, String> {
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
    crate::db::ai_upsert_conversation(&conv)?;
    Ok(conv)
}

pub fn rename_conversation(
    _app: &AppHandle,
    id: &str,
    title: &str,
) -> Result<AiConversation, String> {
    let mut list = crate::db::ai_list_conversations()?;
    let Some(conv) = list.iter_mut().find(|c| c.id == id) else {
        return Err(format!("conversation not found: {id}"));
    };
    conv.title = title.trim().to_string();
    conv.updated_at = now_ms();
    let result = conv.clone();
    crate::db::ai_upsert_conversation(&result)?;
    Ok(result)
}

pub fn delete_conversation(_app: &AppHandle, id: &str) -> Result<(), String> {
    crate::db::ai_delete_conversation(id)
}

pub fn append_message(_app: &AppHandle, msg: AiMessage) -> Result<AiMessage, String> {
    crate::db::ai_append_message(&msg)?;
    Ok(msg)
}

pub fn update_message_content(
    _app: &AppHandle,
    id: &str,
    content: &str,
) -> Result<AiMessage, String> {
    crate::db::ai_update_message_content(id, content)
}

pub fn delete_message(_app: &AppHandle, id: &str) -> Result<Vec<String>, String> {
    crate::db::ai_delete_message(id)
}
