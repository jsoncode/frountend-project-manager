use config::{tag_key, AppConfig};
use ide::{IdeConfig, InstalledEditor};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;

mod ai;
mod bat_view;
mod config;
mod console_decode;
mod db;
mod env_files;
mod fs_explorer;
mod git;
mod ide;
mod jen_cli;
mod process;
mod pty_term;
mod scan;

#[cfg(windows)]
mod win_icon;

/// When false, the window close button hides to tray instead of quitting.
static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);

fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn quit_app(app: &AppHandle) {
    pty_term::kill_all(app);
    process::kill_all_commands(app);
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<AppConfig, String> {
    config::load_or_default(&app)
}

#[tauri::command]
fn save_config(app: AppHandle, cfg: AppConfig) -> Result<(), String> {
    config::save(&app, &cfg)
}

#[tauri::command]
fn ai_load_config(app: AppHandle) -> Result<ai::AiConfig, String> {
    ai::load_config(&app)
}

#[tauri::command]
fn ai_save_config(app: AppHandle, cfg: ai::AiConfig) -> Result<ai::AiConfig, String> {
    ai::save_config(&app, &cfg)
}

#[tauri::command]
fn ai_list_conversations(app: AppHandle) -> Result<Vec<ai::AiConversation>, String> {
    ai::list_conversations(&app)
}

#[tauri::command]
fn ai_get_messages(
    app: AppHandle,
    conversation_id: String,
) -> Result<Vec<ai::AiMessage>, String> {
    ai::get_messages(&app, &conversation_id)
}

#[tauri::command]
fn ai_create_conversation(
    app: AppHandle,
    title: Option<String>,
) -> Result<ai::AiConversation, String> {
    ai::create_conversation(&app, title)
}

#[tauri::command]
fn ai_rename_conversation(
    app: AppHandle,
    id: String,
    title: String,
) -> Result<ai::AiConversation, String> {
    ai::rename_conversation(&app, &id, &title)
}

#[tauri::command]
fn ai_delete_conversation(app: AppHandle, id: String) -> Result<(), String> {
    ai::delete_conversation(&app, &id)
}

#[tauri::command]
fn ai_append_message(app: AppHandle, msg: ai::AiMessage) -> Result<ai::AiMessage, String> {
    ai::append_message(&app, msg)
}

#[tauri::command]
fn ai_update_message(
    app: AppHandle,
    id: String,
    content: String,
) -> Result<ai::AiMessage, String> {
    ai::update_message_content(&app, &id, &content)
}

#[tauri::command]
fn ai_delete_message(app: AppHandle, id: String) -> Result<Vec<String>, String> {
    ai::delete_message(&app, &id)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutSnapshot {
    /// Single explorer column width (replaces rail + list).
    #[serde(default)]
    explorer_width: Option<f64>,
    /// Legacy dual-pane widths — used only to migrate old layouts.
    #[serde(default)]
    rail_width: Option<f64>,
    #[serde(default)]
    list_width: Option<f64>,
    tool_panel_width: f64,
    terminal_height: f64,
    tool_layout_mode: String,
    open_tools: Vec<String>,
}

#[tauri::command]
fn load_layout() -> Result<Option<LayoutSnapshot>, String> {
    db::kv_get_json("layout")
}

#[tauri::command]
fn save_layout(layout: LayoutSnapshot) -> Result<(), String> {
    db::kv_set_json("layout", &layout)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionSnapshot {
    #[serde(default)]
    active_workspace: Option<String>,
    #[serde(default)]
    expanded: Vec<String>,
    #[serde(default)]
    selected_project_path: Option<String>,
    #[serde(default)]
    editor_tabs: Vec<EditorTabSnapshot>,
    #[serde(default)]
    editor_active_path: Option<String>,
    #[serde(default)]
    terminal_sessions: Vec<TerminalSessionSnapshot>,
    #[serde(default)]
    terminal_active_project: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditorTabSnapshot {
    path: String,
    project_path: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionSnapshot {
    project_path: String,
    project_name: String,
}

#[tauri::command]
fn load_session() -> Result<Option<SessionSnapshot>, String> {
    db::kv_get_json("session")
}

#[tauri::command]
fn save_session(session: SessionSnapshot) -> Result<(), String> {
    db::kv_set_json("session", &session)
}

#[tauri::command]
fn load_project_cache() -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
    let rows = db::project_cache_all()?;
    let mut out = std::collections::HashMap::new();
    for (ws, payload) in rows {
        if let Ok(v) = serde_json::from_str(&payload) {
            out.insert(ws, v);
        }
    }
    Ok(out)
}

#[tauri::command]
fn save_project_cache(workspace: String, projects: serde_json::Value) -> Result<(), String> {
    let raw = serde_json::to_string(&projects).map_err(|e| e.to_string())?;
    db::project_cache_set(&workspace, &raw)
}

#[tauri::command]
fn drop_project_cache(workspace: String) -> Result<(), String> {
    db::project_cache_drop(&workspace)
}

#[tauri::command]
fn clear_all_project_cache(app: AppHandle) -> Result<(), String> {
    db::project_cache_clear_all()?;
    // Also clear project statuses stored in dedicated kv key.
    let _ = db::kv_set("project_statuses", "{}");
    // Also clear history data stored in AppConfig (kv table).
    let mut cfg = config::load_or_default(&app)?;
    cfg.command_history.clear();
    cfg.branch_history.clear();
    cfg.branch_favorites.clear();
    cfg.search_history.clear();
    config::save(&app, &cfg)?;
    Ok(())
}

#[tauri::command]
fn load_project_statuses() -> Result<serde_json::Value, String> {
    config::load_project_statuses()
}

#[tauri::command]
fn save_project_statuses(data: serde_json::Value) -> Result<(), String> {
    config::save_project_statuses(data)
}

#[tauri::command]
fn clear_all_ai_conversations() -> Result<(), String> {
    db::ai_clear_all_conversations()
}

#[tauri::command(async)]
async fn ai_open_chat_window(app: AppHandle, feed_text: Option<String>) -> Result<(), String> {
    // CRITICAL (Windows): creating a WebviewWindow inside a sync command deadlocks
    // WebView2 → blank white window that cannot be closed. Must be async.
    // See https://github.com/tauri-apps/tauri/issues/13963
    // Reuse the existing window when possible so the last conversation stays loaded;
    // always re-center on open.
    ai::open_or_focus_ai_chat(&app, feed_text)
}

#[tauri::command]
fn ai_take_pending_feed() -> Result<Option<String>, String> {
    Ok(ai::take_pending_feed())
}

#[tauri::command]
fn ai_chat_start(app: AppHandle, req: ai::ChatRequest) -> Result<(), String> {
    ai::start_chat(app, req)
}

#[tauri::command]
fn ai_chat_cancel(request_id: String) -> Result<(), String> {
    ai::cancel_chat(&request_id)
}

#[tauri::command(async)]
async fn ai_generate_title(
    app: AppHandle,
    model_id: String,
    user_message: String,
) -> Result<String, String> {
    ai::generate_title(app, model_id, user_message).await
}

#[tauri::command(async)]
async fn list_projects(workspace: String) -> Result<Vec<scan::ProjectSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || scan::list_projects(&workspace))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn scan_project(path: String) -> Result<scan::ProjectDetails, String> {
    tauri::async_runtime::spawn_blocking(move || scan::scan_project(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_branches(path: String) -> Result<Option<git::GitInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || git::git_branches(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_status(path: String) -> Result<git::GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || git::git_status(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_checkout(path: String, branch: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::git_checkout(&path, &branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_create_branch(
    path: String,
    name: String,
    from: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::git_create_branch(&path, &name, &from)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_delete_branch(
    path: String,
    branch: String,
    is_remote: bool,
    also_local: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::git_delete_branch(&path, &branch, is_remote, also_local)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_fetch(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::git_fetch(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_pull_branch(path: String, branch: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::git_pull_branch(&path, &branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_merge_status(path: String) -> Result<git::MergeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || git::git_merge_status(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_merge_start(path: String, git_ref: String) -> Result<git::MergeStartResult, String> {
    tauri::async_runtime::spawn_blocking(move || git::git_merge_start(&path, &git_ref))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_merge_file_sides(
    path: String,
    file: String,
) -> Result<git::MergeFileSides, String> {
    tauri::async_runtime::spawn_blocking(move || git::git_merge_file_sides(&path, &file))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_diff_head(
    path: String,
    file: String,
) -> Result<git::DiffHeadResult, String> {
    tauri::async_runtime::spawn_blocking(move || git::git_diff_head(&path, &file))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_merge_resolve_ours_theirs(
    path: String,
    file: String,
    ours: bool,
) -> Result<git::MergeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::git_merge_resolve_ours_theirs(&path, &file, ours)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_merge_resolve_content(
    path: String,
    file: String,
    content: String,
) -> Result<git::MergeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::git_merge_resolve_content(&path, &file, &content)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_merge_abort(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::git_merge_abort(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn git_merge_commit(
    path: String,
    message: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::git_merge_commit(&path, message))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn list_env_files(path: String) -> Result<Vec<env_files::EnvFileInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || env_files::list_env_files(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn read_env_file(path: String) -> Result<Vec<env_files::EnvEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || env_files::read_env_file(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn list_directory_entries(
    path: String,
) -> Result<Vec<fs_explorer::DirEntryInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || fs_explorer::list_directory_entries(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn create_directory(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fs_explorer::create_directory(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn read_text_file(path: String) -> Result<fs_explorer::TextFileResult, String> {
    tauri::async_runtime::spawn_blocking(move || fs_explorer::read_text_file(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn write_text_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || fs_explorer::write_text_file(&path, content))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn resolve_import(
    project_root: String,
    from_file: String,
    specifier: String,
    aliases: Vec<fs_explorer::AliasMapping>,
) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs_explorer::resolve_import(&project_root, &from_file, &specifier, &aliases)
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
fn run_command(
    app: AppHandle,
    terminal_id: String,
    project_path: String,
    command: String,
) -> Result<(), String> {
    process::run_command(app, terminal_id, project_path, command)
}

#[tauri::command]
fn kill_command(app: AppHandle, terminal_id: String) -> Result<(), String> {
    process::kill_command(app, terminal_id)
}

#[tauri::command]
fn write_terminal_stdin(terminal_id: String, data: String) -> Result<(), String> {
    process::write_stdin(terminal_id, data)
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    terminal_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty_term::spawn(app, terminal_id, cwd, cols, rows)
}

#[tauri::command]
fn pty_write(terminal_id: String, data: String) -> Result<(), String> {
    pty_term::write(terminal_id, data)
}

#[tauri::command]
fn pty_resize(terminal_id: String, cols: u16, rows: u16) -> Result<(), String> {
    pty_term::resize(terminal_id, cols, rows)
}

#[tauri::command]
fn pty_kill(app: AppHandle, terminal_id: String) -> Result<(), String> {
    pty_term::kill(app, terminal_id)
}

#[tauri::command(async)]
async fn jen_cli_get_state(app: AppHandle) -> Result<jen_cli::JenCliState, String> {
    tauri::async_runtime::spawn_blocking(move || jen_cli::get_state(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn jen_cli_save_servers(app: AppHandle, servers: serde_json::Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || jen_cli::save_servers(&app, servers))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn jen_cli_save_defaults(app: AppHandle, defaults: serde_json::Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || jen_cli::save_defaults(&app, defaults))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn jen_cli_reset_servers(app: AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || jen_cli::reset_servers_from_example(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
async fn jen_cli_set_path_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || jen_cli::set_path_enabled(&app, enabled))
        .await
        .map_err(|e| e.to_string())?
}

/// Pretty-print a file with embedded bat (ANSI). Also available via terminal `cat`/`type`/`bat`.
#[tauri::command]
fn preview_file(path: String, cwd: Option<String>) -> Result<String, String> {
    use std::path::PathBuf;
    let file = if PathBuf::from(&path).is_absolute() {
        PathBuf::from(&path)
    } else if let Some(base) = cwd {
        PathBuf::from(base).join(&path)
    } else {
        PathBuf::from(&path)
    };
    bat_view::render_files(&[file], None)
}

#[tauri::command(async)]
async fn detect_ides() -> Vec<IdeConfig> {
    tauri::async_runtime::spawn_blocking(ide::detect_ides)
        .await
        .unwrap_or_default()
}

#[tauri::command(async)]
async fn list_installed_editors() -> Vec<InstalledEditor> {
    tauri::async_runtime::spawn_blocking(ide::list_installed_editors)
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn resolve_typed_executable(path: String) -> Option<InstalledEditor> {
    ide::resolve_typed_executable(&path)
}

#[tauri::command]
fn open_in_ide(app: AppHandle, ide_id: String, project_path: String) -> Result<(), String> {
    let cfg = config::load_or_default(&app)?;
    let target = cfg
        .ides
        .iter()
        .find(|i| i.id == ide_id)
        .ok_or_else(|| format!("IDE not found: {ide_id}"))?;
    ide::open_in_ide(target, &project_path)
}

#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    ide::reveal_in_file_manager(&path)
}

#[tauri::command]
fn save_ides(app: AppHandle, ides: Vec<IdeConfig>) -> Result<AppConfig, String> {
    let mut cfg = config::load_or_default(&app)?;
    let mut ides = ides;
    ide::scrub_ides(&mut ides);
    cfg.ides = ides;
    config::save(&app, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
fn set_project_tags(
    app: AppHandle,
    workspace: String,
    project_folder: String,
    tags: Vec<String>,
) -> Result<AppConfig, String> {
    let mut cfg = config::load_or_default(&app)?;
    let key = tag_key(&workspace, &project_folder);
    let cleaned: Vec<String> = tags
        .into_iter()
        .map(|t| t.trim().trim_start_matches('#').to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if cleaned.is_empty() {
        cfg.tags.remove(&key);
    } else {
        cfg.tags.insert(key, cleaned);
    }
    config::save(&app, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
fn touch_command_history(
    app: AppHandle,
    project_path: String,
    command: String,
) -> Result<AppConfig, String> {
    config::touch_command_history(&app, &project_path, &command)
}

#[tauri::command]
fn touch_branch_history(
    app: AppHandle,
    project_path: String,
    branch: String,
) -> Result<AppConfig, String> {
    config::touch_branch_history(&app, &project_path, &branch)
}

#[tauri::command]
fn set_history_pinned(
    app: AppHandle,
    project_path: String,
    kind: String,
    value: String,
    pinned: bool,
) -> Result<AppConfig, String> {
    config::set_history_pinned(&app, &project_path, &kind, &value, pinned)
}

#[tauri::command]
fn delete_history(
    app: AppHandle,
    project_path: String,
    kind: String,
    value: String,
) -> Result<AppConfig, String> {
    config::delete_history(&app, &project_path, &kind, &value)
}

#[tauri::command]
fn touch_search_history(app: AppHandle, query: String) -> Result<AppConfig, String> {
    config::touch_search_history(&app, &query)
}

#[tauri::command]
fn touch_project_access(app: AppHandle, project_path: String) -> Result<AppConfig, String> {
    config::touch_project_access(&app, &project_path)
}

#[tauri::command]
fn set_locale(app: AppHandle, locale: String) -> Result<AppConfig, String> {
    config::set_locale(&app, &locale)
}

#[tauri::command]
fn pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    let folder = app
        .dialog()
        .file()
        .set_title("Select Workspace Folder")
        .blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
fn pick_executable(app: AppHandle) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .set_title("Select IDE Executable")
        .add_filter("Executable", &["exe", "cmd", "bat"])
        .blocking_pick_file();
    Ok(file.map(|p| p.to_string()))
}

#[tauri::command]
fn pick_file_in_directory(app: AppHandle, directory: String) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .set_title("Select File to Compare")
        .set_directory(directory)
        .blocking_pick_file();
    Ok(file.map(|p| p.to_string()))
}

#[tauri::command]
fn pick_image(app: AppHandle) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .set_title("Select Icon Image")
        .add_filter("Image", &["png", "jpg", "jpeg", "gif", "webp", "ico", "svg", "bmp"])
        .blocking_pick_file();
    Ok(file.map(|p| p.to_string()))
}

#[tauri::command]
fn import_ide_icon(app: AppHandle, source_path: String) -> Result<String, String> {
    ide::import_ide_icon(&app, &source_path)
}

#[tauri::command]
fn import_ide_icon_bytes(
    app: AppHandle,
    bytes: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    ide::import_ide_icon_bytes(&app, bytes, ext)
}

#[tauri::command]
fn extract_ide_icon_from_exe(app: AppHandle, executable: String) -> Result<String, String> {
    ide::extract_ide_icon_from_exe(&app, &executable)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_snap_layout::init()
                .button_id("titlebar-maximize")
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // SQLite first — migrates legacy JSON / identifier dirs into fpm.db.
            if let Err(e) = db::init(app.handle()) {
                log::error!("sqlite init failed: {e}");
                return Err(Box::new(std::io::Error::other(e)));
            }

            if let Err(e) = jen_cli::ensure_configs(app.handle()) {
                log::warn!("jen-cli config init: {e}");
            }
            // Background: node -v + user PATH (avoid blocking UI / first settings open).
            std::thread::spawn(|| {
                jen_cli::warmup_caches();
            });

            // Single config load — must stay fast (no IDE disk scans).
            let locale = config::load_or_default(app.handle())
                .map(|c| c.locale)
                .unwrap_or_else(|_| "zh".into());

            if let Some(win) = app.get_webview_window("main") {
                #[cfg(windows)]
                win_icon::apply_window_icons(&win);
                #[cfg(not(windows))]
                {
                    if let Ok(icon) =
                        tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
                    {
                        let _ = win.set_icon(icon);
                    }
                }
                let _ = win.center();
                let _ = win.show();
                let _ = win.set_focus();
            }

            // Tray is best-effort: never abort app startup (would leave a blank window).
            let (show_label, quit_label, tooltip) = if locale == "en" {
                ("Show window", "Quit", "FPM — running in tray")
            } else {
                ("显示窗口", "退出", "FPM — 已最小化到托盘")
            };

            if let (Ok(show_i), Ok(quit_i)) = (
                MenuItem::with_id(app, "show", show_label, true, None::<&str>),
                MenuItem::with_id(app, "quit", quit_label, true, None::<&str>),
            ) {
                if let Ok(menu) = Menu::with_items(app, &[&show_i, &quit_i]) {
                    let mut tray = TrayIconBuilder::new()
                        .menu(&menu)
                        .tooltip(tooltip)
                        .on_menu_event(|app, event| match event.id.as_ref() {
                            "show" => show_main_window(app),
                            "quit" => quit_app(app),
                            _ => {}
                        })
                        .on_tray_icon_event(|tray, event| {
                            if let TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } = event
                            {
                                show_main_window(tray.app_handle());
                            }
                        });

                    if let Some(icon) = app.default_window_icon() {
                        tray = tray.icon(icon.clone());
                    }
                    let _ = tray.build(app);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    "ai-chat" => {
                        // Cancel streams, then force-destroy. Using destroy() avoids
                        // stuck CloseRequested loops after a prior WebView2 deadlock.
                        ai::cancel_all();
                        api.prevent_close();
                        let _ = window.destroy();
                    }
                    "main" => {
                        if !ALLOW_EXIT.load(Ordering::SeqCst) {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            ai_load_config,
            ai_save_config,
            ai_list_conversations,
            ai_get_messages,
            ai_create_conversation,
            ai_rename_conversation,
            ai_delete_conversation,
            ai_append_message,
            ai_update_message,
            ai_delete_message,
            load_layout,
            save_layout,
            load_session,
            save_session,
            load_project_cache,
            save_project_cache,
            drop_project_cache,
            clear_all_project_cache,
            clear_all_ai_conversations,
            load_project_statuses,
            save_project_statuses,
            ai_open_chat_window,
            ai_take_pending_feed,
            ai_chat_start,
            ai_chat_cancel,
            ai_generate_title,
            list_projects,
            scan_project,
            git_branches,
            git_status,
            git_checkout,
            git_create_branch,
            git_delete_branch,
            git_fetch,
            git_pull_branch,
            git_merge_status,
            git_merge_start,
            git_merge_file_sides,
            git_diff_head,
            git_merge_resolve_ours_theirs,
            git_merge_resolve_content,
            git_merge_abort,
            git_merge_commit,
            list_env_files,
            read_env_file,
            list_directory_entries,
            create_directory,
            read_text_file,
            write_text_file,
            resolve_import,
            run_command,
            kill_command,
            write_terminal_stdin,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            jen_cli_get_state,
            jen_cli_save_servers,
            jen_cli_save_defaults,
            jen_cli_reset_servers,
            jen_cli_set_path_enabled,
            preview_file,
            detect_ides,
            list_installed_editors,
            resolve_typed_executable,
            open_in_ide,
            reveal_in_file_manager,
            save_ides,
            set_project_tags,
            touch_command_history,
            touch_branch_history,
            touch_search_history,
            touch_project_access,
            set_history_pinned,
            delete_history,
            set_locale,
            pick_directory,
            pick_executable,
            pick_image,
            pick_file_in_directory,
            import_ide_icon,
            import_ide_icon_bytes,
            extract_ide_icon_from_exe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
