use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub folder_name: String,
    pub path: String,
    pub pkg_name: Option<String>,
    pub pkg_version: Option<String>,
    pub frameworks: Vec<String>,
    pub scripts: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetails {
    pub summary: ProjectSummary,
    pub languages: Vec<String>,
    pub package_manager: String,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".output",
    ".vercel",
    ".svelte-kit",
    "coverage",
    ".turbo",
    ".cache",
    ".parcel-cache",
    ".pnpm-store",
    "storybook-static",
    "target",
    "vendor",
    "tmp",
    "temp",
    ".idea",
    ".vscode",
    "__pycache__",
];

/// Prefer these folders first — avoids walking the whole monorepo tree.
const LANG_SCAN_DIRS: &[&str] = &[
    "src",
    "app",
    "pages",
    "components",
    "lib",
    "hooks",
    "styles",
    "style",
    "css",
    "packages",
    "apps",
];

const LANG_EXTS: &[&str] = &["ts", "js", "jsx", "tsx", "less", "css", "scss"];

/// Hard caps so project switch never hangs on huge trees.
const LANG_MAX_DEPTH: usize = 5;
const LANG_MAX_FILES: usize = 800;

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

fn extract_scripts(pkg: &serde_json::Value) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    if let Some(obj) = pkg.get("scripts").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                map.insert(k.clone(), s.to_string());
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

fn note_lang_ext(path: &Path, set: &mut BTreeSet<String>) {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let lower = ext.to_lowercase();
        if LANG_EXTS.contains(&lower.as_str()) {
            set.insert(lower);
        }
    }
}

fn walk_languages_limited(root: &Path, set: &mut BTreeSet<String>, visited: &mut usize) {
    if set.len() >= LANG_EXTS.len() || *visited >= LANG_MAX_FILES {
        return;
    }
    let walker = WalkDir::new(root)
        .max_depth(LANG_MAX_DEPTH)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                !SKIP_DIRS.contains(&name.as_ref())
            } else {
                true
            }
        });
    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        *visited += 1;
        note_lang_ext(entry.path(), set);
        if set.len() >= LANG_EXTS.len() || *visited >= LANG_MAX_FILES {
            break;
        }
    }
}

fn scan_languages(dir: &Path) -> Vec<String> {
    let mut set = BTreeSet::new();
    let mut visited = 0usize;

    // Cheap hints from package.json (no filesystem walk).
    if let Some(pkg) = read_package_json(dir) {
        let mut deps = BTreeSet::new();
        for key in ["dependencies", "devDependencies", "peerDependencies"] {
            if let Some(obj) = pkg.get(key).and_then(|v| v.as_object()) {
                for dep in obj.keys() {
                    deps.insert(dep.to_lowercase());
                }
            }
        }
        if deps.contains("typescript") {
            set.insert("ts".into());
        }
        if deps.iter().any(|d| {
            matches!(
                d.as_str(),
                "react" | "vue" | "next" | "nuxt" | "svelte" | "solid-js" | "vite" | "webpack"
            )
        }) {
            set.insert("js".into());
        }
        if deps.contains("sass") || deps.contains("node-sass") {
            set.insert("scss".into());
        }
        if deps.contains("less") {
            set.insert("less".into());
        }
    }

    // Root-level source files only (non-recursive).
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                note_lang_ext(&path, &mut set);
            }
        }
    }

    // Shallow walk of common frontend folders first.
    for name in LANG_SCAN_DIRS {
        if set.len() >= LANG_EXTS.len() || visited >= LANG_MAX_FILES {
            break;
        }
        let sub = dir.join(name);
        if sub.is_dir() {
            walk_languages_limited(&sub, &mut set, &mut visited);
        }
    }

    // If still incomplete, one shallow pass from project root (capped).
    if set.len() < LANG_EXTS.len() && visited < LANG_MAX_FILES {
        walk_languages_limited(dir, &mut set, &mut visited);
    }

    set.into_iter().collect()
}

fn summary_from_dir(dir: PathBuf) -> Option<ProjectSummary> {
    let pkg = read_package_json(&dir)?;
    let folder_name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| dir.to_string_lossy().to_string());
    Some(ProjectSummary {
        folder_name,
        path: dir.to_string_lossy().to_string(),
        pkg_name: pkg
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        pkg_version: pkg
            .get("version")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        frameworks: detect_frameworks(&pkg),
        scripts: extract_scripts(&pkg),
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
        if path.is_dir() {
            if let Some(summary) = summary_from_dir(path) {
                projects.push(summary);
            }
        }
    }
    projects.sort_by(|a, b| a.folder_name.cmp(&b.folder_name));
    Ok(projects)
}

pub fn scan_project(path: &str) -> Result<ProjectDetails, String> {
    let dir = PathBuf::from(path);
    let summary = summary_from_dir(dir.clone()).ok_or_else(|| {
        format!("No package.json in {path}")
    })?;
    Ok(ProjectDetails {
        languages: scan_languages(&dir),
        package_manager: detect_package_manager(&dir),
        summary,
    })
}
