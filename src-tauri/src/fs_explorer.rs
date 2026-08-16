use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AliasMapping {
    /// Import prefix, e.g. `@/` or `@components/`
    pub find: String,
    /// Absolute filesystem prefix that replaces `find`
    pub replacement: String,
}

/// Soft limit for the in-app editor (emergency edits, not large binaries).
const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

const MODULE_EXTENSIONS: &[&str] = &[
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".json", ".css",
    ".scss", ".less",
];

const INDEX_FILES: &[&str] = &[
    "index.ts",
    "index.tsx",
    "index.d.ts",
    "index.js",
    "index.jsx",
    "index.mjs",
    "index.vue",
];

/// Prefer declaration files when resolving libraries for the editor.
const TYPE_INDEX_FILES: &[&str] = &["index.d.ts", "index.ts", "index.tsx"];

// ── Path containment gate (C1 / C2 / L9 / L14) ───────────────────────────────
// Every destructive / write / read command must prove its target resolves
// inside the caller-supplied root before touching the filesystem. This blocks
// `..` traversal, symlink escapes and drive-relative tricks from a compromised
// WebView (any XSS is full RCE because the terminal is a design-mandated
// shell boundary — see AUDIT-REPORT.md I6 / C1 / C2).

/// Canonicalize a path that may not exist yet: canonicalize the DEEPEST
/// existing ancestor and re-append the remaining (non-existing) components.
/// Walking up one level at a time is required — canonicalizing only the final
/// root would keep 8.3 short names (e.g. `ADMINI~1`) in the tail while the
/// root canonicalizes to the long name, making containment checks spuriously
/// reject legitimate children.
fn canonicalize_lenient(p: &Path) -> PathBuf {
    let mut tail: Vec<PathBuf> = Vec::new();
    let mut cur = p;
    loop {
        match cur.canonicalize() {
            Ok(c) => {
                let mut base = c;
                for part in tail.into_iter().rev() {
                    base.push(part);
                }
                return base;
            }
            Err(_) => match cur.parent() {
                Some(parent) if !parent.as_os_str().is_empty() && parent != cur => {
                    if let Some(name) = cur.file_name() {
                        tail.push(name.into());
                    }
                    cur = parent;
                }
                _ => break,
            },
        }
    }
    // Nothing canonicalized (relative path / nonexistent drive) — best effort.
    cur.to_path_buf()
}

/// Verify that `path` resolves to a location inside `root` (both canonicalized
/// leniently). Returns the canonical target on success.
pub fn ensure_within(root: &str, path: &str) -> Result<PathBuf, String> {
    if root.is_empty() {
        return Err("允许根目录为空".into());
    }
    // Lexically reject `..` in either side BEFORE any canonicalization: a
    // non-existent tail like `C:\repo\..\evil` canonicalizes leniently to
    // `C:\repo\..\evil`, whose component PREFIX still matches `C:\repo`, yet
    // the OS resolves it OUTSIDE the root. (Regression-guarded by tests.)
    if contains_parent_dir(Path::new(root)) || contains_parent_dir(Path::new(path)) {
        return Err(format!("路径包含越界段: {path}"));
    }
    let root_c = canonicalize_lenient(Path::new(root));
    let path_c = canonicalize_lenient(Path::new(path));
    // Component-wise starts_with: `C:\foo\bar` does not start with `C:\foo`
    // unless `bar` is a real child component (rejects the `foo` vs `foobar`
    // prefix trap).
    if path_c.starts_with(&root_c) {
        Ok(path_c)
    } else {
        Err(format!("路径超出允许的根目录范围: {path}"))
    }
}

/// True when any path component is `..` (a traversal segment).
fn contains_parent_dir(p: &Path) -> bool {
    p.components().any(|c| matches!(c, std::path::Component::ParentDir))
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

fn has_known_ext(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    MODULE_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
        || lower.ends_with(".d.ts")
}

fn try_file(path: &Path) -> Option<String> {
    if path.is_file() {
        Some(path_str(path))
    } else {
        None
    }
}

/// Resolve `./foo` / `../bar` against the importing file's directory (no `.\` leftovers).
fn join_relative(from_file: &str, spec: &str) -> PathBuf {
    let base = Path::new(from_file)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let mut out = base;
    for part in spec.replace('\\', "/").split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            let _ = out.pop();
            continue;
        }
        out.push(part);
    }
    out
}

/// Resolve a candidate path to an existing source file (extensions / index).
fn expand_candidate(base: &Path) -> Option<String> {
    if let Some(hit) = try_file(base) {
        return Some(hit);
    }
    let as_str = path_str(base);
    if !has_known_ext(&as_str) {
        for ext in MODULE_EXTENSIONS {
            let p = PathBuf::from(format!("{as_str}{ext}"));
            if let Some(hit) = try_file(&p) {
                return Some(hit);
            }
        }
        // directory + index
        if base.is_dir() {
            for name in INDEX_FILES {
                let p = base.join(name);
                if let Some(hit) = try_file(&p) {
                    return Some(hit);
                }
            }
        } else {
            for name in INDEX_FILES {
                let p = PathBuf::from(format!("{as_str}/{name}"));
                if let Some(hit) = try_file(&p) {
                    return Some(hit);
                }
            }
        }
    }
    None
}

fn apply_alias(specifier: &str, aliases: &[AliasMapping]) -> Option<PathBuf> {
    let mut best: Option<(&AliasMapping, usize)> = None;
    for a in aliases {
        let find = a.find.replace('\\', "/");
        if find.is_empty() {
            continue;
        }
        let spec = specifier.replace('\\', "/");
        if spec == find.trim_end_matches('/')
            || spec.starts_with(&find)
            || (!find.ends_with('/') && spec.starts_with(&(find.clone() + "/")))
        {
            let len = find.len();
            if best.map(|(_, l)| len > l).unwrap_or(true) {
                best = Some((a, len));
            }
        }
    }
    let (alias, _) = best?;
    let find = alias.find.replace('\\', "/");
    let spec = specifier.replace('\\', "/");
    let rest = if spec == find.trim_end_matches('/') {
        ""
    } else if find.ends_with('/') && spec.starts_with(&find) {
        &spec[find.len()..]
    } else if spec.starts_with(&(find.clone() + "/")) {
        &spec[find.len() + 1..]
    } else if spec.starts_with(&find) {
        &spec[find.len()..]
    } else {
        return None;
    };
    let repl = alias.replacement.replace('\\', "/");
    let joined = if rest.is_empty() {
        repl
    } else if repl.ends_with('/') {
        format!("{repl}{rest}")
    } else {
        format!("{repl}/{rest}")
    };
    Some(PathBuf::from(joined))
}

fn expand_type_candidate(base: &Path) -> Option<String> {
    if let Some(hit) = try_file(base) {
        let s = hit.to_ascii_lowercase();
        if s.ends_with(".d.ts") || s.ends_with(".ts") || s.ends_with(".tsx") {
            return Some(hit);
        }
    }
    let as_str = path_str(base);
    if !has_known_ext(&as_str) || as_str.to_ascii_lowercase().ends_with(".d.ts") {
        for ext in [".d.ts", ".ts", ".tsx"] {
            if as_str.to_ascii_lowercase().ends_with(ext) {
                continue;
            }
            let p = PathBuf::from(format!("{as_str}{ext}"));
            if let Some(hit) = try_file(&p) {
                return Some(hit);
            }
        }
        if base.is_dir() {
            for name in TYPE_INDEX_FILES {
                if let Some(hit) = try_file(&base.join(name)) {
                    return Some(hit);
                }
            }
        } else {
            for name in TYPE_INDEX_FILES {
                let p = PathBuf::from(format!("{as_str}/{name}"));
                if let Some(hit) = try_file(&p) {
                    return Some(hit);
                }
            }
        }
    }
    None
}

fn read_pkg_field(pkg: &serde_json::Value, key: &str) -> Option<String> {
    pkg.get(key)?.as_str().map(|s| s.to_string())
}

/// Best-effort types entry from package.json (types / typings / exports).
fn pkg_types_entry(pkg: &serde_json::Value) -> Option<String> {
    if let Some(t) = read_pkg_field(pkg, "types").or_else(|| read_pkg_field(pkg, "typings")) {
        return Some(t);
    }
    let exports = pkg.get("exports")?;
    let dot = exports.get(".")?;
    if let Some(s) = dot.as_str() {
        if s.ends_with(".d.ts") || s.ends_with(".ts") {
            return Some(s.to_string());
        }
        return None;
    }
    if let Some(types) = dot.get("types").and_then(|v| v.as_str()) {
        return Some(types.to_string());
    }
    if let Some(types) = dot
        .get("import")
        .and_then(|v| v.get("types"))
        .and_then(|v| v.as_str())
    {
        return Some(types.to_string());
    }
    None
}

fn types_package_dir(project_root: &str, package_name: &str) -> PathBuf {
    // react → @types/react ; @scope/name → @types/scope__name
    let types_name = if let Some(rest) = package_name.strip_prefix('@') {
        let flat = rest.replace('/', "__");
        format!("@types/{flat}")
    } else {
        format!("@types/{package_name}")
    };
    Path::new(project_root).join("node_modules").join(types_name)
}

/// Resolve a bare package import to a typings file when possible.
fn resolve_node_module(project_root: &str, spec: &str) -> Option<String> {
    let (pkg_name, subpath) = if let Some(rest) = spec.strip_prefix('@') {
        let mut parts = rest.splitn(2, '/');
        let scope = parts.next()?;
        let rem = parts.next().unwrap_or("");
        if rem.is_empty() {
            return None;
        }
        if let Some((name, sub)) = rem.split_once('/') {
            (format!("@{scope}/{name}"), Some(sub.to_string()))
        } else {
            (format!("@{scope}/{rem}"), None)
        }
    } else if let Some((name, sub)) = spec.split_once('/') {
        (name.to_string(), Some(sub.to_string()))
    } else {
        (spec.to_string(), None)
    };

    let nm = Path::new(project_root).join("node_modules").join(&pkg_name);
    let at = types_package_dir(project_root, &pkg_name);

    // 1) Package-own typings (types/typings field only — not index.js).
    if nm.is_dir() {
        if let Some(sub) = &subpath {
            if let Some(hit) = expand_type_candidate(&nm.join(sub)) {
                return Some(hit);
            }
        } else if let Ok(text) = fs::read_to_string(nm.join("package.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(entry) = pkg_types_entry(&v) {
                    if let Some(hit) = expand_type_candidate(&nm.join(entry)) {
                        return Some(hit);
                    }
                }
            }
        }
    }

    // 2) DefinitelyTyped (@types/*) — e.g. react → @types/react/index.d.ts
    //    Must run before JS main/index.js fallback or Monaco gets 2307.
    if at.is_dir() {
        if let Some(sub) = &subpath {
            if let Some(hit) = expand_type_candidate(&at.join(sub)) {
                return Some(hit);
            }
        }
        if let Ok(text) = fs::read_to_string(at.join("package.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(entry) = pkg_types_entry(&v) {
                    if let Some(hit) = expand_type_candidate(&at.join(entry)) {
                        return Some(hit);
                    }
                }
            }
        }
        if let Some(hit) = expand_type_candidate(&at) {
            return Some(hit);
        }
    }

    // 3) Package folder typings without package.json types field.
    if nm.is_dir() && subpath.is_none() {
        if let Some(hit) = expand_type_candidate(&nm) {
            return Some(hit);
        }
    }

    // 4) JS/runtime entry (navigation only).
    if nm.is_dir() {
        if let Some(sub) = &subpath {
            if let Some(hit) = expand_candidate(&nm.join(sub)) {
                return Some(hit);
            }
        }
        if let Ok(text) = fs::read_to_string(nm.join("package.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                for key in ["module", "main"] {
                    if let Some(m) = read_pkg_field(&v, key) {
                        if let Some(hit) = expand_candidate(&nm.join(m)) {
                            return Some(hit);
                        }
                    }
                }
            }
        }
        if let Some(hit) = expand_candidate(&nm) {
            return Some(hit);
        }
    }

    None
}

/// Resolve an import/require specifier to an absolute file path, if it exists.
pub fn resolve_import(
    project_root: &str,
    from_file: &str,
    specifier: &str,
    aliases: &[AliasMapping],
) -> Option<String> {
    let spec = specifier.trim();
    if spec.is_empty() || spec.starts_with("data:") || spec.starts_with("http:") || spec.starts_with("https:")
    {
        return None;
    }

    let candidate = if spec.starts_with("./") || spec.starts_with("../") {
        join_relative(from_file, spec)
    } else if let Some(aliased) = apply_alias(spec, aliases) {
        aliased
    } else if spec.starts_with('/') {
        // Absolute-from-project (rare) or unix abs — prefer project join for leading /
        Path::new(project_root).join(spec.trim_start_matches('/'))
    } else {
        // Bare package (react, lodash, @scope/pkg) — prefer typings / @types
        if let Some(hit) = resolve_node_module(project_root, spec) {
            return containment_checked(project_root, &hit);
        }
        // Project-root relative bare path (rare)
        let in_root = Path::new(project_root).join(spec);
        return containment_checked(project_root, &path_str(&in_root));
    };

    containment_checked(project_root, &path_str(&candidate))
}

/// Import resolution must never hand back a file outside the project root
/// (L9 / H1-adjacent): the resolved path is only used for Monaco models and
/// navigation, so a miss is a safe degradation.
fn containment_checked(project_root: &str, resolved: &str) -> Option<String> {
    let hit = expand_candidate(Path::new(resolved))?;
    if contains_parent_dir(Path::new(&hit)) || contains_parent_dir(Path::new(project_root)) {
        return None;
    }
    let root_c = canonicalize_lenient(Path::new(project_root));
    let hit_c = canonicalize_lenient(Path::new(&hit));
    if hit_c.starts_with(&root_c) {
        Some(hit)
    } else {
        None
    }
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
        if name.is_empty() {
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
/// The directory must be created inside `root`.
pub fn create_directory(root: &str, path: &str) -> Result<String, String> {
    let p = ensure_within(root, path)?;
    if p.exists() {
        if p.is_dir() {
            return Ok(path_str(&p));
        }
        return Err(format!("Path exists and is not a directory: {path}"));
    }
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(path_str(&p))
}

/// Rename a file or directory within its parent directory.
/// `new_name` must be a bare file/folder name (no separators).
/// Both source and destination must stay inside `root`.
/// Returns the new absolute path.
pub fn rename_path(root: &str, path: &str, new_name: &str) -> Result<String, String> {
    let name = new_name.trim();
    if name.is_empty() {
        return Err("New name cannot be empty".into());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("New name cannot contain path separators".into());
    }
    if name == "." || name == ".." {
        return Err("Invalid name".into());
    }
    let src = ensure_within(root, path)?;
    if !src.exists() {
        return Err(format!("Path not found: {path}"));
    }
    let parent = src
        .parent()
        .ok_or_else(|| "Cannot rename a root path".to_string())?;
    let dst = parent.join(name);
    let dst = ensure_within(root, &path_str(&dst))?;
    if dst.exists() {
        return Err(format!("A file or folder named \"{name}\" already exists"));
    }
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    Ok(path_str(&dst))
}

/// Permanently delete a file or directory (recursive for directories).
/// Refuses to delete the allowed root itself.
pub fn delete_path(root: &str, path: &str) -> Result<(), String> {
    let p = ensure_within(root, path)?;
    let root_c = canonicalize_lenient(Path::new(root));
    if p == root_c {
        return Err("不允许删除根目录本身".into());
    }
    if !p.exists() {
        // Already gone — treat as success.
        return Ok(());
    }
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

fn ensure_regular_file(root: &str, path: &str) -> Result<PathBuf, String> {
    let p = ensure_within(root, path)?;
    if !p.exists() {
        return Err(format!("File not found: {path}"));
    }
    if !p.is_file() {
        return Err(format!("Not a file: {path}"));
    }
    Ok(p)
}

/// Read a UTF-8 text file for the in-app editor. The file must live inside `root`.
pub fn read_text_file(root: &str, path: &str) -> Result<TextFileResult, String> {
    let p = ensure_regular_file(root, path)?;
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    let size = meta.len();
    if size > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "File too large for editor ({} bytes, max {} bytes)",
            size, MAX_TEXT_FILE_BYTES
        ));
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    if bytes.contains(&0) {
        return Err("Binary file cannot be opened in the text editor".into());
    }
    let content = String::from_utf8(bytes).map_err(|_| {
        "File is not valid UTF-8 and cannot be opened in the text editor".to_string()
    })?;
    Ok(TextFileResult {
        path: path_str(&p),
        content,
        size,
    })
}

/// Write UTF-8 text to a file (creates or overwrites).
/// The file must live inside `root`. The write is atomic (temp file + rename)
/// so a crash mid-write never truncates the target.
pub fn write_text_file(root: &str, path: &str, content: String) -> Result<(), String> {
    let p = ensure_within(root, path)?;
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
    // Atomic replace: write to a sibling temp file then rename over the target.
    let tmp = p.with_extension(format!(
        "tmp{}",
        std::process::id()
    ));
    let tmp = if tmp == p {
        // Target has no extension — derive a unique sibling name instead.
        let file_name = p
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());
        p.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()))
    } else {
        tmp
    };
    let write = fs::write(&tmp, content.as_bytes())
        .and_then(|_| fs::rename(&tmp, &p));
    if let Err(e) = write {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        // Unique per test — cargo runs tests in parallel threads and a shared
        // dir would be deleted/recreated under each other's feet.
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "fpm-fs-gate-{}-{n}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("inner")).unwrap();
        fs::write(dir.join("file.txt"), b"x").unwrap();
        dir
    }

    #[test]
    fn accepts_children_inside_root() {
        let root = temp_root();
        let ok = ensure_within(&root.to_string_lossy(), &root.join("inner").to_string_lossy());
        assert!(ok.is_ok(), "inner dir must be accepted: {ok:?}");
        let ok2 = ensure_within(
            &root.to_string_lossy(),
            &root.join("file.txt").to_string_lossy(),
        );
        assert!(ok2.is_ok(), "file must be accepted: {ok2:?}");
    }

    #[test]
    fn rejects_paths_outside_root() {
        let root = temp_root();
        let outside = std::env::temp_dir().join("fpm-fs-outside");
        let _ = fs::remove_file(&outside);
        let r = ensure_within(&root.to_string_lossy(), &outside.to_string_lossy());
        assert!(r.is_err(), "outside path must be rejected");
    }

    #[test]
    fn rejects_parent_dir_traversal_even_without_existing_target() {
        let root = temp_root();
        // `C:\root\..\evil` lexically starts with `C:\root` but resolves
        // outside it — the gate must reject before touching the fs (C1/C2).
        let evil = root.join("..").join("fpm-fs-evil");
        let r = ensure_within(&root.to_string_lossy(), &evil.to_string_lossy());
        assert!(r.is_err(), "`..` traversal must be rejected: {r:?}");
        // Also reject `..` inside the root argument itself.
        let bad_root = root.parent().unwrap().join("..").join(root.file_name().unwrap());
        let r2 = ensure_within(&bad_root.to_string_lossy(), &root.join("file.txt").to_string_lossy());
        assert!(r2.is_err(), "`..` inside root must be rejected: {r2:?}");
    }

    #[test]
    fn rejects_prefix_trap() {
        // C:\foo must not contain C:\foobar — component-wise comparison.
        let parent = std::env::temp_dir().join("fpm-prefix-a");
        let sibling = std::env::temp_dir().join("fpm-prefix-ab");
        let _ = fs::create_dir_all(&parent);
        let _ = fs::create_dir_all(&sibling);
        let r = ensure_within(&parent.to_string_lossy(), &sibling.to_string_lossy());
        assert!(r.is_err(), "sibling-prefix path must be rejected: {r:?}");
        let _ = fs::remove_dir_all(&parent);
        let _ = fs::remove_dir_all(&sibling);
    }

    #[test]
    fn delete_refuses_root_itself() {
        let root = temp_root();
        let r = delete_path(&root.to_string_lossy(), &root.to_string_lossy());
        assert!(r.is_err(), "deleting the root itself must be refused: {r:?}");
        assert!(root.exists());
    }

    #[test]
    fn write_text_file_atomic_and_gated() {
        let root = temp_root();
        let target = root.join("inner").join("new.txt");
        write_text_file(&root.to_string_lossy(), &target.to_string_lossy(), "hello".into())
            .unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "hello");
        // No stray temp files left next to the target.
        let leftovers: Vec<_> = fs::read_dir(root.join("inner"))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files must be cleaned: {leftovers:?}");
    }
}
