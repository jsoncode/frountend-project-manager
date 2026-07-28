use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::OnceLock;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 0 = unknown, 1 = supported, 2 = unsupported.
const REL_UNKNOWN: u8 = 0;
const REL_YES: u8 = 1;
const REL_NO: u8 = 2;

static STATUS_RELATIVE: AtomicU8 = AtomicU8::new(REL_UNKNOWN);

/// True once we have confirmed `--relative` fails at runtime (overrides probe).
static STATUS_RELATIVE_DENIED: AtomicBool = AtomicBool::new(false);

fn git_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// Feature-detect via `git status -h` (more reliable than version strings).
fn probe_status_relative_help() -> bool {
    static CACHED: OnceLock<bool> = OnceLock::new();
    *CACHED.get_or_init(|| {
        let mut cmd = Command::new("git");
        cmd.args(["status", "-h"]);
        git_no_window(&mut cmd);
        let Ok(output) = cmd.output() else {
            return false;
        };
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        // Help lists the flag only when the installed git accepts it.
        text.contains("--relative")
    })
}

fn status_relative_supported() -> bool {
    if STATUS_RELATIVE_DENIED.load(Ordering::Relaxed) {
        return false;
    }
    match STATUS_RELATIVE.load(Ordering::Relaxed) {
        REL_YES => true,
        REL_NO => false,
        _ => {
            let yes = probe_status_relative_help();
            STATUS_RELATIVE.store(if yes { REL_YES } else { REL_NO }, Ordering::Relaxed);
            yes
        }
    }
}

fn deny_status_relative() {
    STATUS_RELATIVE_DENIED.store(true, Ordering::Relaxed);
    STATUS_RELATIVE.store(REL_NO, Ordering::Relaxed);
}

fn is_unknown_relative_option(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("unknown option") && lower.contains("relative")
}

/// Strip worktree-relative prefix so paths match `--relative` output.
fn strip_status_prefix(repo_rel: &str, prefix: &str) -> Option<String> {
    let path = repo_rel.replace('\\', "/");
    let mut prefix = prefix.replace('\\', "/");
    if prefix.is_empty() {
        return Some(path);
    }
    if !prefix.ends_with('/') {
        prefix.push('/');
    }
    path.strip_prefix(&prefix).map(|s| s.to_string())
}

fn git_show_prefix(path: &str) -> String {
    git_command(path)
        .args(["rev-parse", "--show-prefix"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().replace('\\', "/"))
        .unwrap_or_default()
}

fn run_git_status(path: &str, use_relative: bool) -> Result<std::process::Output, String> {
    let mut args = vec!["status", "--porcelain=v1", "-unormal"];
    if use_relative {
        args.push("--relative");
    }
    args.extend(["--", "."]);
    git_command(path)
        .args(&args)
        .output()
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchItem {
    pub name: String,
    pub is_remote: bool,
    /// Commits local has that upstream lacks
    pub ahead: u32,
    /// Commits upstream has that local lacks (未拉取)
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub current: Option<String>,
    pub branches: Vec<BranchItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub code: String,
    pub path: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub clean: bool,
    pub current: Option<String>,
    pub entries: Vec<GitStatusEntry>,
}

/// Cap remote-heavy repos so UI doesn't render thousands of rows.
const MAX_BRANCHES: usize = 200;

fn git_command(path: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(path);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn status_label(code: &str) -> String {
    match code {
        "M " | " M" | "MM" => "modified".into(),
        "A " | " A" | "AM" => "added".into(),
        "D " | " D" => "deleted".into(),
        "R " | " R" => "renamed".into(),
        "C " | " C" => "copied".into(),
        "??" => "untracked".into(),
        "!!" => "ignored".into(),
        "UU" | "AA" | "DD" => "conflict".into(),
        other => format!("changed({other})"),
    }
}

fn parse_track(track: &str) -> (u32, u32) {
    // e.g. "[ahead 1, behind 2]" | "[behind 3]" | "[ahead 1]"
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let lower = track.to_lowercase();
    if let Some(i) = lower.find("ahead ") {
        let rest = &lower[i + 6..];
        ahead = rest
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .unwrap_or(0);
    }
    if let Some(i) = lower.find("behind ") {
        let rest = &lower[i + 7..];
        behind = rest
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .unwrap_or(0);
    }
    (ahead, behind)
}

fn read_local_branches(path: &str) -> Vec<BranchItem> {
    let output = git_command(path)
        .args([
            "for-each-ref",
            "--format=%(refname:short)\t%(upstream:track)",
            "--sort=-committerdate",
            "refs/heads/",
        ])
        .output()
        .ok();

    let Some(output) = output.filter(|o| o.status.success()) else {
        return Vec::new();
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let (name, track) = line
                .split_once('\t')
                .map(|(n, t)| (n.trim(), t.trim()))
                .unwrap_or((line, ""));
            if name.is_empty() || name == "HEAD" {
                return None;
            }
            let (ahead, behind) = parse_track(track);
            Some(BranchItem {
                name: name.to_string(),
                is_remote: false,
                ahead,
                behind,
            })
        })
        .collect()
}

fn read_remote_branches(path: &str) -> Vec<BranchItem> {
    let output = git_command(path)
        .args([
            "for-each-ref",
            "--format=%(refname:short)",
            "--sort=-committerdate",
            "refs/remotes/",
        ])
        .output()
        .ok();

    let Some(output) = output.filter(|o| o.status.success()) else {
        return Vec::new();
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && l != "HEAD" && !l.ends_with("/HEAD"))
        .map(|name| BranchItem {
            name,
            is_remote: true,
            ahead: 0,
            behind: 0,
        })
        .collect()
}

pub fn git_branches(path: &str) -> Result<Option<GitInfo>, String> {
    let git_dir = std::path::Path::new(path).join(".git");
    if !git_dir.exists() {
        return Ok(None);
    }

    let current = git_command(path)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    let locals = read_local_branches(path);
    let remotes = read_remote_branches(path);

    let mut seen = BTreeSet::new();
    let mut branches = Vec::new();

    for b in locals.into_iter().chain(remotes) {
        if seen.insert(b.name.clone()) {
            branches.push(b);
        }
        if branches.len() >= MAX_BRANCHES {
            break;
        }
    }

    if let Some(cur) = current.as_ref() {
        if !seen.contains(cur) {
            branches.insert(
                0,
                BranchItem {
                    name: cur.clone(),
                    is_remote: false,
                    ahead: 0,
                    behind: 0,
                },
            );
            if branches.len() > MAX_BRANCHES {
                branches.truncate(MAX_BRANCHES);
            }
        }
    }

    Ok(Some(GitInfo { current, branches }))
}

/// Fetch remotes so ahead/behind counts reflect latest remote tips.
pub fn git_fetch(path: &str) -> Result<String, String> {
    let git_dir = std::path::Path::new(path).join(".git");
    if !git_dir.exists() {
        return Err("非 Git 仓库".into());
    }

    let output = git_command(path)
        .args(["fetch", "--all", "--prune"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "git fetch failed".into()
        } else {
            err
        });
    }

    let msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok(if msg.is_empty() {
        "fetch ok".into()
    } else {
        msg
    })
}

pub fn git_status(path: &str) -> Result<GitStatus, String> {
    // Accept both repo roots and nested folders inside a work tree.
    let inside = git_command(path)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false);
    if !inside {
        return Err("非 Git 仓库".into());
    }

    let current = git_command(path)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    // Prefer `--relative` when help lists it; fall back if runtime rejects it.
    let mut use_relative = status_relative_supported();
    let mut output = run_git_status(path, use_relative)?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if use_relative && is_unknown_relative_option(&err) {
            deny_status_relative();
            use_relative = false;
            output = run_git_status(path, false)?;
        } else {
            return Err(if err.is_empty() {
                "git status failed".into()
            } else {
                err
            });
        }
    }

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "git status failed".into()
        } else {
            err
        });
    }

    let prefix = if use_relative {
        String::new()
    } else {
        git_show_prefix(path)
    };

    let mut entries = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if line.len() < 3 {
            continue;
        }
        let code = line[..2].to_string();
        let rest = line[3..].trim();
        let file_path = if let Some((_, to)) = rest.split_once(" -> ") {
            to.to_string()
        } else {
            rest.to_string()
        };
        let file_path = if use_relative {
            file_path
        } else if let Some(rel) = strip_status_prefix(&file_path, &prefix) {
            rel
        } else {
            continue;
        };
        entries.push(GitStatusEntry {
            label: status_label(&code),
            code,
            path: file_path,
        });
    }

    Ok(GitStatus {
        clean: entries.is_empty(),
        current,
        entries,
    })
}

pub fn git_checkout(path: &str, branch: &str) -> Result<String, String> {
    let git_dir = std::path::Path::new(path).join(".git");
    if !git_dir.exists() {
        return Err("非 Git 仓库".into());
    }

    let branch = branch.trim();
    if branch.is_empty() {
        return Err("分支名为空".into());
    }

    let local_name = branch
        .strip_prefix("origin/")
        .or_else(|| branch.strip_prefix("remotes/origin/"))
        .unwrap_or(branch);

    let switch = git_command(path)
        .args(["switch", local_name])
        .output()
        .map_err(|e| e.to_string())?;

    if switch.status.success() {
        return Ok(format!("switched to {local_name}"));
    }

    if branch.starts_with("origin/") || branch.starts_with("remotes/origin/") {
        let remote_ref = if branch.starts_with("remotes/") {
            branch.trim_start_matches("remotes/").to_string()
        } else {
            branch.to_string()
        };
        let track = git_command(path)
            .args(["switch", "-c", local_name, "--track", &remote_ref])
            .output()
            .map_err(|e| e.to_string())?;
        if track.status.success() {
            return Ok(format!("created tracking branch {local_name} ← {remote_ref}"));
        }
        let err = String::from_utf8_lossy(&track.stderr).trim().to_string();
        return Err(if err.is_empty() {
            String::from_utf8_lossy(&switch.stderr).trim().to_string()
        } else {
            err
        });
    }

    let err = String::from_utf8_lossy(&switch.stderr).trim().to_string();
    Err(if err.is_empty() {
        format!("无法切换到分支 {branch}")
    } else {
        err
    })
}

fn require_git_repo(path: &str) -> Result<(), String> {
    let git_dir = std::path::Path::new(path).join(".git");
    if !git_dir.exists() {
        return Err("非 Git 仓库".into());
    }
    Ok(())
}

/// Create a local branch from `from`, switch to it, then
/// `git push -u origin <name>`.
pub fn git_create_branch(path: &str, name: &str, from: &str) -> Result<String, String> {
    require_git_repo(path)?;
    let name = name.trim();
    if name.is_empty() {
        return Err("分支名为空".into());
    }
    if name.contains("..") || name.contains(' ') || name.contains('\\') {
        return Err("分支名不合法".into());
    }

    let start = normalize_branch_name(from.trim());
    if start.is_empty() {
        return Err("起始分支为空".into());
    }

    let start_ref = if from.trim().starts_with("origin/")
        || from.trim().starts_with("remotes/origin/")
    {
        format!("origin/{start}")
    } else {
        start.clone()
    };

    if ref_exists(path, &format!("refs/heads/{name}")) {
        return Err(format!("本地分支 {name} 已存在"));
    }
    if ref_exists(path, &format!("refs/remotes/origin/{name}")) {
        return Err(format!("远程分支 origin/{name} 已存在"));
    }

    // Create + checkout in one step.
    let switch = git_command(path)
        .args(["switch", "-c", name, "--no-track", &start_ref])
        .output()
        .map_err(|e| e.to_string())?;

    if !switch.status.success() {
        let err = String::from_utf8_lossy(&switch.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("无法创建并切换到分支 {name}")
        } else {
            err
        });
    }

    let mut notes = vec![format!("created & switched to {name} ← {start_ref}")];

    let push_out = git_command(path)
        .args(["push", "-u", "origin", name])
        .output()
        .map_err(|e| e.to_string())?;
    if !push_out.status.success() {
        let err = String::from_utf8_lossy(&push_out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("已切换到 {name}，但推送到 origin 失败")
        } else {
            format!("已切换到 {name}，但推送失败: {err}")
        });
    }
    notes.push(format!("pushed origin/{name} (-u)"));

    Ok(notes.join("; "))
}

fn ref_exists(path: &str, refname: &str) -> bool {
    git_command(path)
        .args(["show-ref", "--verify", "--quiet", refname])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Delete a local or remote branch. Refuses to delete the currently checked-out branch.
pub fn git_delete_branch(
    path: &str,
    branch: &str,
    is_remote: bool,
    also_local: bool,
) -> Result<String, String> {
    require_git_repo(path)?;
    let local = normalize_branch_name(branch.trim());
    if local.is_empty() {
        return Err("分支名为空".into());
    }

    if let Some(cur) = current_branch_name(path) {
        if cur == local {
            return Err("不能删除当前所在分支".into());
        }
    }

    let mut notes = Vec::new();

    if is_remote {
        let output = git_command(path)
            .args(["push", "origin", "--delete", &local])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if err.is_empty() {
                format!("无法删除远程分支 origin/{local}")
            } else {
                err
            });
        }
        notes.push(format!("deleted origin/{local}"));

        if also_local {
            let local_del = git_command(path)
                .args(["branch", "-D", &local])
                .output()
                .map_err(|e| e.to_string())?;
            if local_del.status.success() {
                notes.push(format!("deleted local {local}"));
            } else {
                let err = String::from_utf8_lossy(&local_del.stderr).trim().to_string();
                if !err.is_empty() {
                    notes.push(format!("local {local}: {err}"));
                }
            }
        }
    } else {
        let output = git_command(path)
            .args(["branch", "-D", &local])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if err.is_empty() {
                format!("无法删除本地分支 {local}")
            } else {
                err
            });
        }
        notes.push(format!("deleted {local}"));
    }

    Ok(notes.join("; "))
}

fn normalize_branch_name(branch: &str) -> String {
    branch
        .strip_prefix("remotes/origin/")
        .or_else(|| branch.strip_prefix("remotes/"))
        .or_else(|| branch.strip_prefix("origin/"))
        .unwrap_or(branch)
        .to_string()
}

fn current_branch_name(path: &str) -> Option<String> {
    git_command(path)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD")
}

/// Pull / fast-forward a branch. Works without checking it out:
/// - current branch → `git pull --ff-only`
/// - other local branch → `git fetch origin <branch>:<branch>` (FF only)
/// - remote-only name → same fetch into local ref
pub fn git_pull_branch(path: &str, branch: &str) -> Result<String, String> {
    let git_dir = std::path::Path::new(path).join(".git");
    if !git_dir.exists() {
        return Err("非 Git 仓库".into());
    }

    let local = normalize_branch_name(branch.trim());
    if local.is_empty() {
        return Err("分支名为空".into());
    }

    let current = current_branch_name(path);
    if current.as_deref() == Some(local.as_str()) {
        let output = git_command(path)
            .args(["pull", "--ff-only", "--prune"])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            // Fallback without --ff-only for repos that allow merge pulls
            let retry = git_command(path)
                .args(["pull", "--prune"])
                .output()
                .map_err(|e| e.to_string())?;
            if !retry.status.success() {
                let err = String::from_utf8_lossy(&retry.stderr).trim().to_string();
                return Err(if err.is_empty() {
                    String::from_utf8_lossy(&output.stderr).trim().to_string()
                } else {
                    err
                });
            }
            let msg = String::from_utf8_lossy(&retry.stdout).trim().to_string();
            return Ok(if msg.is_empty() {
                format!("pulled {local}")
            } else {
                msg
            });
        }
        let msg = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(if msg.is_empty() {
            format!("pulled {local}")
        } else {
            msg
        });
    }

    // Update local branch ref from origin without checkout (fast-forward only).
    let spec = format!("{local}:{local}");
    let output = git_command(path)
        .args(["fetch", "origin", &spec])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("无法更新分支 {local}（可能需要先建立与 origin/{local} 的跟踪，或存在分叉）")
        } else {
            err
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok(if stderr.is_empty() {
        format!("updated {local} ← origin/{local}")
    } else {
        format!("updated {local}: {stderr}")
    })
}
