//! ConPTY / portable-pty backed interactive shells for terminal tabs.

use crate::console_decode;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::thread;
use tauri::{AppHandle, Emitter};

static SESSIONS: Lazy<Mutex<HashMap<String, PtySession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyDataEvent {
    pub terminal_id: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitEvent {
    pub terminal_id: String,
    pub code: Option<u32>,
}

fn shell_command(cwd: &Path) -> CommandBuilder {
    #[cfg(windows)]
    {
        // Windows PowerShell 5.1 defaults to the system ANSI code page (GBK on
        // Chinese Windows). Force UTF-8 so git commit subjects / modern CLIs
        // round-trip correctly through ConPTY.
        //
        // Profiles run before -Command and often rebuild $env:Path from the
        // registry, wiping CreateProcess PATH (jen-cli shim). Re-prepend via
        // FPM_JEN_CLI_SHIM after profiles so interactive + early commands see it.
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        cmd.arg("-NoExit");
        cmd.arg("-Command");
        cmd.arg(
            "if ($env:FPM_JEN_CLI_SHIM) { \
               $env:Path = $env:FPM_JEN_CLI_SHIM + ';' + $env:Path \
             }; \
             chcp 65001 > $null; \
             [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false; \
             [Console]::OutputEncoding = [Console]::InputEncoding; \
             $OutputEncoding = [Console]::OutputEncoding",
        );
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("FORCE_COLOR", "1");
        cmd.env("PYTHONUTF8", "1");
        cmd.env("PYTHONIOENCODING", "utf-8");
        // Hint Git for Windows to emit UTF-8 on the console.
        cmd.env("LANG", "en_US.UTF-8");
        cmd
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|| {
            #[cfg(target_os = "macos")]
            {
                "/bin/zsh".into()
            }
            #[cfg(not(target_os = "macos"))]
            {
                "/bin/bash".into()
            }
        });
        // Interactive login shell; PATH re-prepend happens after first prompt
        // on the frontend side if needed. Prefer env inherit + wait-for-prompt.
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-l");
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("FORCE_COLOR", "1");
        cmd.env("LANG", std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into()));
        cmd
    }
}

fn kill_session_locked(map: &mut HashMap<String, PtySession>, terminal_id: &str) -> bool {
    if let Some(mut session) = map.remove(terminal_id) {
        let _ = session.killer.kill();
        true
    } else {
        false
    }
}

pub fn kill_all(app: &AppHandle) {
    let ids: Vec<String> = {
        let map = SESSIONS.lock();
        map.keys().cloned().collect()
    };
    for id in ids {
        let _ = kill(app.clone(), id);
    }
}

/// Spawn an interactive shell in a PTY for `terminal_id`.
pub fn spawn(
    app: AppHandle,
    terminal_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    {
        let mut map = SESSIONS.lock();
        kill_session_locked(&mut map, &terminal_id);
    }

    let cwd_path = Path::new(&cwd);
    if !cwd_path.is_dir() {
        return Err(format!("工作目录无效: {cwd}"));
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("打开 PTY 失败: {e}"))?;

    let mut cmd = shell_command(cwd_path);
    crate::jen_cli::apply_pty_env(&app, &mut cmd);
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("启动 shell 失败: {e}"))?;

    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("PTY reader 失败: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("PTY writer 失败: {e}"))?;

    {
        let mut map = SESSIONS.lock();
        map.insert(
            terminal_id.clone(),
            PtySession {
                writer,
                master: pair.master,
                killer,
            },
        );
    }

    let tid_read = terminal_id.clone();
    let app_read = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8 * 1024];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let (text, consumed) = console_decode::decode_available(&pending, false);
                    if consumed > 0 {
                        pending.drain(..consumed);
                    }
                    if !text.is_empty() {
                        let _ = app_read.emit(
                            "pty://data",
                            PtyDataEvent {
                                terminal_id: tid_read.clone(),
                                data: text,
                            },
                        );
                    }
                }
                Err(_) => break,
            }
        }
        if !pending.is_empty() {
            let text = console_decode::decode_bytes(&pending);
            if !text.is_empty() {
                let _ = app_read.emit(
                    "pty://data",
                    PtyDataEvent {
                        terminal_id: tid_read.clone(),
                        data: text,
                    },
                );
            }
        }
    });

    let tid_wait = terminal_id.clone();
    let app_wait = app;
    thread::spawn(move || {
        let code = match child.wait() {
            Ok(status) => Some(status.exit_code()),
            Err(_) => None,
        };
        {
            let mut map = SESSIONS.lock();
            map.remove(&tid_wait);
        }
        let _ = app_wait.emit(
            "pty://exit",
            PtyExitEvent {
                terminal_id: tid_wait,
                code,
            },
        );
    });

    Ok(())
}

pub fn write(terminal_id: String, data: String) -> Result<(), String> {
    let mut map = SESSIONS.lock();
    let session = map
        .get_mut(&terminal_id)
        .ok_or_else(|| "终端未连接".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入 PTY 失败: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("flush PTY 失败: {e}"))?;
    Ok(())
}

pub fn resize(terminal_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = SESSIONS.lock();
    let session = map
        .get(&terminal_id)
        .ok_or_else(|| "终端未连接".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize PTY 失败: {e}"))?;
    Ok(())
}

pub fn kill(app: AppHandle, terminal_id: String) -> Result<(), String> {
    let removed = {
        let mut map = SESSIONS.lock();
        kill_session_locked(&mut map, &terminal_id)
    };
    if removed {
        let _ = app.emit(
            "pty://exit",
            PtyExitEvent {
                terminal_id,
                code: None,
            },
        );
    }
    Ok(())
}

/// Check whether a PTY session is still registered.
#[allow(dead_code)]
pub fn is_alive(terminal_id: &str) -> bool {
    SESSIONS.lock().contains_key(terminal_id)
}
