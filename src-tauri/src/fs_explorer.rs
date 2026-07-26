use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileResult {
    pub path: String,
    pub content: String,
    pub size: u64,
}

/// Soft limit for the in-app editor (emergency edits, not large binaries).
const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

const IGNORED_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    ".DS_Store",
    "Thumbs.db",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".output",
    "coverage",
    "__pycache__",
    ".turbo",
    ".cache",
];

fn should_ignore(name: &str) -> bool {
    IGNORED_NAMES
        .iter()
        .any(|n| name.eq_ignore_ascii_case(n))
}

/// List direct children of a directory (non-recursive).
pub fn list_directory_entries(path: &str) -> Result<Vec<DirEntryInfo>, String> {
    let root = Path::new(path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let mut entries: Vec<DirEntryInfo> = Vec::new();
    let reader = fs::read_dir(root).map_err(|e| e.to_string())?;
    for entry in reader {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() || should_ignore(&name) {
            continue;
        }
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let is_dir = file_type.is_dir();
        let path_buf = entry.path();
        entries.push(DirEntryInfo {
            name,
            path: path_buf.to_string_lossy().to_string(),
            is_dir,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a
            .name
            .to_lowercase()
            .cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

/// Create a directory (and parents). Returns the normalized path.
pub fn create_directory(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if p.exists() {
        if p.is_dir() {
            return Ok(p.to_string_lossy().to_string());
        }
        return Err(format!("Path exists and is not a directory: {path}"));
    }
    fs::create_dir_all(p).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().to_string())
}

fn ensure_regular_file(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("File not found: {path}"));
    }
    if !p.is_file() {
        return Err(format!("Not a file: {path}"));
    }
    Ok(p)
}

/// Read a UTF-8 text file for the in-app editor.
pub fn read_text_file(path: &str) -> Result<TextFileResult, String> {
    let p = ensure_regular_file(path)?;
    let meta = fs::metadata(p).map_err(|e| e.to_string())?;
    let size = meta.len();
    if size > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "File too large for editor ({} bytes, max {} bytes)",
            size, MAX_TEXT_FILE_BYTES
        ));
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    if bytes.contains(&0) {
        return Err("Binary file cannot be opened in the text editor".into());
    }
    let content = String::from_utf8(bytes).map_err(|_| {
        "File is not valid UTF-8 and cannot be opened in the text editor".to_string()
    })?;
    Ok(TextFileResult {
        path: p.to_string_lossy().to_string(),
        content,
        size,
    })
}

/// Write UTF-8 text to a file (creates or overwrites).
pub fn write_text_file(path: &str, content: String) -> Result<(), String> {
    let p = Path::new(path);
    if p.exists() && !p.is_file() {
        return Err(format!("Not a file: {path}"));
    }
    if content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "Content too large for editor (max {} bytes)",
            MAX_TEXT_FILE_BYTES
        ));
    }
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(p, content.as_bytes()).map_err(|e| e.to_string())
}
