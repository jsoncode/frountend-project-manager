//! jen-cli integration: config files, resource shim dir, user PATH, pty env.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

const SERVERS_FILE: &str = "jenkins.config.json";
const DEFAULTS_FILE: &str = "jen-cli.defaults.json";
const PATH_FLAG_FILE: &str = "jen-cli.path-enabled.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JenCliPaths {
    pub shim_dir: String,
    pub servers_config: String,
    pub defaults_config: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JenCliState {
    pub paths: JenCliPaths,
    pub servers: Value,
    pub defaults: Value,
    pub example_servers_json: String,
    pub path_enabled: bool,
    pub node_ok: bool,
    pub node_version: Option<String>,
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法解析应用配置目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Resolve vendored jen-cli directory (dev: repo vendor/, prod: resource_dir).
pub fn shim_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(res) = app.path().resource_dir() {
        for candidate in [
            res.join("jen-cli"),
            res.join("resources").join("jen-cli"),
            res.join("vendor").join("jen-cli"),
        ] {
            if candidate.is_dir() && candidate.join("bin").join("jen-cli.mjs").is_file() {
                return Ok(candidate);
            }
        }
    }

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vendor/jen-cli");
    if let Ok(canon) = fs::canonicalize(&dev) {
        if canon.join("bin").join("jen-cli.mjs").is_file() {
            return Ok(canon);
        }
    }
    if dev.join("bin").join("jen-cli.mjs").is_file() {
        return Ok(dev);
    }

    Err("找不到内置 jen-cli 资源目录".into())
}

fn servers_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(SERVERS_FILE))
}

fn defaults_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(DEFAULTS_FILE))
}

fn path_flag_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(PATH_FLAG_FILE))
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("读取失败 {}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("JSON 无效 {}: {e}", path.display()))
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, raw + "\n").map_err(|e| e.to_string())
}

fn bundled_example(app: &AppHandle, name: &str) -> Result<String, String> {
    let dir = shim_dir(app)?;
    let path = dir.join(name);
    fs::read_to_string(&path).map_err(|e| format!("读取示例失败 {}: {e}", path.display()))
}

fn default_servers_value(app: &AppHandle) -> Value {
    bundled_example(app, "jenkins.config.example.json")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| {
            json!({
                "defaultServer": "tx",
                "servers": {
                    "tx": {
                        "baseUrl": "https://jenkins.example.com",
                        "username": "your-user",
                        "apiToken": "your-api-token"
                    }
                }
            })
        })
}

fn default_defaults_value(app: &AppHandle) -> Value {
    bundled_example(app, "jen-cli.defaults.example.json")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| {
            json!({
                "cliDefaults": {
                    "server": "tx",
                    "job": "",
                    "intervalMs": 3000,
                    "console": true
                },
                "paramKeys": {
                    "branch": "branch",
                    "nodeVersion": "NodeVersion",
                    "installCommand": "INSTALL_COMMAND_ACTIVE",
                    "buildCommand": "BUILD_COMMAND_ACTIVE",
                    "project": "project"
                },
                "paramDefaults": {
                    "branch": "uat5",
                    "nodeVersion": "v24.12.0",
                    "installCommand": "pnpm i",
                    "buildCommand": "pnpm build:uat",
                    "project": ""
                },
                "presets": { "rules": [] }
            })
        })
}

/// Ensure user config files exist (placeholder only, no private tokens).
pub fn ensure_configs(app: &AppHandle) -> Result<(), String> {
    let sp = servers_path(app)?;
    if !sp.is_file() {
        write_json_file(&sp, &default_servers_value(app))?;
    }
    let dp = defaults_path(app)?;
    if !dp.is_file() {
        write_json_file(&dp, &default_defaults_value(app))?;
    }
    Ok(())
}

pub fn detect_node() -> (bool, Option<String>) {
    let output = Command::new("node").arg("-v").output();
    match output {
        Ok(o) if o.status.success() => {
            let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
            (true, Some(v))
        }
        _ => (false, None),
    }
}

fn read_path_enabled(app: &AppHandle) -> bool {
    path_flag_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.get("enabled").and_then(|x| x.as_bool()))
        .unwrap_or(false)
}

fn write_path_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    write_json_file(&path_flag_path(app)?, &json!({ "enabled": enabled }))
}

pub fn get_state(app: &AppHandle) -> Result<JenCliState, String> {
    ensure_configs(app)?;
    let shim = shim_dir(app)?;
    let servers_p = servers_path(app)?;
    let defaults_p = defaults_path(app)?;
    let (node_ok, node_version) = detect_node();
    let example = bundled_example(app, "jenkins.config.example.json").unwrap_or_else(|_| {
        serde_json::to_string_pretty(&default_servers_value(app)).unwrap_or_default()
    });

    Ok(JenCliState {
        paths: JenCliPaths {
            shim_dir: shim.to_string_lossy().into_owned(),
            servers_config: servers_p.to_string_lossy().into_owned(),
            defaults_config: defaults_p.to_string_lossy().into_owned(),
        },
        servers: read_json_file(&servers_p)?,
        defaults: read_json_file(&defaults_p)?,
        example_servers_json: example,
        path_enabled: read_path_enabled(app),
        node_ok,
        node_version,
    })
}

pub fn save_servers(app: &AppHandle, servers: Value) -> Result<(), String> {
    if !servers.get("servers").map(|s| s.is_object()).unwrap_or(false) {
        return Err("配置必须包含 servers 对象".into());
    }
    write_json_file(&servers_path(app)?, &servers)
}

pub fn save_defaults(app: &AppHandle, defaults: Value) -> Result<(), String> {
    write_json_file(&defaults_path(app)?, &defaults)
}

pub fn reset_servers_from_example(app: &AppHandle) -> Result<Value, String> {
    let v = default_servers_value(app);
    write_json_file(&servers_path(app)?, &v)?;
    Ok(v)
}

/// Prepend shim dir to PATH and set config env vars for a child process.
pub fn apply_pty_env(app: &AppHandle, cmd: &mut portable_pty::CommandBuilder) {
    let _ = ensure_configs(app);
    if let Ok(shim) = shim_dir(app) {
        let shim_s = shim.to_string_lossy();
        let path_key = if cfg!(windows) { "Path" } else { "PATH" };
        // portable-pty reads env case-insensitively on Windows for some shells;
        // set both common spellings.
        let current = std::env::var_os("PATH")
            .or_else(|| std::env::var_os("Path"))
            .unwrap_or_default();
        let mut new_path = shim_s.as_ref().to_string();
        new_path.push(if cfg!(windows) { ';' } else { ':' });
        new_path.push_str(&current.to_string_lossy());
        cmd.env(path_key, &new_path);
        #[cfg(windows)]
        cmd.env("PATH", &new_path);
    }
    if let Ok(p) = servers_path(app) {
        cmd.env("JENKINS_CONFIG_PATH", p.to_string_lossy().as_ref());
    }
    if let Ok(p) = defaults_path(app) {
        cmd.env("FPM_JEN_CLI_DEFAULTS", p.to_string_lossy().as_ref());
    }
}

#[cfg(windows)]
fn user_path_get() -> Result<String, String> {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            "[Environment]::GetEnvironmentVariable('Path','User')",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(windows)]
fn user_path_set(value: &str) -> Result<(), String> {
    // Pass via env to avoid quoting hell.
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            "[Environment]::SetEnvironmentVariable('Path', $env:FPM_NEW_USER_PATH, 'User')",
        ])
        .env("FPM_NEW_USER_PATH", value)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "写入用户 PATH 失败".into()
        } else {
            err
        });
    }
    Ok(())
}

#[cfg(windows)]
fn normalize_dir(p: &Path) -> String {
    fs::canonicalize(p)
        .unwrap_or_else(|_| p.to_path_buf())
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string()
}

pub fn set_path_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let shim = shim_dir(app)?;

    #[cfg(windows)]
    {
        let target = normalize_dir(&shim);
        let current = user_path_get()?;
        let parts: Vec<String> = current
            .split(';')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let target_l = target.to_lowercase();
        let mut next: Vec<String> = parts
            .into_iter()
            .filter(|p| p.to_lowercase() != target_l)
            .collect();
        if enabled {
            next.insert(0, target);
        }
        user_path_set(&next.join(";"))?;
    }

    #[cfg(not(windows))]
    {
        let _ = (&shim, enabled);
        // Non-Windows: skip permanent PATH; app terminal injection still works.
    }

    write_path_enabled(app, enabled)?;
    Ok(())
}
