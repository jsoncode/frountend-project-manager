use config::{tag_key, AppConfig};
use ide::{IdeConfig, InstalledEditor};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;

mod bat_view;
mod config;
mod console_decode;
mod env_files;
mod git;
mod ide;
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
fn list_projects(workspace: String) -> Result<Vec<scan::ProjectSummary>, String> {
    scan::list_projects(&workspace)
}

#[tauri::command]
fn scan_project(path: String) -> Result<scan::ProjectDetails, String> {
    scan::scan_project(&path)
}

#[tauri::command]
fn git_branches(path: String) -> Result<Option<git::GitInfo>, String> {
    git::git_branches(&path)
}

#[tauri::command]
fn git_status(path: String) -> Result<git::GitStatus, String> {
    git::git_status(&path)
}

#[tauri::command]
fn git_checkout(path: String, branch: String) -> Result<String, String> {
    git::git_checkout(&path, &branch)
}

#[tauri::command]
fn git_fetch(path: String) -> Result<String, String> {
    git::git_fetch(&path)
}

#[tauri::command]
fn list_env_files(path: String) -> Result<Vec<env_files::EnvFileInfo>, String> {
    env_files::list_env_files(&path)
}

#[tauri::command]
fn read_env_file(path: String) -> Result<Vec<env_files::EnvEntry>, String> {
    env_files::read_env_file(&path)
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

#[tauri::command]
fn pty_interrupt(terminal_id: String) -> Result<(), String> {
    pty_term::send_interrupt(terminal_id)
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

#[tauri::command]
fn detect_ides() -> Vec<IdeConfig> {
    ide::detect_ides()
}

#[tauri::command]
fn list_installed_editors() -> Vec<InstalledEditor> {
    ide::list_installed_editors()
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
fn save_ides(app: AppHandle, ides: Vec<IdeConfig>) -> Result<AppConfig, String> {
    let mut cfg = config::load_or_default(&app)?;
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

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
                if !ALLOW_EXIT.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            list_projects,
            scan_project,
            git_branches,
            git_status,
            git_checkout,
            git_fetch,
            list_env_files,
            read_env_file,
            run_command,
            kill_command,
            write_terminal_stdin,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_interrupt,
            preview_file,
            detect_ides,
            list_installed_editors,
            open_in_ide,
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
            import_ide_icon,
            import_ide_icon_bytes,
            extract_ide_icon_from_exe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
