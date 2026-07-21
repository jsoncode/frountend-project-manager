use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvFileInfo {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvEntry {
    pub key: String,
    pub value: String,
}

pub fn list_env_files(project_path: &str) -> Result<Vec<EnvFileInfo>, String> {
    let root = PathBuf::from(project_path);
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".env" || name.starts_with(".env.") {
            files.push(EnvFileInfo {
                name: name.clone(),
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

pub fn read_env_file(path: &str) -> Result<Vec<EnvEntry>, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let body = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        if let Some((k, v)) = body.split_once('=') {
            let key = k.trim().to_string();
            let mut value = v.trim().to_string();
            if (value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\''))
            {
                value = value[1..value.len() - 1].to_string();
            }
            entries.push(EnvEntry { key, value });
        }
    }
    Ok(entries)
}
