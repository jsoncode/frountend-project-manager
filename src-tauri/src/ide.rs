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

/// One probe rule: display name, PATH cli names, OS path templates, registry keywords.
#[derive(Clone)]
struct IdeProbe {
    id: &'static str,
    name: &'static str,
    /// `where` / `which` names
    cli: &'static [&'static str],
    /// Windows path templates (`%LOCALAPPDATA%` / `%PROGRAMFILES%` / …)
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    win_paths: &'static [&'static str],
    /// macOS path templates (`/Applications/…`, `$HOME/…`)
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    mac_paths: &'static [&'static str],
    /// JetBrains Toolbox folder names
    toolbox_dirs: &'static [&'static str],
    /// Binary under toolbox version `\bin\` (Windows often `*64.exe`)
    toolbox_bin: Option<&'static str>,
    /// Uninstall DisplayName / Applications folder keywords
    keywords: &'static [&'static str],
}

/// Built-in catalog. Extend at runtime via `FPM_IDE_EXTRA` / `FPM_IDE_KEYWORDS`.
///
/// `FPM_IDE_EXTRA` format (semicolon-separated):
///   `Name|cli|path1,path2;Other|cli2|%LOCALAPPDATA%\Programs\Other\Other.exe`
/// On macOS paths may be `/Applications/App.app` or `$HOME/Applications/App.app`.
/// `FPM_IDE_KEYWORDS` (comma-separated) adds Uninstall / Applications match keywords.
const BUILTIN_PROBES: &[IdeProbe] = &[
    IdeProbe {
        id: "vscode",
        name: "VS Code",
        cli: &["code"],
        win_paths: &[
            r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe",
            r"%PROGRAMFILES%\Microsoft VS Code\Code.exe",
        ],
        mac_paths: &[
            "/Applications/Visual Studio Code.app",
            "$HOME/Applications/Visual Studio Code.app",
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
        ],
        mac_paths: &["/Applications/Cursor.app", "$HOME/Applications/Cursor.app"],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["Cursor"],
    },
    IdeProbe {
        id: "webstorm",
        name: "WebStorm",
        cli: &["webstorm", "webstorm64"],
        win_paths: &[],
        mac_paths: &["/Applications/WebStorm.app", "$HOME/Applications/WebStorm.app"],
        toolbox_dirs: &["WebStorm"],
        toolbox_bin: Some("webstorm64.exe"),
        keywords: &["WebStorm"],
    },
    IdeProbe {
        id: "pycharm",
        name: "PyCharm",
        cli: &["pycharm", "pycharm64"],
        win_paths: &[],
        mac_paths: &[
            "/Applications/PyCharm.app",
            "/Applications/PyCharm CE.app",
            "$HOME/Applications/PyCharm.app",
            "$HOME/Applications/PyCharm CE.app",
        ],
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
        ],
        mac_paths: &["/Applications/Trae.app", "$HOME/Applications/Trae.app"],
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
        mac_paths: &[
            "/Applications/Trae Work.app",
            "/Applications/TraeWork.app",
            "$HOME/Applications/Trae Work.app",
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
        mac_paths: &["/Applications/Qoder.app", "$HOME/Applications/Qoder.app"],
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
        mac_paths: &[
            "/Applications/WorkBuddy.app",
            "$HOME/Applications/WorkBuddy.app",
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
        mac_paths: &[
            "/Applications/CodeBuddy.app",
            "$HOME/Applications/CodeBuddy.app",
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
        mac_paths: &["/Applications/ChatGPT.app", "$HOME/Applications/ChatGPT.app"],
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
        mac_paths: &[
            "/Applications/Codex.app",
            "$HOME/Applications/Codex.app",
            "$HOME/.local/bin/codex",
            "$HOME/.codex/bin/codex",
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
        mac_paths: &["/Applications/Windsurf.app", "$HOME/Applications/Windsurf.app"],
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
        mac_paths: &["/Applications/VSCodium.app", "$HOME/Applications/VSCodium.app"],
        toolbox_dirs: &[],
        toolbox_bin: None,
        keywords: &["VSCodium"],
    },
];

/// Fast defaults for first launch — start empty; user scans or adds IDEs.
pub fn default_ides() -> Vec<IdeConfig> {
    Vec::new()
}

/// On Windows, only real `.exe` paths are accepted (drop `.cmd` / `.bat` / bare CLI names).
fn is_accepted_executable(path: &str) -> bool {
    let path = path.trim();
    if path.is_empty() {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        PathBuf::from(path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        true
    }
}

/// Drop Windows non-`.exe` entries (legacy placeholders like `code` / `cursor.cmd`).
pub fn scrub_ides(ides: &mut Vec<IdeConfig>) -> bool {
    let before = ides.len();
    ides.retain(|ide| is_accepted_executable(&ide.executable));
    ides.len() != before
}

fn env_var_ci(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|s| !s.trim().is_empty())
}

fn expand_path_template(raw: &str) -> String {
    let mut out = raw.to_string();
    let home = env_var_ci("HOME").or_else(|| env_var_ci("USERPROFILE"));
    let replacements: &[(&str, Option<String>)] = &[
        ("%LOCALAPPDATA%", env_var_ci("LOCALAPPDATA")),
        ("%APPDATA%", env_var_ci("APPDATA")),
        ("%PROGRAMFILES%", env_var_ci("PROGRAMFILES")),
        ("%PROGRAMFILES(X86)%", env_var_ci("PROGRAMFILES(X86)")),
        ("%USERPROFILE%", env_var_ci("USERPROFILE").or_else(|| home.clone())),
        ("$LOCALAPPDATA", env_var_ci("LOCALAPPDATA")),
        ("$APPDATA", env_var_ci("APPDATA")),
        ("$HOME", home.clone()),
        ("$USERPROFILE", env_var_ci("USERPROFILE").or_else(|| home.clone())),
    ];
    for (key, val) in replacements {
        if let Some(v) = val {
            out = out.replace(key, v);
        }
    }
    out
}

fn is_launchable_path(p: &PathBuf) -> bool {
    if p.is_file() {
        return true;
    }
    #[cfg(target_os = "macos")]
    {
        // `.app` bundles are directories.
        if p.extension().and_then(|e| e.to_str()) == Some("app") && p.is_dir() {
            return true;
        }
    }
    false
}

fn first_existing_path(candidates: &[String]) -> Option<String> {
    for c in candidates {
        if !is_accepted_executable(c) {
            continue;
        }
        let p = PathBuf::from(c);
        if is_launchable_path(&p) {
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
        // Prefer a real .exe; ignore .cmd/.bat shims from PATH.
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .find(|line| !line.is_empty() && is_accepted_executable(line))
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

#[cfg(target_os = "macos")]
fn toolbox_bin_names(win_bin: &str) -> Vec<String> {
    let mut names = vec![win_bin.to_string()];
    let stem = win_bin
        .trim_end_matches(".exe")
        .trim_end_matches("64")
        .to_string();
    if !stem.is_empty() && stem != win_bin {
        names.push(stem.clone());
        names.push(format!("{stem}64"));
    }
    names.sort();
    names.dedup();
    names
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
    #[cfg(target_os = "macos")]
    {
        let home = env_var_ci("HOME")?;
        let root = PathBuf::from(format!(
            "{home}/Library/Application Support/JetBrains/Toolbox/apps"
        ));
        if !root.is_dir() {
            return None;
        }
        let bins = toolbox_bin_names(bin);
        for dir_name in dirs {
            let app_dir = root.join(dir_name);
            if !app_dir.is_dir() {
                continue;
            }
            if let Ok(walker) = fs::read_dir(&app_dir) {
                for entry in walker.flatten().take(16) {
                    let base = entry.path();
                    for name in &bins {
                        let cand = base.join("bin").join(name);
                        if cand.is_file() {
                            return Some(cand.to_string_lossy().to_string());
                        }
                    }
                    // Some Toolbox layouts ship a .app directly.
                    if let Ok(inner) = fs::read_dir(&base) {
                        for child in inner.flatten().take(8) {
                            let p = child.path();
                            if p.extension().and_then(|e| e.to_str()) == Some("app") && p.is_dir()
                            {
                                return Some(p.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }
        None
    }
    #[cfg(all(unix, not(target_os = "macos")))]
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

    let os_paths: &[&str] = {
        #[cfg(target_os = "windows")]
        {
            probe.win_paths
        }
        #[cfg(target_os = "macos")]
        {
            probe.mac_paths
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            // Prefer CLI on Linux; still allow mac-style absolute paths from env extras.
            &[]
        }
    };

    let candidates: Vec<String> = os_paths
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
    if exe.is_empty() || !is_accepted_executable(&exe) {
        return;
    }
    if out
        .iter()
        .any(|e| e.executable.eq_ignore_ascii_case(&exe))
    {
        return;
    }
    let resolved = if is_launchable_path(&PathBuf::from(&exe)) {
        exe
    } else if let Some(found) = which_cmd(&exe) {
        found
    } else {
        exe
    };
    if !is_accepted_executable(&resolved) {
        return;
    }
    let available = is_launchable_path(&PathBuf::from(&resolved));
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

    #[cfg(any(target_os = "windows", target_os = "macos"))]
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
        #[cfg(target_os = "macos")]
        {
            let mac_apps = [
                ("IntelliJ IDEA", "/Applications/IntelliJ IDEA.app"),
                ("IntelliJ IDEA CE", "/Applications/IntelliJ IDEA CE.app"),
                ("PhpStorm", "/Applications/PhpStorm.app"),
                ("GoLand", "/Applications/GoLand.app"),
                ("Rider", "/Applications/Rider.app"),
                ("CLion", "/Applications/CLion.app"),
                ("RustRover", "/Applications/RustRover.app"),
                ("Sublime Text", "/Applications/Sublime Text.app"),
                ("Zed", "/Applications/Zed.app"),
            ];
            for (label, path) in mac_apps {
                let p = PathBuf::from(path);
                if is_launchable_path(&p) {
                    push_unique(&mut out, label, path.to_string());
                }
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
            if exe.is_empty() || !is_accepted_executable(&exe) {
                return None;
            }
            Some(InstalledEditor {
                name: r.name.trim().to_string(),
                executable: exe.clone(),
                available: r.available.unwrap_or_else(|| is_launchable_path(&PathBuf::from(&exe))),
            })
        })
        .collect()
}

/// List installed editors: catalog paths + env extras + OS discovery.
pub fn list_installed_editors() -> Vec<InstalledEditor> {
    let mut out = known_path_editors();

    #[cfg(target_os = "windows")]
    {
        for row in editors_from_powershell_pipeline() {
            push_unique(&mut out, &row.name, row.executable);
        }
    }

    #[cfg(target_os = "macos")]
    {
        for row in editors_from_applications_folder() {
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

#[cfg(target_os = "macos")]
fn editors_from_applications_folder() -> Vec<InstalledEditor> {
    let keywords = all_registry_keywords();
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = env_var_ci("HOME") {
        roots.push(PathBuf::from(format!("{home}/Applications")));
    }
    let mut out = Vec::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("app") || !path.is_dir() {
                continue;
            }
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                continue;
            }
            let hit = keywords.iter().any(|k| {
                name.to_ascii_lowercase()
                    .contains(&k.to_ascii_lowercase())
            });
            if hit {
                out.push(InstalledEditor {
                    name: name.clone(),
                    executable: path.to_string_lossy().to_string(),
                    available: true,
                });
            }
        }
    }
    out
}

/// Detect available IDEs from the catalog (for「重新探测」).
pub fn detect_ides() -> Vec<IdeConfig> {
    let mut configs = Vec::new();
    for probe in BUILTIN_PROBES {
        if let Some(exe) = resolve_probe(probe) {
            if !is_accepted_executable(&exe) {
                continue;
            }
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
            if !is_accepted_executable(&exe) {
                continue;
            }
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
    #[cfg(target_os = "macos")]
    {
        if p.extension().and_then(|e| e.to_str()) == Some("app") && p.is_dir() {
            return Some(p);
        }
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

/// Extract the OS-associated icon from an executable / .app and cache as PNG.
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

    #[cfg(target_os = "macos")]
    {
        let bytes = extract_macos_app_icon_png_bytes(&source)?;
        return import_ide_icon_bytes(app, bytes, "png".into());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = (app, source);
        Err("从可执行文件提取图标目前仅支持 Windows / macOS".into())
    }
}

#[cfg(target_os = "macos")]
fn extract_macos_app_icon_png_bytes(source: &PathBuf) -> Result<Vec<u8>, String> {
    let app_bundle = if source.extension().and_then(|e| e.to_str()) == Some("app") {
        source.clone()
    } else if let Some(parent) = source.parent() {
        // …/App.app/Contents/MacOS/binary → App.app
        parent
            .parent()
            .and_then(|p| p.parent())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("app"))
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| source.clone())
    } else {
        source.clone()
    };

    let resources = app_bundle.join("Contents/Resources");
    let icns = if resources.is_dir() {
        fs::read_dir(&resources)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .find(|p| p.extension().and_then(|e| e.to_str()) == Some("icns"))
    } else {
        None
    }
    .ok_or_else(|| "未在 .app 中找到 .icns 图标".to_string())?;

    let tmp = std::env::temp_dir().join(format!(
        "fpm-icon-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    let status = Command::new("sips")
        .args([
            "-s",
            "format",
            "png",
            icns.to_str().unwrap_or_default(),
            "--out",
            tmp.to_str().unwrap_or_default(),
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("sips 转换图标失败: {e}"))?;
    if !status.success() {
        let _ = fs::remove_file(&tmp);
        return Err("sips 转换图标失败".into());
    }
    let bytes = fs::read(&tmp).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&tmp);
    if bytes.is_empty() {
        return Err("图标数据为空".into());
    }
    Ok(bytes)
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

    #[cfg(target_os = "macos")]
    {
        let path = PathBuf::from(exe);
        let is_app = path.extension().and_then(|e| e.to_str()) == Some("app");
        if is_app {
            let mut cmd = Command::new("open");
            cmd.arg("-na").arg(exe);
            if !args.is_empty() {
                cmd.arg("--args").args(&args);
            }
            cmd.stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|e| {
                    format!("Failed to open {} with {}: {e}", project_path, ide.name)
                })?;
            return Ok(());
        }
    }

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

/// Open a folder (or reveal a file) in the system file manager.
pub fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if !p.exists() {
        return Err(format!("路径不存在: {path}"));
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("explorer");
        if p.is_file() {
            cmd.arg(format!("/select,{}", p.to_string_lossy()));
        } else {
            cmd.arg(p.as_os_str());
        }
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("打开文件管理器失败: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        if p.is_file() {
            cmd.args(["-R", path]);
        } else {
            cmd.arg(path);
        }
        cmd.spawn()
            .map_err(|e| format!("打开 Finder 失败: {e}"))?;
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if p.is_file() {
            p.parent()
                .map(|x| x.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string())
        } else {
            path.to_string()
        };
        Command::new("xdg-open")
            .arg(&target)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("打开文件管理器失败: {e}"))?;
        Ok(())
    }
}
