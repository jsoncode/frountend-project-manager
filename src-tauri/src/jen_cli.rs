//! jen-cli integration: config files, resource shim dir, user PATH, pty env.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const SERVERS_FILE: &str = "jenkins.config.json";
const DEFAULTS_FILE: &str = "jen-cli.defaults.json";
const PATH_FLAG_FILE: &str = "jen-cli.path-enabled.json";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

/// Cached node probe — settings open must not re-spawn every time.
static NODE_PROBE: Mutex<Option<(bool, Option<String>)>> = Mutex::new(None);

/// Cached Windows user Path (registry) for PTY env merge.
static USER_PATH_CACHE: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法解析应用配置目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Strip Windows `\\?\` / `\\?\UNC\` extended prefixes. Putting those in PATH
/// makes cmd/PowerShell report "The system cannot find the path specified."
fn normalize_fs_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = path.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path
}

fn try_canonicalize(path: &Path) -> PathBuf {
    fs::canonicalize(path)
        .map(normalize_fs_path)
        .unwrap_or_else(|_| normalize_fs_path(path.to_path_buf()))
}

fn is_jen_cli_root(dir: &Path) -> bool {
    dir.join("bin").join("jen-cli.mjs").is_file()
}

/// Directory that should be prepended to PATH (Windows: `path/` with only .cmd/.ps1).
fn path_inject_dir(root: &Path) -> PathBuf {
    let win_path = root.join("path");
    if cfg!(windows) && win_path.join("jen-cli.cmd").is_file() {
        return try_canonicalize(&win_path);
    }
    try_canonicalize(root)
}

/// Resolve vendored jen-cli **root** (contains bin/ + lib/).
pub fn cli_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(res) = app.path().resource_dir() {
        for candidate in [
            res.join("jen-cli"),
            res.join("resources").join("jen-cli"),
            res.join("vendor").join("jen-cli"),
        ] {
            if candidate.is_dir() && is_jen_cli_root(&candidate) {
                return Ok(try_canonicalize(&candidate));
            }
        }
    }

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vendor/jen-cli");
    if is_jen_cli_root(&dev) {
        return Ok(try_canonicalize(&dev));
    }

    Err("找不到内置 jen-cli 资源目录".into())
}

/// Resolve PATH shim directory (dev/prod).
pub fn shim_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(path_inject_dir(&cli_root(app)?))
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
    let dir = cli_root(app)?;
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
                "paramKeys": {},
                "paramDefaults": {
                    "branch": "uat5",
                    "NodeVersion": "v24.12.0",
                    "INSTALL_COMMAND_ACTIVE": "pnpm i",
                    "BUILD_COMMAND_ACTIVE": "pnpm build:uat",
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

fn git_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

pub fn detect_node() -> (bool, Option<String>) {
    if let Ok(guard) = NODE_PROBE.lock() {
        if let Some(cached) = guard.as_ref() {
            return cached.clone();
        }
    }

    let mut cmd = Command::new("node");
    cmd.arg("-v");
    git_no_window(&mut cmd);
    let result = match cmd.output() {
        Ok(o) if o.status.success() => {
            let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
            (true, Some(v))
        }
        _ => (false, None),
    };

    if let Ok(mut guard) = NODE_PROBE.lock() {
        *guard = Some(result.clone());
    }
    result
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

#[cfg(windows)]
fn cached_user_path() -> String {
    let mut guard = USER_PATH_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(user_path_get().unwrap_or_default());
    }
    guard.clone().unwrap_or_default()
}

/// Merge path fragments (later sources fill gaps; first wins for order).
fn merge_path_parts(parts: &[String]) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for p in parts {
        for seg in p.split(';') {
            let t = seg.trim();
            if t.is_empty() {
                continue;
            }
            let key = t.to_lowercase();
            if seen.insert(key) {
                out.push(t.to_string());
            }
        }
    }
    out.join(";")
}

/// Prepend shim dir to PATH and set config env vars for a child process.
pub fn apply_pty_env(app: &AppHandle, cmd: &mut portable_pty::CommandBuilder) {
    let _ = ensure_configs(app);
    if let Ok(shim) = shim_dir(app) {
        let shim_s = normalize_fs_path(shim).to_string_lossy().into_owned();
        let path_key = if cfg!(windows) { "Path" } else { "PATH" };

        #[cfg(windows)]
        let current = {
            let process = std::env::var_os("PATH")
                .or_else(|| std::env::var_os("Path"))
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            // Explorer-launched apps often miss User PATH (nvm node etc.).
            merge_path_parts(&[shim_s.clone(), cached_user_path(), process])
        };
        #[cfg(not(windows))]
        let current = {
            let process = std::env::var_os("PATH")
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            format!("{shim_s}:{process}")
        };

        cmd.env(path_key, &current);
        #[cfg(windows)]
        cmd.env("PATH", &current);
    }
    if let Ok(p) = servers_path(app) {
        cmd.env(
            "JENKINS_CONFIG_PATH",
            normalize_fs_path(p).to_string_lossy().as_ref(),
        );
    }
    if let Ok(p) = defaults_path(app) {
        cmd.env(
            "FPM_JEN_CLI_DEFAULTS",
            normalize_fs_path(p).to_string_lossy().as_ref(),
        );
    }
}

#[cfg(windows)]
fn user_path_get() -> Result<String, String> {
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path','User')",
    ]);
    git_no_window(&mut cmd);
    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(windows)]
fn user_path_set(value: &str) -> Result<(), String> {
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Environment]::SetEnvironmentVariable('Path', $env:FPM_NEW_USER_PATH, 'User')",
    ])
    .env("FPM_NEW_USER_PATH", value);
    git_no_window(&mut cmd);
    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "写入用户 PATH 失败".into()
        } else {
            err
        });
    }
    // Refresh cache so new PTYs see the change.
    if let Ok(mut guard) = USER_PATH_CACHE.lock() {
        *guard = Some(value.to_string());
    }
    Ok(())
}

#[cfg(windows)]
fn normalize_dir(p: &Path) -> String {
    try_canonicalize(p)
        .to_string_lossy()
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
        // Also strip legacy root shim if user enabled PATH before path/ subdir existed.
        let legacy_root = cli_root(app)
            .ok()
            .map(|r| normalize_dir(&r).to_lowercase());
        let mut next: Vec<String> = parts
            .into_iter()
            .filter(|p| {
                let pl = p.to_lowercase();
                pl != target_l && legacy_root.as_ref().map(|l| l != &pl).unwrap_or(true)
            })
            .collect();
        if enabled {
            next.insert(0, target);
        }
        user_path_set(&next.join(";"))?;
    }

    #[cfg(not(windows))]
    {
        let _ = (&shim, enabled);
    }

    write_path_enabled(app, enabled)?;
    Ok(())
}

/// Warm caches used by settings / first PTY (node probe, user PATH).
pub fn warmup_caches() {
    let _ = detect_node();
    #[cfg(windows)]
    {
        let _ = cached_user_path();
    }
}
