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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledEditor {
    pub name: String,
    pub executable: String,
    /// True when the executable path exists on disk.
    pub available: bool,
}

/// One probe rule: display name, PATH cli names, Windows path templates, registry keywords.
#[derive(Clone)]
struct IdeProbe {
    id: &'static str,
    name: &'static str,
    /// `where` / `which` names
    cli: &'static [&'static str],
    /// Path templates with `%LOCALAPPDATA%` / `%PROGRAMFILES%` / `%USERPROFILE%`
    win_paths: &'static [&'static str],
    /// JetBrains Toolbox folder names under `%LOCALAPPDATA%\JetBrains\Toolbox\apps`
    toolbox_dirs: &'static [&'static str],
    /// Binary under toolbox version `\bin\`
    toolbox_bin: Option<&'static str>,
    /// Uninstall DisplayName keywords
    keywords: &'static [&'static str],
}

/// Built-in catalog. Extend at runtime via `FPM_IDE_EXTRA` / `FPM_IDE_KEYWORDS`.
///
/// `FPM_IDE_EXTRA` format (semicolon-separated):
///   `Name|cli|path1,path2;Other|cli2|%LOCALAPPDATA%\Programs\Other\Other.exe`
/// `FPM_IDE_KEYWORDS` (comma-separated) adds Uninstall registry match keywords.
const BUILTIN_PROBES: &[IdeProbe] = &[
    IdeProbe {
        id: "vscode",
        name: "VS Code",
        cli: &["code"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe",
            r"%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd",
            r"%PROGRAMFILES%\Microsoft VS Code\Code.exe",
            r"%PROGRAMFILES%\Microsoft VS Code\bin\code.cmd",
        ],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["Visual Studio Code"],
    },
    IdeProbe {
        id: "cursor",
        name: "Cursor",
        cli: &["cursor"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\cursor\Cursor.exe",
            r"%LOCALAPPDATA%\Programs\Cursor\Cursor.exe",
            r"%LOCALAPPDATA%\Programs\cursor\resources\app\bin\cursor.cmd",
        ],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["Cursor"],
    },
    IdeProbe {
        id: "webstorm",
        name: "WebStorm",
        cli: &["webstorm", "webstorm64"],
        win_paths: &[],
        toolbox_dirs: &["WebStorm"],
        toolbox_bin: Some("webstorm64.exe"),
        keywords: &["WebStorm"],
    },
    IdeProbe {
        id: "pycharm",
        name: "PyCharm",
        cli: &["pycharm", "pycharm64"],
        win_paths: &[],
        toolbox_dirs: &["PyCharm-P", "PyCharm-C", "PyCharm"],
        toolbox_bin: Some("pycharm64.exe"),
        keywords: &["PyCharm"],
    },
    IdeProbe {
        id: "trae",
        name: "Trae",
        cli: &["trae"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\Trae\Trae.exe",
            r"%LOCALAPPDATA%\Programs\trae\Trae.exe",
            r"%LOCALAPPDATA%\Programs\Trae\bin\trae.cmd",
        ],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["Trae"],
    },
    IdeProbe {
        id: "trae-work",
        name: "Trae Work",
        cli: &["trae-work", "traework"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\Trae Work\Trae Work.exe",
            r"%LOCALAPPDATA%\Programs\TraeWork\TraeWork.exe",
            r"%LOCALAPPDATA%\Programs\Trae Work\TraeWork.exe",
            r"%LOCALAPPDATA%\Programs\TRAE Work\TRAE Work.exe",
        ],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["Trae Work", "TRAE Work"],
    },
    IdeProbe {
        id: "qoder",
        name: "Qoder",
        cli: &["qoder"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\Qoder\Qoder.exe",
            r"%LOCALAPPDATA%\Programs\qoder\Qoder.exe",
            r"%LOCALAPPDATA%\Qoder\Qoder.exe",
        ],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["Qoder"],
    },
    IdeProbe {
        id: "workbuddy",
        name: "WorkBuddy",
        cli: &["workbuddy"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\WorkBuddy\WorkBuddy.exe",
            r"%LOCALAPPDATA%\Programs\workbuddy\WorkBuddy.exe",
            r"%LOCALAPPDATA%\WorkBuddy\WorkBuddy.exe",
            r"%USERPROFILE%\.workbuddy\WorkBuddy.exe",
        ],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["WorkBuddy"],
    },
    IdeProbe {
        id: "codebuddy",
        name: "CodeBuddy",
        cli: &["codebuddy"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\CodeBuddy\CodeBuddy.exe",
            r"%LOCALAPPDATA%\Programs\codebuddy\CodeBuddy.exe",
            r"%LOCALAPPDATA%\codebuddy\CodeBuddy.exe",
            r"%LOCALAPPDATA%\codebuddy\bin\codebuddy.exe",
            r"%USERPROFILE%\.codebuddy\CodeBuddy.exe",
        ],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["CodeBuddy"],
    },
    IdeProbe {
        id: "chatgpt",
        name: "ChatGPT",
        cli: &["chatgpt"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\ChatGPT\ChatGPT.exe",
            r"%LOCALAPPDATA%\ChatGPT\ChatGPT.exe",
            r"%LOCALAPPDATA%\Programs\OpenAI ChatGPT\ChatGPT.exe",
        ],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["ChatGPT"],
    },
    IdeProbe {
        id: "codex",
        name: "Codex",
        cli: &["codex"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\Codex\Codex.exe",
            r"%LOCALAPPDATA%\Programs\OpenAI Codex\Codex.exe",
            r"%LOCALAPPDATA%\codex\codex.exe",
            r"%USERPROFILE%\.local\bin\codex.exe",
            r"%USERPROFILE%\.codex\bin\codex.exe",
        ],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["Codex", "OpenAI Codex"],
    },
    IdeProbe {
        id: "windsurf",
        name: "Windsurf",
        cli: &["windsurf"],
        win_paths: &[r"%LOCALAPPDATA%\Programs\Windsurf\Windsurf.exe"],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["Windsurf"],
    },
    IdeProbe {
        id: "vscodium",
        name: "VSCodium",
        cli: &["codium"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\VSCodium\VSCodium.exe",
            r"%PROGRAMFILES%\VSCodium\VSCodium.exe",
        ],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["VSCodium"],
    },
];

/// Fast defaults for first launch — short CLI names (PATH may resolve later).
pub fn default_ides() -> Vec<IdeConfig> {
    BUILTIN_PROBES
        .iter()
        .take(4)
        .map(|p| IdeConfig {
            id: p.id.into(),
            name: p.name.into(),
            executable: p.cli.first().copied().unwrap_or(p.id).into(),
            args_template: "{path}".into(),
            enabled: true,
            builtin: true,
            icon_path: None,
        })
        .collect()
}

fn env_var_ci(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|s| !s.trim().is_empty())
}

fn expand_path_template(raw: &str) -> String {
    let mut out = raw.to_string();
    let replacements: &[(&str, Option<String>)] = &[
        ("%LOCALAPPDATA%", env_var_ci("LOCALAPPDATA")),
        ("%APPDATA%", env_var_ci("APPDATA")),
        ("%PROGRAMFILES%", env_var_ci("PROGRAMFILES")),
        ("%PROGRAMFILES(X86)%", env_var_ci("PROGRAMFILES(X86)")),
        ("%USERPROFILE%", env_var_ci("USERPROFILE")),
        ("$LOCALAPPDATA", env_var_ci("LOCALAPPDATA")),
        ("$APPDATA", env_var_ci("APPDATA")),
        (
            "$HOME",
            env_var_ci("USERPROFILE").or_else(|| env_var_ci("HOME")),
        ),
    ];
    for (key, val) in replacements {
        if let Some(v) = val {
            out = out.replace(key, v);
        }
    }
    out
}

fn first_existing_path(candidates: &[String]) -> Option<String> {
    for c in candidates {
        let p = PathBuf::from(c);
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
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

fn find_toolbox_bin(dirs: &[&str], bin: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let local = env_var_ci("LOCALAPPDATA")?;
        let root = PathBuf::from(format!(r"{local}\JetBrains\Toolbox\apps"));
        if !root.is_dir() {
            return None;
        }
        for dir_name in dirs {
            let app_dir = root.join(dir_name);
            if !app_dir.is_dir() {
                continue;
            }
            if let Ok(walker) = fs::read_dir(&app_dir) {
                for entry in walker.flatten().take(12) {
                    let exe = entry.path().join("bin").join(bin);
                    if exe.is_file() {
                        return Some(exe.to_string_lossy().to_string());
                    }
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (dirs, bin);
        None
    }
}

fn resolve_probe(probe: &IdeProbe) -> Option<String> {
    if let Some(bin) = probe.toolbox_bin {
        if let Some(found) = find_toolbox_bin(probe.toolbox_dirs, bin) {
            return Some(found);
        }
    }

    let candidates: Vec<String> = probe
        .win_paths
        .iter()
        .map(|p| expand_path_template(p))
        .collect();
    if let Some(found) = first_existing_path(&candidates) {
        return Some(found);
    }

    for cli in probe.cli {
        if let Some(found) = which_cmd(cli) {
            return Some(found);
        }
    }
    None
}

/// Parse `FPM_IDE_EXTRA`: `Name|cli|path1,path2;Name2|cli2|pathA`
fn probes_from_env_extra() -> Vec<(String, String, Vec<String>, Vec<String>)> {
    let raw = match env_var_ci("FPM_IDE_EXTRA") {
        Some(v) => v,
        None => return Vec::new(),
    };
    let mut out = Vec::new();
    for entry in raw.split(';') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        let parts: Vec<&str> = entry.split('|').map(|s| s.trim()).collect();
        if parts.len() < 2 {
            continue;
        }
        let name = parts[0].to_string();
        let cli = parts[1].to_string();
        let paths: Vec<String> = parts
            .get(2)
            .unwrap_or(&"")
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(expand_path_template)
            .collect();
        let keywords = vec![name.clone()];
        out.push((name, cli, paths, keywords));
    }
    out
}

fn extra_keywords_from_env() -> Vec<String> {
    env_var_ci("FPM_IDE_KEYWORDS")
        .map(|s| {
            s.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect()
        })
        .unwrap_or_default()
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

    for probe in BUILTIN_PROBES {
        if let Some(exe) = resolve_probe(probe) {
            push_unique(&mut out, probe.name, exe);
        }
    }

    for (name, cli, paths, _) in probes_from_env_extra() {
        if let Some(exe) = first_existing_path(&paths).or_else(|| which_cmd(&cli)) {
            push_unique(&mut out, &name, exe);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let jet_apps = [
            (
                "IntelliJ IDEA",
                "idea64.exe",
                &["IDEA-U", "IDEA-C", "IntelliJ IDEA"][..],
            ),
            ("PhpStorm", "phpstorm64.exe", &["PhpStorm"][..]),
            ("GoLand", "goland64.exe", &["Goland", "GoLand"][..]),
            ("Rider", "rider64.exe", &["Rider"][..]),
            ("CLion", "clion64.exe", &["CLion"][..]),
            ("RustRover", "rustrover64.exe", &["RustRover"][..]),
        ];
        for (label, bin, dirs) in jet_apps {
            if let Some(exe) = find_toolbox_bin(dirs, bin) {
                push_unique(&mut out, label, exe);
            }
        }
    }

    out
}

fn all_registry_keywords() -> Vec<String> {
    let mut kw: Vec<String> = BUILTIN_PROBES
        .iter()
        .flat_map(|p| p.keywords.iter().map(|s| (*s).to_string()))
        .collect();
    for (name, _, _, kws) in probes_from_env_extra() {
        kw.push(name);
        kw.extend(kws);
    }
    kw.extend(extra_keywords_from_env());
    kw.extend(
        [
            "IntelliJ",
            "PhpStorm",
            "GoLand",
            "Rider",
            "CLion",
            "RustRover",
            "Android Studio",
            "Sublime Text",
            "Notepad++",
            "Neovim",
            "Zed",
            "Antigravity",
            "Void",
            "Lapce",
            "Fleet",
        ]
        .into_iter()
        .map(String::from),
    );
    kw.sort();
    kw.dedup();
    kw
}

#[cfg(target_os = "windows")]
fn editors_from_powershell_pipeline() -> Vec<InstalledEditor> {
    let keywords = all_registry_keywords();
    let kw_ps = keywords
        .iter()
        .map(|k| format!("'{}'", k.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",");

    let script = format!(
        r#"
$ErrorActionPreference = 'SilentlyContinue'
$keys = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$keywords = @({kw_ps})
Get-ItemProperty $keys |
  Where-Object {{ $_.DisplayName -and $_.DisplayIcon }} |
  Where-Object {{
    $n = $_.DisplayName
    @($keywords | Where-Object {{ $n -like ('*' + $_ + '*') }})[0]
  }} |
  ForEach-Object {{
    $exe = ($_.DisplayIcon -split ',')[0].Trim().Trim('"')
    if ($exe -and (Test-Path -LiteralPath $exe)) {{
      [pscustomobject]@{{ name = $_.DisplayName; executable = $exe; available = $true }}
    }}
  }} |
  Sort-Object executable -Unique |
  ConvertTo-Json -Compress
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

/// List installed editors: catalog paths + env extras + Windows Uninstall registry.
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

/// Detect available IDEs from the catalog (for「重新探测」).
pub fn detect_ides() -> Vec<IdeConfig> {
    let mut configs = Vec::new();
    for probe in BUILTIN_PROBES {
        if let Some(exe) = resolve_probe(probe) {
            configs.push(IdeConfig {
                id: probe.id.into(),
                name: probe.name.into(),
                executable: exe,
                args_template: "{path}".into(),
                enabled: true,
                builtin: true,
                icon_path: None,
            });
        }
    }
    for (name, cli, paths, _) in probes_from_env_extra() {
        if let Some(exe) = first_existing_path(&paths).or_else(|| which_cmd(&cli)) {
            let id = name
                .to_ascii_lowercase()
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect::<String>();
            configs.push(IdeConfig {
                id,
                name,
                executable: exe,
                args_template: "{path}".into(),
                enabled: true,
                builtin: false,
                icon_path: None,
            });
        }
    }
    if configs.is_empty() {
        return default_ides();
    }
    configs
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
            "TraeWork.exe",
            "Qoder.exe",
            "WorkBuddy.exe",
            "CodeBuddy.exe",
            "ChatGPT.exe",
            "Codex.exe",
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
