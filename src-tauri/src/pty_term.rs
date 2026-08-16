//! ConPTY / portable-pty backed interactive shells for terminal tabs.

use crate::console_decode;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

static SESSIONS: Lazy<Mutex<HashMap<String, PtySession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

struct PtySession {
    /// Per-session writer lock: pty_write blocks only this session's write
    /// (never the global SESSIONS map) — a full ConPTY buffer can't stall
    /// every spawn/resize/kill (audit M2).
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// Direct child pid for tree-kill on close (audit H2).
    pid: Option<u32>,
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

/// Kill the direct child AND its whole process tree (npm run dev, node
/// watchers, build servers must not survive the tab close — audit H2).
fn kill_with_tree(session: &mut PtySession) {
    if let Some(pid) = session.pid {
        let _ = kill_tree::blocking::kill_tree(pid);
    }
    let _ = session.killer.kill();
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
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
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

/// Remove the session from the registry WITHOUT killing — the caller kills
/// outside the global lock so a stuck kill/wait can't stall every terminal
/// operation (audit M1).
fn take_session_locked(
    map: &mut HashMap<String, PtySession>,
    terminal_id: &str,
) -> Option<PtySession> {
    map.remove(terminal_id)
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
    // Kill any session reusing this id first (tree + direct child), but
    // outside the global lock.
    {
        let mut map = SESSIONS.lock();
        if let Some(mut old) = take_session_locked(&mut map, &terminal_id) {
            drop(map);
            kill_with_tree(&mut old);
        }
    }

    let cwd_path = Path::new(&cwd);
    if !cwd_path.is_dir() {
        log::error!("[pty] spawn {terminal_id}: 工作目录无效: {cwd}");
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
        .map_err(|e| {
            log::error!("[pty] spawn {terminal_id}: openpty 失败: {e}");
            format!("打开 PTY 失败: {e}")
        })?;

    let mut cmd = shell_command(cwd_path);
    crate::jen_cli::apply_pty_env(&app, &mut cmd);
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| {
            log::error!("[pty] spawn {terminal_id}: 启动 shell 失败: {e}");
            format!("启动 shell 失败: {e}")
        })?;
    log::info!("[pty] spawn {terminal_id}: shell started, cwd={cwd}");

    let pid = child.process_id();
    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("PTY reader 失败: {e}"))?;
    let writer = Arc::new(Mutex::new(
        pair.master
            .take_writer()
            .map_err(|e| format!("PTY writer 失败: {e}"))?,
    ));

    {
        let mut map = SESSIONS.lock();
        map.insert(
            terminal_id.clone(),
            PtySession {
                writer: Arc::clone(&writer),
                master: pair.master,
                killer,
                pid,
            },
        );
    }

    let tid_read = terminal_id.clone();
    let app_read = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8 * 1024];
        // Stateful decoder: an incomplete GBK/Shift-JIS/Big5 pair split across
        // reads is completed instead of becoming `�` (audit H3).
        let mut decoder = console_decode::StreamDecoder::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = decoder.push(&buf[..n], false);
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
        let tail = decoder.push(&[], true);
        if !tail.is_empty() {
            let _ = app_read.emit(
                "pty://data",
                PtyDataEvent {
                    terminal_id: tid_read.clone(),
                    data: tail,
                },
            );
        }
    });

    let tid_wait = terminal_id.clone();
    let app_wait = app;
    thread::spawn(move || {
        let code = match child.wait() {
            Ok(status) => Some(status.exit_code()),
            Err(e) => {
                log::error!("[pty] {tid_wait}: wait 失败: {e}");
                None
            }
        };
        if let Some(c) = code {
            log::warn!("[pty] {tid_wait}: shell exited with code {c}");
        }
        // Single-source exit event: only emit when the session still in the
        // registry is the one this thread waited on (same pid). If it was
        // replaced by a new spawn or removed by kill(), emitting would mark a
        // live (or already-gone) session dead (audit M3).
        {
            let mut map = SESSIONS.lock();
            match map.get(&tid_wait) {
                Some(s) if s.pid == pid => {
                    map.remove(&tid_wait);
                }
                _ => return,
            }
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
    // Grab the per-session writer Arc under the map lock, then release the
    // map lock before the (potentially blocking) write_all/flush — a full
    // ConPTY buffer must not stall other terminals' spawn/resize/kill
    // (audit M2).
    let writer = {
        let map = SESSIONS.lock();
        let session = map
            .get(&terminal_id)
            .ok_or_else(|| "终端未连接".to_string())?;
        Arc::clone(&session.writer)
    };
    let mut w = writer.lock();
    w.write_all(data.as_bytes())
        .map_err(|e| format!("写入 PTY 失败: {e}"))?;
    w.flush()
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

pub fn kill(_app: AppHandle, terminal_id: String) -> Result<(), String> {
    // Remove under the lock; kill the whole tree outside it (audit M1).
    let session = {
        let mut map = SESSIONS.lock();
        take_session_locked(&mut map, &terminal_id)
    };
    if let Some(mut session) = session {
        log::info!("[pty] killing session {terminal_id}");
        kill_with_tree(&mut session);
        // Intentionally NO pty://exit emit here: the wait thread is the single
        // source of exit events (audit M3) and fires once child.wait() returns
        // after the kill. Duplicate events previously removed the tab twice.
    }
    Ok(())
}
