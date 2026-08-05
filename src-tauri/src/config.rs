use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::ide::{default_ides, scrub_ides, IdeConfig};

const HISTORY_LIMIT: usize = 40;

/// Serialize config IO so setup + frontend first-launch cannot race.
static CONFIG_IO: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub value: String,
    pub count: u32,
    pub last_used_at: i64,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub workspaces: Vec<String>,
    /// key: "{workspacePath}::{projectFolderName}"
    pub tags: HashMap<String, Vec<String>>,
    pub ides: Vec<IdeConfig>,
    /// key: absolute project path
    #[serde(default)]
    pub command_history: HashMap<String, Vec<HistoryItem>>,
    /// key: absolute project path
    #[serde(default)]
    pub branch_history: HashMap<String, Vec<HistoryItem>>,
    /// Favorite branch names per project (independent from history)
    #[serde(default)]
    pub branch_favorites: HashMap<String, HashSet<String>>,
    /// Global project filter search history
    #[serde(default)]
    pub search_history: Vec<HistoryItem>,
    /// key: absolute project path → last accessed ms
    #[serde(default)]
    pub project_access: HashMap<String, i64>,
    /// UI language: "zh" | "en"
    #[serde(default = "default_locale")]
    pub locale: String,
}

fn default_locale() -> String {
    "zh".into()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            workspaces: Vec::new(),
            tags: HashMap::new(),
            ides: Vec::new(),
            command_history: HashMap::new(),
            branch_history: HashMap::new(),
            branch_favorites: HashMap::new(),
            search_history: Vec::new(),
            project_access: HashMap::new(),
            locale: default_locale(),
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Previous bundle id was `com.fpm.app` (ended with `.app`, warned on macOS).
/// Reinstall / identifier change must not wipe user data — copy from legacy dirs.
const LEGACY_CONFIG_DIR_NAMES: &[&str] = &["com.fpm.app"];

const MIGRATE_FILES: &[&str] = &["config.json", "ai-config.json", "ai-chats.json", "fpm.db"];

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if ty.is_file() && !to.exists() {
            let _ = fs::copy(&from, &to);
        }
    }
    Ok(())
}

/// Best-effort: if the new config dir is missing files (or only has an empty
/// fresh default), restore them from legacy identifier folders.
pub fn migrate_legacy_app_data(app: &AppHandle) {
    let Ok(new_dir) = app.path().app_config_dir() else {
        return;
    };
    let _ = fs::create_dir_all(&new_dir);
    let Some(parent) = new_dir.parent() else {
        return;
    };

    let new_cfg = new_dir.join("config.json");
    let new_db = new_dir.join("fpm.db");
    let new_is_emptyish = match fs::read_to_string(&new_cfg) {
        Ok(raw) => {
            raw.trim().is_empty()
                || serde_json::from_str::<AppConfig>(&raw)
                    .map(|c| c.workspaces.is_empty() && c.search_history.is_empty())
                    .unwrap_or(true)
        }
        Err(_) => !new_db.is_file(),
    };

    for legacy_name in LEGACY_CONFIG_DIR_NAMES {
        let legacy_dir = parent.join(legacy_name);
        if !legacy_dir.is_dir() {
            continue;
        }
        for name in MIGRATE_FILES {
            let dest = new_dir.join(name);
            let src = legacy_dir.join(name);
            if !src.is_file() {
                continue;
            }
            let should_copy = if *name == "config.json" {
                !dest.exists() || new_is_emptyish
            } else {
                !dest.exists()
            };
            if should_copy {
                let _ = fs::copy(&src, &dest);
            }
        }
        let legacy_icons = legacy_dir.join("ide-icons");
        let new_icons = new_dir.join("ide-icons");
        if legacy_icons.is_dir() {
            let _ = copy_dir_recursive(&legacy_icons, &new_icons);
        }
    }
}

fn fresh_default() -> AppConfig {
    let mut cfg = AppConfig::default();
    // IDEs start empty — scan or add manually (no placeholder CLI stubs).
    cfg.ides = default_ides();
    cfg
}

pub fn load_or_default(_app: &AppHandle) -> Result<AppConfig, String> {
    let _guard = CONFIG_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    match crate::db::kv_get_json::<AppConfig>("app_config")? {
        Some(mut cfg) => {
            if scrub_ides(&mut cfg.ides) {
                let _ = crate::db::kv_set_json("app_config", &cfg);
            }
            Ok(cfg)
        }
        None => {
            let cfg = fresh_default();
            crate::db::kv_set_json("app_config", &cfg)?;
            Ok(cfg)
        }
    }
}

pub fn save(_app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
    let _guard = CONFIG_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    crate::db::kv_set_json("app_config", cfg)
}
pub fn tag_key(workspace: &str, project_folder: &str) -> String {
    format!("{workspace}::{project_folder}")
}

fn sort_history(items: &mut [HistoryItem]) {
    items.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then(b.count.cmp(&a.count))
            .then(b.last_used_at.cmp(&a.last_used_at))
            .then(a.value.cmp(&b.value))
    });
}

fn touch_list(list: &mut Vec<HistoryItem>, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    if let Some(item) = list.iter_mut().find(|i| i.value == value) {
        item.count = item.count.saturating_add(1);
        item.last_used_at = now_ms();
    } else {
        list.push(HistoryItem {
            value: value.to_string(),
            count: 1,
            last_used_at: now_ms(),
            pinned: false,
        });
    }
    sort_history(list);
    if list.len() > HISTORY_LIMIT {
        // Keep pinned, drop oldest unpinned from the end after sort
        let mut pinned: Vec<_> = list.iter().filter(|i| i.pinned).cloned().collect();
        let mut rest: Vec<_> = list.iter().filter(|i| !i.pinned).cloned().collect();
        rest.truncate(HISTORY_LIMIT.saturating_sub(pinned.len()));
        pinned.append(&mut rest);
        sort_history(&mut pinned);
        *list = pinned;
    }
}

pub fn touch_command_history(
    app: &AppHandle,
    project_path: &str,
    command: &str,
) -> Result<AppConfig, String> {
    let mut cfg = load_or_default(app)?;
    let list = cfg
        .command_history
        .entry(project_path.to_string())
        .or_default();
    touch_list(list, command);
    save(app, &cfg)?;
    Ok(cfg)
}

pub fn touch_branch_history(
    app: &AppHandle,
    project_path: &str,
    branch: &str,
) -> Result<AppConfig, String> {
    let mut cfg = load_or_default(app)?;
    let list = cfg
        .branch_history
        .entry(project_path.to_string())
        .or_default();
    touch_list(list, branch);
    save(app, &cfg)?;
    Ok(cfg)
}

pub fn set_history_pinned(
    app: &AppHandle,
    project_path: &str,
    kind: &str,
    value: &str,
    pinned: bool,
) -> Result<AppConfig, String> {
    let mut cfg = load_or_default(app)?;
    match kind {
        "command" => {
            let list = cfg
                .command_history
                .entry(project_path.to_string())
                .or_default();
            if let Some(item) = list.iter_mut().find(|i| i.value == value) {
                item.pinned = pinned;
            }
            sort_history(list);
        }
        "branch" => {
            // Use separate favorites set — does NOT affect branch_history.
            let favs = cfg
                .branch_favorites
                .entry(project_path.to_string())
                .or_default();
            if pinned {
                favs.insert(value.to_string());
            } else {
                favs.remove(value);
            }
            // Also clear legacy pinned flag in branch_history for backward compat.
            if let Some(list) = cfg.branch_history.get_mut(project_path) {
                if let Some(item) = list.iter_mut().find(|i| i.value == value) {
                    item.pinned = false;
                }
            }
        }
        _ => return Err(format!("unknown history kind: {kind}")),
    }
    save(app, &cfg)?;
    Ok(cfg)
}

pub fn delete_history(
    app: &AppHandle,
    project_path: &str,
    kind: &str,
    value: &str,
) -> Result<AppConfig, String> {
    let mut cfg = load_or_default(app)?;
    let list = match kind {
        "command" => cfg.command_history.get_mut(project_path),
        "branch" => cfg.branch_history.get_mut(project_path),
        "search" => Some(&mut cfg.search_history),
        _ => return Err(format!("unknown history kind: {kind}")),
    };
    if let Some(list) = list {
        list.retain(|i| i.value != value);
    }
    save(app, &cfg)?;
    Ok(cfg)
}

pub fn touch_search_history(app: &AppHandle, query: &str) -> Result<AppConfig, String> {
    let mut cfg = load_or_default(app)?;
    touch_list(&mut cfg.search_history, query);
    // Prefer recency for search quick-picks
    cfg.search_history.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then(b.last_used_at.cmp(&a.last_used_at))
            .then(b.count.cmp(&a.count))
            .then(a.value.cmp(&b.value))
    });
    if cfg.search_history.len() > HISTORY_LIMIT {
        cfg.search_history.truncate(HISTORY_LIMIT);
    }
    save(app, &cfg)?;
    Ok(cfg)
}

pub fn touch_project_access(app: &AppHandle, project_path: &str) -> Result<AppConfig, String> {
    let path = project_path.trim();
    if path.is_empty() {
        return load_or_default(app);
    }
    let mut cfg = load_or_default(app)?;
    cfg.project_access.insert(path.to_string(), now_ms());
    save(app, &cfg)?;
    Ok(cfg)
}

pub fn set_locale(app: &AppHandle, locale: &str) -> Result<AppConfig, String> {
    let locale = if locale == "en" { "en" } else { "zh" };
    let mut cfg = load_or_default(app)?;
    cfg.locale = locale.into();
    save(app, &cfg)?;
    Ok(cfg)
}

pub fn load_project_statuses() -> Result<serde_json::Value, String> {
    match crate::db::kv_get("project_statuses")? {
        Some(raw) if !raw.trim().is_empty() => {
            let val: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
            let count = val.as_object().map(|o| o.len()).unwrap_or(0);
            log::info!("load_project_statuses: loaded {} entries", count);
            Ok(val)
        }
        _ => {
            log::info!("load_project_statuses: no data found");
            Ok(serde_json::json!({}))
        }
    }
}

pub fn save_project_statuses(data: serde_json::Value) -> Result<(), String> {
    let count = data.as_object().map(|o| o.len()).unwrap_or(0);
    log::info!("save_project_statuses: saving {} entries", count);
    let raw = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    crate::db::kv_set("project_statuses", &raw)
}
