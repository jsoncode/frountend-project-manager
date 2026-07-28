use serde::{Deserialize, Serialize};
use serde_json::Map as JsonMap;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub folder_name: String,
    pub path: String,
    pub pkg_name: Option<String>,
    /// First non-empty line of README.md (markdown heading markers stripped).
    pub display_name: Option<String>,
    pub frameworks: Vec<String>,
    /// Preserves package.json scripts key order.
    pub scripts: JsonMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetails {
    pub summary: ProjectSummary,
    pub package_manager: String,
}

const FRAMEWORKS: &[(&str, &str)] = &[
    ("react", "react"),
    ("vue", "vue"),
    ("next", "next"),
    ("nuxt", "nuxt"),
    ("@angular/core", "angular"),
    ("svelte", "svelte"),
    ("solid-js", "solid"),
];

fn read_package_json(dir: &Path) -> Option<serde_json::Value> {
    let path = dir.join("package.json");
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Strip markdown AT / emphasis wrappers from a README title line.
fn strip_readme_title_line(line: &str) -> String {
    let mut s = line.trim();
    // AT headings: # ## ### …
    while s.starts_with('#') {
        s = s[1..].trim_start();
    }
    // Simple emphasis wrappers
    s = s.trim_matches(|c: char| c == '*' || c == '_' || c == '`');
    s.trim().to_string()
}

/// Read first non-empty line of README.md / readme.md as a display title.
fn read_readme_display_name(dir: &Path) -> Option<String> {
    const CANDIDATES: &[&str] = &["README.md", "readme.md", "Readme.md"];
    for name in CANDIDATES {
        let path = dir.join(name);
        if !path.is_file() {
            continue;
        }
        let raw = fs::read(&path).ok()?;
        let text = crate::console_decode::decode_bytes(&raw);
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
        for line in text.lines() {
            let title = strip_readme_title_line(line);
            if !title.is_empty() {
                // Cap absurd first lines (e.g. huge badges / HTML).
                if title.chars().count() > 80 {
                    return None;
                }
                return Some(title);
            }
        }
    }
    None
}

fn detect_frameworks(pkg: &serde_json::Value) -> Vec<String> {
    let mut names = BTreeSet::new();
    for key in ["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(obj) = pkg.get(key).and_then(|v| v.as_object()) {
            for (dep, _) in obj {
                names.insert(dep.to_lowercase());
            }
        }
    }
    let mut found = Vec::new();
    for (dep, id) in FRAMEWORKS {
        if names.contains(*dep) {
            found.push((*id).to_string());
        }
    }
    found
}

fn extract_scripts(pkg: &serde_json::Value) -> JsonMap<String, serde_json::Value> {
    let mut map = JsonMap::new();
    if let Some(obj) = pkg.get("scripts").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                map.insert(k.clone(), serde_json::Value::String(s.to_string()));
            }
        }
    }
    map
}

fn detect_package_manager(dir: &Path) -> String {
    if dir.join("pnpm-lock.yaml").exists() {
        "pnpm".into()
    } else if dir.join("yarn.lock").exists() {
        "yarn".into()
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        "bun".into()
    } else if dir.join("package-lock.json").exists() {
        "npm".into()
    } else {
        "npm".into()
    }
}

/// Workspace child folders that should appear as projects.
/// Skips hidden dirs (`.git`, `.vscode`, …) and common non-project names.
fn is_listable_project_dir(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    let name = match path.file_name().and_then(|s| s.to_str()) {
        Some(n) if !n.is_empty() => n,
        _ => return false,
    };
    if name.starts_with('.') {
        return false;
    }
    !name.eq_ignore_ascii_case("node_modules")
}

fn summary_from_dir(dir: PathBuf) -> Option<ProjectSummary> {
    if !is_listable_project_dir(&dir) {
        return None;
    }
    let folder_name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| dir.to_string_lossy().to_string());
    let pkg = read_package_json(&dir);
    Some(ProjectSummary {
        folder_name,
        path: dir.to_string_lossy().to_string(),
        pkg_name: pkg
            .as_ref()
            .and_then(|p| p.get("name"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        display_name: read_readme_display_name(&dir),
        frameworks: pkg
            .as_ref()
            .map(detect_frameworks)
            .unwrap_or_default(),
        scripts: pkg
            .as_ref()
            .map(extract_scripts)
            .unwrap_or_default(),
    })
}

pub fn list_projects(workspace: &str) -> Result<Vec<ProjectSummary>, String> {
    let root = PathBuf::from(workspace);
    if !root.is_dir() {
        return Err(format!("Workspace not found: {workspace}"));
    }
    let mut projects = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(summary) = summary_from_dir(path) {
            projects.push(summary);
        }
    }
    projects.sort_by(|a, b| a.folder_name.cmp(&b.folder_name));
    Ok(projects)
}

pub fn scan_project(path: &str) -> Result<ProjectDetails, String> {
    let dir = PathBuf::from(path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    let summary = summary_from_dir(dir.clone()).ok_or_else(|| {
        format!("Not a project directory: {path}")
    })?;
    Ok(ProjectDetails {
        package_manager: detect_package_manager(&dir),
        summary,
    })
}
