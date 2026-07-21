use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::ide::{default_ides, IdeConfig};

const HISTORY_LIMIT: usize = 40;

/// Serialize config IO so setup + frontend first-launch cannot race-corrupt the file.
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

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn fresh_default() -> AppConfig {
    let mut cfg = AppConfig::default();
    // Light defaults only — heavy PATH/disk detect runs via detect_ides on demand.
    cfg.ides = default_ides();
    cfg
}

fn write_atomic(path: &PathBuf, raw: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    // Retry briefly — antivirus / installer can lock AppData on first launch.
    let mut last_err = String::new();
    for attempt in 0..6 {
        match fs::write(&tmp, raw) {
            Ok(()) => {
                let _ = fs::remove_file(path);
                match fs::rename(&tmp, path) {
                    Ok(()) => return Ok(()),
                    Err(e) => {
                        // Fallback: direct write if rename is blocked.
                        match fs::write(path, raw) {
                            Ok(()) => {
                                let _ = fs::remove_file(&tmp);
                                return Ok(());
                            }
                            Err(e2) => last_err = format!("rename: {e}; write: {e2}"),
                        }
                    }
                }
            }
            Err(e) => last_err = e.to_string(),
        }
        thread::sleep(Duration::from_millis(40 * (attempt + 1)));
    }
    Err(format!("Failed to write config: {last_err}"))
}

pub fn load_or_default(app: &AppHandle) -> Result<AppConfig, String> {
    let _guard = CONFIG_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let path = config_path(app)?;
    if !path.exists() {
        let cfg = fresh_default();
        write_atomic(&path, &serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?)?;
        return Ok(cfg);
    }

    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        let cfg = fresh_default();
        write_atomic(&path, &serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?)?;
        return Ok(cfg);
    }

    let mut cfg: AppConfig = match serde_json::from_str(&raw) {
        Ok(c) => c,
        Err(_) => {
            // Corrupt leftover after uninstall/reinstall — backup and recreate.
            let bak = path.with_extension("json.bak");
            let _ = fs::remove_file(&bak);
            let _ = fs::rename(&path, &bak);
            let cfg = fresh_default();
            write_atomic(
                &path,
                &serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?,
            )?;
            return Ok(cfg);
        }
    };
    if cfg.ides.is_empty() {
        cfg.ides = default_ides();
        let _ = write_atomic(
            &path,
            &serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?,
        );
    }
    Ok(cfg)
}

pub fn save(app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
    let _guard = CONFIG_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = config_path(app)?;
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    write_atomic(&path, &raw)
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
    let list = match kind {
        "command" => cfg
            .command_history
            .entry(project_path.to_string())
            .or_default(),
        "branch" => cfg
            .branch_history
            .entry(project_path.to_string())
            .or_default(),
        _ => return Err(format!("unknown history kind: {kind}")),
    };
    if let Some(item) = list.iter_mut().find(|i| i.value == value) {
        item.pinned = pinned;
    }
    sort_history(list);
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
