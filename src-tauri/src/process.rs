use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Hide console window when a GUI app spawns cmd/node (same idea as VS Code's integrated terminal).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const PIPE_BUF: usize = 8 * 1024;

static SESSIONS: Lazy<Mutex<HashMap<String, RunningProc>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

struct RunningProc {
    child: Child,
    stdin: Option<ChildStdin>,
    pid: u32,
    project_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalLine {
    pub terminal_id: String,
    pub project_path: String,
    pub stream: String,
    pub line: String,
}

fn kill_process_tree(pid: u32) {
    let _ = kill_tree::blocking::kill_tree(pid);

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

fn kill_session_locked(
    map: &mut HashMap<String, RunningProc>,
    terminal_id: &str,
) -> Option<String> {
    if let Some(mut running) = map.remove(terminal_id) {
        let path = running.project_path.clone();
        let pid = running.pid;
        drop(running.stdin.take());
        kill_process_tree(pid);
        let _ = running.child.kill();
        let _ = running.child.wait();
        Some(path)
    } else {
        None
    }
}

fn emit_chunk(
    app: &AppHandle,
    terminal_id: &str,
    project_path: &str,
    stream: &str,
    chunk: &str,
) {
    if chunk.is_empty() {
        return;
    }
    let _ = app.emit(
        "terminal://line",
        TerminalLine {
            terminal_id: terminal_id.to_string(),
            project_path: project_path.to_string(),
            stream: stream.to_string(),
            line: chunk.to_string(),
        },
    );
}

fn pump_pipe<R: Read>(
    app: AppHandle,
    terminal_id: String,
    project_path: String,
    stream: &'static str,
    mut reader: R,
) {
    let mut buf = [0u8; PIPE_BUF];
    let mut pending = String::new();

    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                pending.push_str(&String::from_utf8_lossy(&buf[..n]));
                flush_pending(&app, &terminal_id, &project_path, stream, &mut pending, false);
            }
            Err(_) => break,
        }
    }

    flush_pending(&app, &terminal_id, &project_path, stream, &mut pending, true);
}

fn flush_pending(
    app: &AppHandle,
    terminal_id: &str,
    project_path: &str,
    stream: &str,
    pending: &mut String,
    flush_tail: bool,
) {
    loop {
        let bytes = pending.as_bytes();
        let Some(pos) = bytes.iter().position(|&b| b == b'\n' || b == b'\r') else {
            break;
        };

        let chunk = pending[..pos].to_string();
        let is_cr = bytes[pos] == b'\r';
        let mut eat = pos + 1;
        if is_cr && bytes.get(pos + 1) == Some(&b'\n') {
            eat = pos + 2;
        }
        *pending = pending[eat..].to_string();
        emit_chunk(app, terminal_id, project_path, stream, &chunk);
    }

    if pending.len() >= 1024 {
        let chunk = std::mem::take(pending);
        emit_chunk(app, terminal_id, project_path, stream, &chunk);
    } else if flush_tail && !pending.is_empty() {
        let chunk = std::mem::take(pending);
        emit_chunk(app, terminal_id, project_path, stream, &chunk);
    }
}

pub fn kill_command(app: AppHandle, terminal_id: String) -> Result<(), String> {
    let killed = {
        let mut map = SESSIONS.lock();
        kill_session_locked(&mut map, &terminal_id)
    };
    if let Some(project_path) = killed {
        emit_chunk(&app, &terminal_id, &project_path, "system", "[stopped]");
    }
    Ok(())
}

pub fn kill_all_commands(app: &AppHandle) {
    let killed: Vec<(String, String)> = {
        let mut map = SESSIONS.lock();
        let ids: Vec<String> = map.keys().cloned().collect();
        ids.into_iter()
            .filter_map(|id| kill_session_locked(&mut map, &id).map(|path| (id, path)))
            .collect()
    };
    for (terminal_id, project_path) in killed {
        emit_chunk(app, &terminal_id, &project_path, "system", "[stopped]");
    }
}

/// Write bytes to a running process stdin (for interactive prompts / editors).
pub fn write_stdin(terminal_id: String, data: String) -> Result<(), String> {
    let mut map = SESSIONS.lock();
    let running = map
        .get_mut(&terminal_id)
        .ok_or_else(|| "终端进程未在运行".to_string())?;
    let stdin = running
        .stdin
        .as_mut()
        .ok_or_else(|| "终端 stdin 不可用".to_string())?;
    stdin
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入 stdin 失败: {e}"))?;
    stdin.flush().map_err(|e| format!("flush stdin 失败: {e}"))?;
    Ok(())
}

pub fn run_command(
    app: AppHandle,
    terminal_id: String,
    project_path: String,
    command: String,
) -> Result<(), String> {
    {
        let mut map = SESSIONS.lock();
        kill_session_locked(&mut map, &terminal_id);
    }

    emit_chunk(
        &app,
        &terminal_id,
        &project_path,
        "system",
        &format!("$ {command}"),
    );

    // Piped stdin so interactive tools (merge conflicts, prompts) can receive keystrokes.
    #[cfg(target_os = "windows")]
    let mut child = {
        let mut cmd = Command::new("cmd");
        cmd.args(["/S", "/C", &command])
            .current_dir(&project_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("TERM", "xterm-256color")
            .env("FORCE_COLOR", "1")
            .creation_flags(CREATE_NO_WINDOW);
        cmd.spawn().map_err(|e| e.to_string())?
    };

    #[cfg(not(target_os = "windows"))]
    let mut child = Command::new("sh")
        .args(["-lc", &command])
        .current_dir(&project_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("TERM", "xterm-256color")
        .env("FORCE_COLOR", "1")
        .spawn()
        .map_err(|e| e.to_string())?;

    let pid = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let mut map = SESSIONS.lock();
        map.insert(
            terminal_id.clone(),
            RunningProc {
                child,
                stdin,
                pid,
                project_path: project_path.clone(),
            },
        );
    }

    if let Some(out) = stdout {
        let app_out = app.clone();
        let tid = terminal_id.clone();
        let path = project_path.clone();
        thread::spawn(move || pump_pipe(app_out, tid, path, "stdout", out));
    }

    if let Some(err) = stderr {
        let app_err = app.clone();
        let tid = terminal_id.clone();
        let path = project_path.clone();
        thread::spawn(move || pump_pipe(app_err, tid, path, "stderr", err));
    }

    let tid_done = terminal_id;
    let app_done = app;
    let path_done = project_path;
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(80));
            let finished = {
                let mut map = SESSIONS.lock();
                match map.get_mut(&tid_done) {
                    Some(running) => match running.child.try_wait() {
                        Ok(Some(status)) => {
                            let code = status.code().unwrap_or(-1);
                            map.remove(&tid_done);
                            Some(code)
                        }
                        Ok(None) => None,
                        Err(_) => {
                            map.remove(&tid_done);
                            Some(-1)
                        }
                    },
                    None => return,
                }
            };
            if let Some(code) = finished {
                emit_chunk(
                    &app_done,
                    &tid_done,
                    &path_done,
                    "system",
                    &format!("[exit {code}]"),
                );
                return;
            }
        }
    });

    Ok(())
}
