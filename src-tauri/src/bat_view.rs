//! Embedded [bat](https://github.com/sharkdp/bat) pretty-printer for terminal file viewing.
//!
//! Intercepts simple `cat` / `type` / `bat` / `Get-Content` invocations and renders
//! files with syntax highlighting, line numbers, and Git change markers — without
//! spawning an external bat binary or a pager.

use crate::console_decode;
use bat::PrettyPrinter;
use std::path::{Path, PathBuf};

const DEFAULT_THEME: &str = "TwoDark";
const DEFAULT_TERM_WIDTH: usize = 100;

/// Render one or more files with bat into an ANSI-colored string.
pub fn render_files(paths: &[PathBuf], term_width: Option<usize>) -> Result<String, String> {
    if paths.is_empty() {
        return Err("没有可预览的文件".into());
    }

    // Read + decode up front so GBK/ACP source files become UTF-8 before bat.
    let mut loaded: Vec<(PathBuf, Vec<u8>)> = Vec::with_capacity(paths.len());
    for path in paths {
        if !path.exists() {
            return Err(format!("文件不存在: {}", path.display()));
        }
        if path.is_dir() {
            return Err(format!("是目录，不是文件: {}", path.display()));
        }
        let raw = std::fs::read(path).map_err(|e| format!("读取失败 {}: {e}", path.display()))?;
        let text = console_decode::decode_bytes(&raw);
        loaded.push((path.clone(), text.into_bytes()));
    }

    let width = term_width.unwrap_or(DEFAULT_TERM_WIDTH).max(40);
    let mut output = String::new();
    let mut printer = PrettyPrinter::new();

    for (path, bytes) in &loaded {
        printer.input(bat::Input::from_bytes(bytes).name(path).kind("File"));
    }

    printer
        .header(true)
        .grid(true)
        .line_numbers(true)
        .rule(true)
        .vcs_modification_markers(true)
        .colored_output(true)
        .true_color(true)
        .theme(DEFAULT_THEME)
        .term_width(width)
        .tab_width(Some(4));

    printer
        .print_with_writer(Some(&mut output))
        .map_err(|e| format!("bat 渲染失败: {e}"))?;

    Ok(output)
}

/// If `command` is a simple file-view invocation, return resolved absolute paths.
///
/// Returns `None` for pipelines, redirects, or unrecognized commands so the
/// normal shell path still runs.
pub fn try_parse_view_command(command: &str, cwd: &Path) -> Option<Vec<PathBuf>> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Pipelines / redirects / chaining → leave to the shell.
    if trimmed.contains('|')
        || trimmed.contains('>')
        || trimmed.contains('<')
        || trimmed.contains("&&")
        || trimmed.contains("||")
        || trimmed.contains(';')
    {
        return None;
    }

    let tokens = tokenize(trimmed);
    if tokens.is_empty() {
        return None;
    }

    let cmd = tokens[0].to_ascii_lowercase();
    let is_view = matches!(
        cmd.as_str(),
        "cat" | "type" | "bat" | "batcat" | "get-content" | "gc"
    );
    if !is_view {
        return None;
    }

    // Collect path args; skip bat-style flags (`-n`, `--style=…`).
    let mut files: Vec<String> = Vec::new();
    let mut i = 1;
    while i < tokens.len() {
        let t = &tokens[i];
        if t == "-" {
            // stdin — not supported in embedded path
            return None;
        }
        if t.starts_with('-') {
            // `--lang=rs` / `-l` `rs` — skip option and optional value for short opts
            if matches!(t.as_str(), "-l" | "-r" | "--language" | "--line-range" | "--theme")
                && i + 1 < tokens.len()
                && !tokens[i + 1].starts_with('-')
            {
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }
        files.push(t.clone());
        i += 1;
    }

    if files.is_empty() {
        return None;
    }

    let resolved: Vec<PathBuf> = files
        .into_iter()
        .map(|f| resolve_path(cwd, &f))
        .collect();

    Some(resolved)
}

fn resolve_path(cwd: &Path, raw: &str) -> PathBuf {
    let p = PathBuf::from(raw);
    if p.is_absolute() {
        p
    } else {
        cwd.join(p)
    }
}

/// Minimal shell-ish tokenizer: whitespace split with `"…"` / `'…'` support.
fn tokenize(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut chars = input.chars().peekable();
    let mut in_single = false;
    let mut in_double = false;

    while let Some(c) = chars.next() {
        match c {
            '\'' if !in_double => {
                in_single = !in_single;
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            c if c.is_whitespace() && !in_single && !in_double => {
                if !cur.is_empty() {
                    tokens.push(std::mem::take(&mut cur));
                }
            }
            '\\' if !in_single => {
                if let Some(next) = chars.next() {
                    cur.push(next);
                }
            }
            _ => cur.push(c),
        }
    }

    if !cur.is_empty() {
        tokens.push(cur);
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn parses_simple_cat() {
        let cwd = env::temp_dir();
        let paths = try_parse_view_command("cat README.md", &cwd).unwrap();
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("README.md"));
    }

    #[test]
    fn skips_pipelines() {
        let cwd = env::temp_dir();
        assert!(try_parse_view_command("cat a.md | less", &cwd).is_none());
    }

    #[test]
    fn parses_bat_with_flags() {
        let cwd = env::temp_dir();
        let paths = try_parse_view_command("bat -n --theme=TwoDark src/main.rs", &cwd).unwrap();
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("src/main.rs") || paths[0].ends_with("src\\main.rs"));
    }
}
