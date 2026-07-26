//! SQLite persistence for FPM — replaces JSON files + layout localStorage.

use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("fpm.db"))
}

const SCHEMA: &str = r#"
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_cache (
  workspace TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  model_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  reasoning TEXT,
  attachments TEXT,
  created_at INTEGER NOT NULL,
  stats TEXT,
  FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, created_at);
"#;

pub fn init(app: &AppHandle) -> Result<(), String> {
    if DB.get().is_some() {
        return Ok(());
    }
    crate::config::migrate_legacy_app_data(app);
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    // Existing installs created ai_messages before `stats` existed.
    let _ = conn.execute("ALTER TABLE ai_messages ADD COLUMN stats TEXT", []);
    migrate_json_into_db(app, &conn)?;
    DB.set(Mutex::new(conn))
        .map_err(|_| "db already initialized".to_string())?;
    Ok(())
}

fn with_conn<T>(f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let Some(cell) = DB.get() else {
        return Err("database not initialized".into());
    };
    let conn = cell.lock();
    f(&conn)
}

pub fn kv_get(key: &str) -> Result<Option<String>, String> {
    with_conn(|conn| {
        conn.query_row(
            "SELECT value FROM kv WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    })
}

pub fn kv_set(key: &str, value: &str) -> Result<(), String> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO kv(key, value, updated_at) VALUES(?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![key, value, now_ms()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn kv_get_json<T: serde::de::DeserializeOwned>(key: &str) -> Result<Option<T>, String> {
    match kv_get(key)? {
        None => Ok(None),
        Some(raw) if raw.trim().is_empty() => Ok(None),
        Some(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| e.to_string()),
    }
}

pub fn kv_set_json<T: serde::Serialize>(key: &str, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string(value).map_err(|e| e.to_string())?;
    kv_set(key, &raw)
}

fn read_file_if_exists(path: &PathBuf) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    fs::read_to_string(path).ok().filter(|s| !s.trim().is_empty())
}

fn migrate_json_into_db(app: &AppHandle, conn: &Connection) -> Result<(), String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;

    let has_app = conn
        .query_row(
            "SELECT 1 FROM kv WHERE key='app_config' LIMIT 1",
            [],
            |_| Ok(1i32),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();

    if !has_app {
        if let Some(raw) = read_file_if_exists(&dir.join("config.json")) {
            conn.execute(
                "INSERT INTO kv(key, value, updated_at) VALUES('app_config', ?1, ?2)",
                params![raw, now_ms()],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let has_ai = conn
        .query_row(
            "SELECT 1 FROM kv WHERE key='ai_config' LIMIT 1",
            [],
            |_| Ok(1i32),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();
    if !has_ai {
        if let Some(raw) = read_file_if_exists(&dir.join("ai-config.json")) {
            conn.execute(
                "INSERT INTO kv(key, value, updated_at) VALUES('ai_config', ?1, ?2)",
                params![raw, now_ms()],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let conv_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM ai_conversations", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if conv_count == 0 {
        if let Some(raw) = read_file_if_exists(&dir.join("ai-chats.json")) {
            if let Ok(chats) = serde_json::from_str::<crate::ai::AiChats>(&raw) {
                import_ai_chats(conn, &chats)?;
            }
        }
    }

    Ok(())
}

fn import_ai_chats(conn: &Connection, chats: &crate::ai::AiChats) -> Result<(), String> {
    for c in &chats.conversations {
        conn.execute(
            "INSERT OR IGNORE INTO ai_conversations(id, title, model_id, created_at, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5)",
            params![c.id, c.title, c.model_id, c.created_at, c.updated_at],
        )
        .map_err(|e| e.to_string())?;
    }
    for (cid, msgs) in &chats.messages {
        for m in msgs {
                let role = match serde_json::to_value(&m.role)
                    .ok()
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
                {
                    Some(s) => s,
                    None => "user".into(),
                };
                let attachments = m
                    .attachments
                    .as_ref()
                    .map(|a| serde_json::to_string(a).unwrap_or_else(|_| "[]".into()));
                conn.execute(
                    "INSERT OR IGNORE INTO ai_messages(id, conversation_id, role, content, reasoning, attachments, created_at)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        m.id,
                        cid,
                        role,
                        m.content,
                        m.reasoning,
                        attachments,
                        m.created_at
                    ],
                )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn project_cache_set(workspace: &str, payload_json: &str) -> Result<(), String> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO project_cache(workspace, payload, updated_at) VALUES(?1, ?2, ?3)
             ON CONFLICT(workspace) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
            params![workspace, payload_json, now_ms()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn project_cache_drop(workspace: &str) -> Result<(), String> {
    with_conn(|conn| {
        conn.execute(
            "DELETE FROM project_cache WHERE workspace = ?1",
            params![workspace],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn project_cache_all() -> Result<Vec<(String, String)>, String> {
    with_conn(|conn| {
        let mut stmt = conn
            .prepare("SELECT workspace, payload FROM project_cache")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

// ——— AI conversation helpers ———

pub fn ai_list_conversations() -> Result<Vec<crate::ai::AiConversation>, String> {
    with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, model_id, created_at, updated_at
                 FROM ai_conversations ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(crate::ai::AiConversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    model_id: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

pub fn ai_get_messages(conversation_id: &str) -> Result<Vec<crate::ai::AiMessage>, String> {
    with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, conversation_id, role, content, reasoning, attachments, created_at, stats
                 FROM ai_messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![conversation_id], |row| {
                let role_str: String = row.get(2)?;
                let role = match role_str.as_str() {
                    "assistant" => crate::ai::AiMessageRole::Assistant,
                    "system" => crate::ai::AiMessageRole::System,
                    _ => crate::ai::AiMessageRole::User,
                };
                let attachments_raw: Option<String> = row.get(5)?;
                let attachments = attachments_raw.and_then(|s| serde_json::from_str(&s).ok());
                let stats_raw: Option<String> = row.get(7)?;
                let stats = stats_raw.and_then(|s| serde_json::from_str(&s).ok());
                Ok(crate::ai::AiMessage {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    role,
                    content: row.get(3)?,
                    reasoning: row.get(4)?,
                    attachments,
                    created_at: row.get(6)?,
                    stats,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

pub fn ai_upsert_conversation(c: &crate::ai::AiConversation) -> Result<(), String> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO ai_conversations(id, title, model_id, created_at, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title,
               model_id=excluded.model_id,
               updated_at=excluded.updated_at",
            params![c.id, c.title, c.model_id, c.created_at, c.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn ai_delete_conversation(id: &str) -> Result<(), String> {
    with_conn(|conn| {
        conn.execute("DELETE FROM ai_messages WHERE conversation_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        let n = conn
            .execute("DELETE FROM ai_conversations WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("conversation not found: {id}"));
        }
        Ok(())
    })
}

pub fn ai_append_message(msg: &crate::ai::AiMessage) -> Result<(), String> {
    with_conn(|conn| {
        let role = match msg.role {
            crate::ai::AiMessageRole::User => "user",
            crate::ai::AiMessageRole::Assistant => "assistant",
            crate::ai::AiMessageRole::System => "system",
        };
        let attachments = msg
            .attachments
            .as_ref()
            .map(|a| serde_json::to_string(a).unwrap_or_else(|_| "[]".into()));
        let stats = msg
            .stats
            .as_ref()
            .and_then(|s| serde_json::to_string(s).ok());
        conn.execute(
            "INSERT INTO ai_messages(id, conversation_id, role, content, reasoning, attachments, created_at, stats)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                msg.id,
                msg.conversation_id,
                role,
                msg.content,
                msg.reasoning,
                attachments,
                msg.created_at,
                stats
            ],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE ai_conversations SET updated_at = ?1 WHERE id = ?2",
            params![now_ms(), msg.conversation_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn ai_update_message_content(id: &str, content: &str) -> Result<crate::ai::AiMessage, String> {
    with_conn(|conn| {
        let n = conn
            .execute(
                "UPDATE ai_messages SET content = ?1 WHERE id = ?2",
                params![content, id],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("message not found: {id}"));
        }
        let row = conn
            .query_row(
                "SELECT id, conversation_id, role, content, reasoning, attachments, created_at, stats
                 FROM ai_messages WHERE id = ?1",
                params![id],
                |row| {
                    let role_str: String = row.get(2)?;
                    let role = match role_str.as_str() {
                        "assistant" => crate::ai::AiMessageRole::Assistant,
                        "system" => crate::ai::AiMessageRole::System,
                        _ => crate::ai::AiMessageRole::User,
                    };
                    let attachments_raw: Option<String> = row.get(5)?;
                    let attachments = attachments_raw.and_then(|s| serde_json::from_str(&s).ok());
                    let stats_raw: Option<String> = row.get(7)?;
                    let stats = stats_raw.and_then(|s| serde_json::from_str(&s).ok());
                    Ok(crate::ai::AiMessage {
                        id: row.get(0)?,
                        conversation_id: row.get(1)?,
                        role,
                        content: row.get(3)?,
                        reasoning: row.get(4)?,
                        attachments,
                        created_at: row.get(6)?,
                        stats,
                    })
                },
            )
            .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE ai_conversations SET updated_at = ?1 WHERE id = ?2",
            params![now_ms(), row.conversation_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(row)
    })
}

/// Deletes a message. If it is a user turn, also removes the following assistant reply.
/// Returns deleted message ids.
pub fn ai_delete_message(id: &str) -> Result<Vec<String>, String> {
    with_conn(|conn| {
        let (conv_id, role, created_at): (String, String, i64) = conn
            .query_row(
                "SELECT conversation_id, role, created_at FROM ai_messages WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| format!("message not found: {id}"))?;

        let mut ids = vec![id.to_string()];
        if role == "user" {
            let next_assistant: Option<String> = conn
                .query_row(
                    "SELECT id FROM ai_messages
                     WHERE conversation_id = ?1 AND created_at >= ?2 AND id != ?3 AND role = 'assistant'
                     ORDER BY created_at ASC LIMIT 1",
                    params![conv_id, created_at, id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(aid) = next_assistant {
                // Only remove if no other user message sits between them.
                let intervening_user: Option<i32> = conn
                    .query_row(
                        "SELECT 1 FROM ai_messages
                         WHERE conversation_id = ?1 AND role = 'user'
                           AND created_at >= ?2 AND created_at <= (
                             SELECT created_at FROM ai_messages WHERE id = ?3
                           )
                           AND id != ?4
                         LIMIT 1",
                        params![conv_id, created_at, aid, id],
                        |_| Ok(1i32),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                if intervening_user.is_none() {
                    ids.push(aid);
                }
            }
        }

        for mid in &ids {
            conn.execute("DELETE FROM ai_messages WHERE id = ?1", params![mid])
                .map_err(|e| e.to_string())?;
        }
        conn.execute(
            "UPDATE ai_conversations SET updated_at = ?1 WHERE id = ?2",
            params![now_ms(), conv_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(ids)
    })
}
