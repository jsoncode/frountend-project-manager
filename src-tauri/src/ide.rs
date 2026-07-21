use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeConfig {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub args_template: String,
    pub enabled: bool,
    #[serde(default)]
    pub builtin: bool,
    /// Absolute path to icon image (png/jpg/ico/webp/svg).
    #[serde(default)]
    pub icon_path: Option<String>,
}

/// Fast defaults for first launch — no PATH scans, no console flashes.
pub fn default_ides() -> Vec<IdeConfig> {
    vec![
        IdeConfig {
            id: "vscode".into(),
            name: "VS Code".into(),
            executable: "code".into(),
            args_template: "{path}".into(),
            enabled: true,
            builtin: true,
            icon_path: None,
        },
        IdeConfig {
            id: "webstorm".into(),
            name: "WebStorm".into(),
            executable: "webstorm".into(),
            args_template: "{path}".into(),
            enabled: true,
            builtin: true,
            icon_path: None,
        },
        IdeConfig {
            id: "cursor".into(),
            name: "Cursor".into(),
            executable: "cursor".into(),
            args_template: "{path}".into(),
            enabled: true,
            builtin: true,
            icon_path: None,
        },
    ]
}

fn first_existing(candidates: &[&str]) -> Option<String> {
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn detect_vscode() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").ok();
        let mut candidates = Vec::new();
        if let Some(local) = local {
            candidates.push(format!(
                r"{local}\Programs\Microsoft VS Code\Code.exe"
            ));
            candidates.push(format!(
                r"{local}\Programs\Microsoft VS Code\bin\code.cmd"
            ));
        }
        candidates.push(r"C:\Program Files\Microsoft VS Code\Code.exe".into());
        candidates.push(r"C:\Program Files\Microsoft VS Code\bin\code.cmd".into());
        let refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();
        if let Some(p) = first_existing(&refs) {
            return Some(p);
        }
    }
    which_cmd("code")
}

fn detect_cursor() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").ok();
        let mut candidates = Vec::new();
        if let Some(local) = local {
            candidates.push(format!(r"{local}\Programs\cursor\Cursor.exe"));
            candidates.push(format!(
                r"{local}\Programs\cursor\resources\app\bin\cursor.cmd"
            ));
        }
        let refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();
        if let Some(p) = first_existing(&refs) {
            return Some(p);
        }
    }
    which_cmd("cursor")
}

fn detect_webstorm() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").ok();
        if let Some(local) = local {
            let toolbox = PathBuf::from(format!(r"{local}\JetBrains\Toolbox\apps\WebStorm"));
            if toolbox.is_dir() {
                // Only scan one level of version folders — avoid walking huge trees.
                if let Ok(walker) = fs::read_dir(&toolbox) {
                    for entry in walker.flatten().take(12) {
                        let bin = entry.path().join("bin").join("webstorm64.exe");
                        if bin.exists() {
                            return Some(bin.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }
    which_cmd("webstorm")
}

fn which_cmd(name: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("where");
        cmd.arg(name)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        let output = cmd.output().ok()?;
        if !output.status.success() {
            return None;
        }
        let line = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()?
            .trim()
            .to_string();
        if line.is_empty() {
            None
        } else {
            Some(line)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("which").arg(name).output().ok()?;
        if !output.status.success() {
            return None;
        }
        let line = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if line.is_empty() {
            None
        } else {
            Some(line)
        }
    }
}

pub fn detect_ides() -> Vec<IdeConfig> {
    vec![
        IdeConfig {
            id: "vscode".into(),
            name: "VS Code".into(),
            executable: detect_vscode().unwrap_or_else(|| "code".into()),
            args_template: "{path}".into(),
            enabled: true,
            builtin: true,
            icon_path: None,
        },
        IdeConfig {
            id: "webstorm".into(),
            name: "WebStorm".into(),
            executable: detect_webstorm().unwrap_or_else(|| "webstorm".into()),
            args_template: "{path}".into(),
            enabled: true,
            builtin: true,
            icon_path: None,
        },
        IdeConfig {
            id: "cursor".into(),
            name: "Cursor".into(),
            executable: detect_cursor().unwrap_or_else(|| "cursor".into()),
            args_template: "{path}".into(),
            enabled: true,
            builtin: true,
            icon_path: None,
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledEditor {
    pub name: String,
    pub executable: String,
    /// True when the executable path exists on disk.
    pub available: bool,
}

fn push_unique(out: &mut Vec<InstalledEditor>, name: &str, executable: String) {
    let exe = executable.trim().to_string();
    if exe.is_empty() {
        return;
    }
    if out
        .iter()
        .any(|e| e.executable.eq_ignore_ascii_case(&exe))
    {
        return;
    }
    let resolved = if PathBuf::from(&exe).is_file() {
        exe
    } else if let Some(found) = which_cmd(&exe) {
        found
    } else {
        exe
    };
    let available = PathBuf::from(&resolved).is_file();
    out.push(InstalledEditor {
        name: name.trim().to_string(),
        executable: resolved,
        available,
    });
}

fn known_path_editors() -> Vec<InstalledEditor> {
    let mut out = Vec::new();
    let catalog: &[(&str, Option<String>)] = &[
        ("VS Code", detect_vscode()),
        ("Cursor", detect_cursor()),
        ("WebStorm", detect_webstorm()),
        ("VSCodium", {
            #[cfg(target_os = "windows")]
            {
                let local = std::env::var("LOCALAPPDATA").ok();
                let mut c = Vec::new();
                if let Some(local) = &local {
                    c.push(format!(r"{local}\Programs\VSCodium\VSCodium.exe"));
                }
                c.push(r"C:\Program Files\VSCodium\VSCodium.exe".into());
                let refs: Vec<&str> = c.iter().map(|s| s.as_str()).collect();
                first_existing(&refs).or_else(|| which_cmd("codium"))
            }
            #[cfg(not(target_os = "windows"))]
            {
                which_cmd("codium")
            }
        }),
        ("Sublime Text", {
            #[cfg(target_os = "windows")]
            {
                first_existing(&[
                    r"C:\Program Files\Sublime Text\sublime_text.exe",
                    r"C:\Program Files\Sublime Text 3\sublime_text.exe",
                    r"C:\Program Files\Sublime Text 4\sublime_text.exe",
                ])
                .or_else(|| which_cmd("subl"))
            }
            #[cfg(not(target_os = "windows"))]
            {
                which_cmd("subl").or_else(|| which_cmd("sublime_text"))
            }
        }),
        ("Zed", {
            #[cfg(target_os = "windows")]
            {
                let local = std::env::var("LOCALAPPDATA").ok();
                let mut c = Vec::new();
                if let Some(local) = &local {
                    c.push(format!(r"{local}\Programs\Zed\Zed.exe"));
                }
                let refs: Vec<&str> = c.iter().map(|s| s.as_str()).collect();
                first_existing(&refs).or_else(|| which_cmd("zed"))
            }
            #[cfg(not(target_os = "windows"))]
            {
                which_cmd("zed")
            }
        }),
        ("Windsurf", {
            #[cfg(target_os = "windows")]
            {
                let local = std::env::var("LOCALAPPDATA").ok();
                let mut c = Vec::new();
                if let Some(local) = &local {
                    c.push(format!(r"{local}\Programs\Windsurf\Windsurf.exe"));
                }
                let refs: Vec<&str> = c.iter().map(|s| s.as_str()).collect();
                first_existing(&refs).or_else(|| which_cmd("windsurf"))
            }
            #[cfg(not(target_os = "windows"))]
            {
                which_cmd("windsurf")
            }
        }),
        ("Trae", {
            #[cfg(target_os = "windows")]
            {
                let local = std::env::var("LOCALAPPDATA").ok();
                let mut c = Vec::new();
                if let Some(local) = &local {
                    c.push(format!(r"{local}\Programs\Trae\Trae.exe"));
                }
                let refs: Vec<&str> = c.iter().map(|s| s.as_str()).collect();
                first_existing(&refs).or_else(|| which_cmd("trae"))
            }
            #[cfg(not(target_os = "windows"))]
            {
                which_cmd("trae")
            }
        }),
        ("Notepad++", {
            #[cfg(target_os = "windows")]
            {
                first_existing(&[
                    r"C:\Program Files\Notepad++\notepad++.exe",
                    r"C:\Program Files (x86)\Notepad++\notepad++.exe",
                ])
            }
            #[cfg(not(target_os = "windows"))]
            {
                None
            }
        }),
    ];

    for (name, path) in catalog {
        if let Some(exe) = path {
            push_unique(&mut out, name, exe.clone());
        }
    }

    // JetBrains Toolbox apps (one level).
    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let toolbox = PathBuf::from(format!(r"{local}\JetBrains\Toolbox\apps"));
            let jet_apps = [
                ("IntelliJ IDEA", "idea64.exe"),
                ("WebStorm", "webstorm64.exe"),
                ("PyCharm", "pycharm64.exe"),
                ("PhpStorm", "phpstorm64.exe"),
                ("GoLand", "goland64.exe"),
                ("Rider", "rider64.exe"),
                ("CLion", "clion64.exe"),
                ("RustRover", "rustrover64.exe"),
            ];
            for (label, bin) in jet_apps {
                let candidates = [
                    toolbox.join(label.replace(' ', "")),
                    toolbox.join(label),
                    toolbox.join("IDEA-U"),
                    toolbox.join("IDEA-C"),
                    toolbox.join("WebStorm"),
                    toolbox.join("PyCharm-P"),
                    toolbox.join("PyCharm-C"),
                    toolbox.join("PhpStorm"),
                    toolbox.join("Goland"),
                    toolbox.join("Rider"),
                    toolbox.join("CLion"),
                    toolbox.join("RustRover"),
                ];
                'found: for dir in candidates {
                    if !dir.is_dir() {
                        continue;
                    }
                    if let Ok(walker) = fs::read_dir(&dir) {
                        for entry in walker.flatten().take(8) {
                            let exe = entry.path().join("bin").join(bin);
                            if exe.is_file() {
                                push_unique(
                                    &mut out,
                                    label,
                                    exe.to_string_lossy().to_string(),
                                );
                                break 'found;
                            }
                        }
                    }
                }
            }
        }
    }

    out
}

#[cfg(target_os = "windows")]
fn editors_from_powershell_pipeline() -> Vec<InstalledEditor> {
    // Registry Uninstall → filter editor keywords → DisplayIcon → JSON (piped, no window).
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$keys = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$keywords = @(
  'Visual Studio Code','VSCodium','Cursor','Windsurf','Trae','Zed',
  'WebStorm','IntelliJ','PyCharm','PhpStorm','GoLand','Rider','CLion','RustRover',
  'Android Studio','Sublime Text','Notepad++','Neovim','Helix','Fleet',
  'Antigravity','Void','Lapce','Eclipse','NetBeans','Kate','Geany'
)
Get-ItemProperty $keys |
  Where-Object { $_.DisplayName -and $_.DisplayIcon } |
  Where-Object {
    $n = $_.DisplayName
    @($keywords | Where-Object { $n -like ("*{0}*" -f $_) })[0]
  } |
  ForEach-Object {
    $exe = ($_.DisplayIcon -split ',')[0].Trim().Trim('"')
    if ($exe -and (Test-Path -LiteralPath $exe)) {
      [pscustomobject]@{ name = $_.DisplayName; executable = $exe; available = $true }
    }
  } |
  Sort-Object executable -Unique |
  ConvertTo-Json -Compress
"#;

    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ])
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::null())
    .creation_flags(CREATE_NO_WINDOW);

    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    if !output.status.success() && output.stdout.is_empty() {
        return Vec::new();
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() || raw == "null" {
        return Vec::new();
    }

    #[derive(Deserialize)]
    struct Row {
        name: String,
        executable: String,
        #[serde(default)]
        available: Option<bool>,
    }

    let rows: Vec<Row> = if raw.starts_with('[') {
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        serde_json::from_str::<Row>(&raw)
            .map(|r| vec![r])
            .unwrap_or_default()
    };

    rows.into_iter()
        .filter_map(|r| {
            let exe = r.executable.trim().to_string();
            if exe.is_empty() {
                return None;
            }
            Some(InstalledEditor {
                name: r.name.trim().to_string(),
                executable: exe.clone(),
                available: r.available.unwrap_or_else(|| PathBuf::from(&exe).is_file()),
            })
        })
        .collect()
}

/// List installed editors: known paths + Windows Uninstall registry via PowerShell pipeline.
pub fn list_installed_editors() -> Vec<InstalledEditor> {
    let mut out = known_path_editors();

    #[cfg(target_os = "windows")]
    {
        for row in editors_from_powershell_pipeline() {
            push_unique(&mut out, &row.name, row.executable);
        }
    }

    out.sort_by(|a, b| {
        b.available
            .cmp(&a.available)
            .then(a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });
    out
}

fn ide_icons_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("ide-icons");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn normalize_ext(ext: &str) -> String {
    let e = ext.trim().trim_start_matches('.').to_lowercase();
    match e.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "ico" | "svg" | "bmp" => e,
        _ => "png".into(),
    }
}

/// Copy an image into the app cache and return the cached absolute path.
pub fn import_ide_icon(app: &tauri::AppHandle, source_path: &str) -> Result<String, String> {
    let src = PathBuf::from(source_path.trim());
    if !src.is_file() {
        return Err(format!("Icon file not found: {source_path}"));
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(normalize_ext)
        .unwrap_or_else(|| "png".into());
    let dest = ide_icons_dir(app)?.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// Persist uploaded image bytes into the app cache.
pub fn import_ide_icon_bytes(
    app: &tauri::AppHandle,
    bytes: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("Empty icon bytes".into());
    }
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Icon too large (max 8MB)".into());
    }
    let ext = normalize_ext(&ext);
    let dest = ide_icons_dir(app)?.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// Prefer a real .exe/.ico next to .cmd/.bat launchers when present.
fn resolve_icon_source(executable: &str) -> Option<PathBuf> {
    let p = PathBuf::from(executable.trim());
    if !p.exists() {
        return None;
    }
    let lower = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(lower.as_str(), "exe" | "ico" | "dll") {
        return Some(p);
    }
    // code.cmd → try sibling Code.exe / Cursor.exe in parent dirs
    if let Some(parent) = p.parent() {
        let names = [
            "Code.exe",
            "Cursor.exe",
            "VSCodium.exe",
            "Windsurf.exe",
            "Trae.exe",
            "Zed.exe",
            "sublime_text.exe",
            "notepad++.exe",
        ];
        for name in names {
            let cand = parent.join(name);
            if cand.is_file() {
                return Some(cand);
            }
            if let Some(grand) = parent.parent() {
                let cand = grand.join(name);
                if cand.is_file() {
                    return Some(cand);
                }
            }
        }
    }
    Some(p)
}

#[cfg(target_os = "windows")]
fn extract_associated_icon_png_bytes(source: &PathBuf) -> Result<Vec<u8>, String> {
    let path = source.to_string_lossy().replace('\'', "''");
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$p = '{path}'
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($p)
if ($null -eq $icon) {{ throw 'no icon' }}
try {{
  $bmp = $icon.ToBitmap()
  try {{
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    [Convert]::ToBase64String($ms.ToArray())
  }} finally {{ $bmp.Dispose() }}
}} finally {{ $icon.Dispose() }}
"#
    );

    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ])
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped())
    .creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Extract icon failed: {err}"));
    }
    let b64 = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if b64.is_empty() {
        return Err("Extract icon returned empty data".into());
    }
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| e.to_string())
}

/// Extract the OS-associated icon from an executable and cache as PNG.
pub fn extract_ide_icon_from_exe(
    app: &tauri::AppHandle,
    executable: &str,
) -> Result<String, String> {
    let source = resolve_icon_source(executable)
        .ok_or_else(|| format!("Executable not found: {executable}"))?;

    #[cfg(target_os = "windows")]
    {
        let bytes = extract_associated_icon_png_bytes(&source)?;
        return import_ide_icon_bytes(app, bytes, "png".into());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, source);
        Err("Icon extraction from executables is only supported on Windows".into())
    }
}

pub fn open_in_ide(ide: &IdeConfig, project_path: &str) -> Result<(), String> {
    if !ide.enabled {
        return Err(format!("{} is disabled", ide.name));
    }
    let exe = ide.executable.trim();
    if exe.is_empty() {
        return Err(format!("{} executable is empty", ide.name));
    }

    let args: Vec<String> = ide
        .args_template
        .split_whitespace()
        .map(|part| part.replace("{path}", project_path))
        .collect();

    let mut cmd = Command::new(exe);
    cmd.args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    {
        // Only hide console for script launchers; GUI .exe should open normally.
        let lower = exe.to_ascii_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
    }
    cmd.spawn().map_err(|e| {
        format!(
            "Failed to open {} with {}: {e}",
            project_path, ide.name
        )
    })?;
    Ok(())
}
