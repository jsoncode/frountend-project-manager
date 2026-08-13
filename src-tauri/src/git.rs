use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
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

fn read_local_branches(path: &str, remote_names: &BTreeSet<String>) -> Vec<BranchItem> {
    let output = git_command(path)
        .args([
            "for-each-ref",
            "--format=%(refname:short)\t%(upstream)\t%(upstream:track)",
            "--sort=-committerdate",
            "refs/heads/",
        ])
        .output()
        .ok();

    let Some(output) = output.filter(|o| o.status.success()) else {
        return Vec::new();
    };

    let mut fallback_budget = MAX_BEHIND_COUNTED;

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let mut cols = line.splitn(3, '\t');
            let name = cols.next().unwrap_or("").trim();
            let upstream = cols.next().unwrap_or("").trim();
            let track = cols.next().unwrap_or("").trim();
            if name.is_empty() || name == "HEAD" {
                return None;
            }
            let (mut ahead, mut behind) = parse_track(track);
            // No upstream configured: compare against the same-named origin
            // branch so untracked branches still report pending updates.
            if upstream.is_empty() && fallback_budget > 0 {
                let origin_ref = format!("origin/{name}");
                if remote_names.contains(&origin_ref) {
                    fallback_budget -= 1;
                    if let Some((local_only, remote_only)) =
                        count_between(path, name, &origin_ref)
                    {
                        ahead = local_only;
                        behind = remote_only;
                    }
                }
            }
            Some(BranchItem {
                name: name.to_string(),
                is_remote: false,
                ahead,
                behind,
            })
        })
        .collect()
}

/// Commit counts on each side of two refs' symmetric difference:
/// returns (only-in-left, only-in-right).
fn count_between(path: &str, left: &str, right: &str) -> Option<(u32, u32)> {
    let spec = format!("{left}...{right}");
    let output = git_command(path)
        .args(["rev-list", "--left-right", "--count", &spec])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let left_only = parts.next()?.parse::<u32>().ok()?;
    let right_only = parts.next()?.parse::<u32>().ok()?;
    Some((left_only, right_only))
}

/// Short names of every ref under `ref_prefix` (one cheap listing pass).
fn list_ref_short_names(path: &str, ref_prefix: &str) -> Vec<String> {
    git_command(path)
        .args(["for-each-ref", "--format=%(refname:short)", ref_prefix])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Cap the slow per-ref fallback so big repos stay responsive.
const MAX_BEHIND_COUNTED: usize = 60;

/// Remote-tracking branches always look like `<remote>/<branch>`; a bare name
/// (e.g. `origin`) is the remote ref itself — a grouping, not a branch.
fn is_remote_branch_name(name: &str) -> bool {
    !name.is_empty() && name != "HEAD" && !name.ends_with("/HEAD") && name.contains('/')
}

fn read_remote_branches(path: &str, local_names: &BTreeSet<String>) -> Vec<BranchItem> {
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

    let mut budget = MAX_BEHIND_COUNTED;

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| is_remote_branch_name(l))
        .map(|name| {
            // Pending updates = commits the remote ref has that its LOCAL
            // counterpart lacks. Never compare against HEAD: that number
            // shifts every time the user checks out a different branch and
            // no update action can ever consume it. Remote-only branches
            // (no local ref yet) have nothing to pull — a checkout starts
            // at the remote tip — so they report 0.
            let mut ahead = 0;
            let mut behind = 0;
            if budget > 0 {
                if let Some((_, local)) = name.split_once('/') {
                    if local_names.contains(local) {
                        budget -= 1;
                        if let Some((local_only, remote_only)) =
                            count_between(path, local, &name)
                        {
                            ahead = local_only;
                            behind = remote_only;
                        }
                    }
                }
            }
            BranchItem {
                name,
                is_remote: true,
                ahead,
                behind,
            }
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

    // Ref name sets first so each branch's count can be computed against
    // its own counterpart (upstream / same-named local ref), never HEAD.
    let remote_set: BTreeSet<String> = list_ref_short_names(path, "refs/remotes/")
        .into_iter()
        .filter(|n| is_remote_branch_name(n))
        .collect();

    let locals = read_local_branches(path, &remote_set);
    let local_set: BTreeSet<String> = locals.iter().map(|b| b.name.clone()).collect();
    let remotes = read_remote_branches(path, &local_set);

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

/// Push the current branch (or a given branch) without a terminal.
/// No upstream configured → retries once with `-u origin HEAD`.
pub fn git_push(path: &str, branch: Option<&str>) -> Result<String, String> {
    require_git_repo(path)?;

    let output = match branch.map(str::trim).filter(|b| !b.is_empty()) {
        Some(b) => {
            let local = normalize_branch_name(b);
            let spec = format!("{local}:{local}");
            git_command(path)
                .args(["push", "-u", "origin", &spec])
                .output()
                .map_err(|e| e.to_string())?
        }
        None => git_command(path)
            .args(["push"])
            .output()
            .map_err(|e| e.to_string())?,
    };

    if output.status.success() {
        return Ok(pretty_push_output(&output));
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    // Current branch without upstream → configure it and retry once.
    if branch.is_none()
        && (stderr.contains("has no upstream branch") || stderr.contains("--set-upstream"))
    {
        let retry = git_command(path)
            .args(["push", "-u", "origin", "HEAD"])
            .output()
            .map_err(|e| e.to_string())?;
        if retry.status.success() {
            return Ok(pretty_push_output(&retry));
        }
        let err = String::from_utf8_lossy(&retry.stderr).trim().to_string();
        return Err(if err.is_empty() { "git push 失败".into() } else { err });
    }

    let err = stderr.trim().to_string();
    Err(if err.is_empty() { "git push 失败".into() } else { err })
}

fn pretty_push_output(output: &std::process::Output) -> String {
    let msg = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let msg = msg.trim().to_string();
    if msg.is_empty() {
        "push ok".into()
    } else {
        msg
    }
}

/// Stage → commit → optional push, all in one backend call (no terminal).
/// Empty `paths` stages everything (`git add -A`).
pub fn git_commit(
    path: &str,
    message: &str,
    paths: &[String],
    push: bool,
) -> Result<String, String> {
    require_git_repo(path)?;
    let message = message.trim();
    if message.is_empty() {
        return Err("提交信息为空".into());
    }

    let mut add_args: Vec<String> = vec!["add".into()];
    if paths.is_empty() {
        add_args.push("-A".into());
    } else {
        add_args.push("--".into());
        add_args.extend(paths.iter().cloned());
    }
    let add_refs: Vec<&str> = add_args.iter().map(String::as_str).collect();
    run_git_collect(path, &add_refs).map_err(|e| format!("git add 失败：{e}"))?;

    let commit_out = run_git_collect(path, &["commit", "-m", message])
        .map_err(|e| format!("git commit 失败：{e}"))?;
    let commit_note = commit_out.trim().to_string();
    let mut notes = vec![if commit_note.is_empty() {
        "commit ok".to_string()
    } else {
        commit_note
    }];

    if push {
        git_push(path, None)?;
        notes.push("已推送到远程".into());
    }

    Ok(notes.join("；"))
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

fn run_git_collect(path: &str, args: &[&str]) -> Result<String, String> {
    let output = git_command(path)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        Err(if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("git {} 失败", args.first().copied().unwrap_or("?"))
        })
    }
}

/// Marker used to recognise stashes created automatically before a pull.
const AUTO_STASH_MARK: &str = "FPM auto stash";

fn top_stash_is_auto(path: &str) -> bool {
    git_command(path)
        .args(["stash", "list", "-1", "--format=%s"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(AUTO_STASH_MARK))
        .unwrap_or(false)
}

/// Restore the auto-stash created before a pull (after commit/abort finishes).
/// Appends a human-readable note to `msg`; never fails the whole operation.
fn pop_auto_stash(path: &str, msg: &mut String) {
    if !merge_in_progress(path) && top_stash_is_auto(path) {
        match run_git_collect(path, &["stash", "pop"]) {
            Ok(_) => msg.push_str("；已恢复更新前暂存的本地改动"),
            Err(e) => msg.push_str(&format!(
                "；更新完成，但恢复本地暂存改动时产生冲突，请手动解决（{e}）"
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullBranchResult {
    /// "updated" | "uptodate" | "conflicts"
    pub status: String,
    pub message: String,
    /// Present when the pull left conflicts to resolve.
    pub merge: Option<MergeStatus>,
}

/// Pull / fast-forward a branch. Works without checking it out:
/// - current branch → attempt a real pull; dirty working trees are
///   auto-stashed first and restored afterwards, so local uncommitted
///   changes no longer silently block the update.
/// - other local branch → `git fetch origin <branch>:<branch>` (FF only)
/// - remote-only name → same fetch into local ref
pub fn git_pull_branch(path: &str, branch: &str) -> Result<PullBranchResult, String> {
    let git_dir = std::path::Path::new(path).join(".git");
    if !git_dir.exists() {
        return Err("非 Git 仓库".into());
    }

    let local = normalize_branch_name(branch.trim());
    if local.is_empty() {
        return Err("分支名为空".into());
    }

    let current = current_branch_name(path);
    if current.as_deref() != Some(local.as_str()) {
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
        return Ok(PullBranchResult {
            status: "updated".into(),
            message: if stderr.is_empty() {
                format!("updated {local} ← origin/{local}")
            } else {
                format!("updated {local}: {stderr}")
            },
            merge: None,
        });
    }

    // ── Current branch: attempt the pull ──
    // Dirty working tree → stash first so uncommitted changes don't block it.
    let mut stashed = false;
    if !git_status(path).map(|s| s.clean).unwrap_or(true) {
        let msg = format!("{AUTO_STASH_MARK} before pull");
        run_git_collect(path, &["stash", "push", "-u", "-m", &msg])
            .map_err(|e| format!("暂存本地改动失败，无法更新：{e}"))?;
        stashed = true;
    }

    let mut pull_msg = match run_git_collect(path, &["pull", "--ff-only", "--prune"]) {
        Ok(m) => m,
        Err(_) => match run_git_collect(path, &["pull", "--prune"]) {
            Ok(m) => m,
            Err(e) => {
                if merge_in_progress(path) {
                    let merge = git_merge_status(path)?;
                    let mut message = format!(
                        "更新产生 {} 个冲突，请通过三栏合并工具解决",
                        merge.conflict_count
                    );
                    if stashed {
                        message.push_str("；更新前的本地改动已暂存（stash），完成或取消合并后将自动恢复");
                    }
                    return Ok(PullBranchResult {
                        status: "conflicts".into(),
                        message,
                        merge: Some(merge),
                    });
                }
                if stashed {
                    // Pull itself failed (not a merge conflict) → restore stash.
                    let _ = run_git_collect(path, &["stash", "pop"]);
                }
                return Err(format!("更新失败：{e}"));
            }
        },
    };

    if pull_msg.is_empty() {
        pull_msg = format!("pulled {local}");
    }
    if pull_msg.to_lowercase().contains("already up to date") {
        let mut message = pull_msg;
        if stashed {
            pop_auto_stash(path, &mut message);
        }
        return Ok(PullBranchResult {
            status: "uptodate".into(),
            message,
            merge: None,
        });
    }

    if stashed {
        pop_auto_stash(path, &mut pull_msg);
    }
    Ok(PullBranchResult {
        status: "updated".into(),
        message: pull_msg,
        merge: None,
    })
}

fn is_conflict_code(code: &str) -> bool {
    matches!(code, "UU" | "AA" | "DD" | "AU" | "UA" | "DU" | "UD")
        || (code.len() == 2 && code.contains('U'))
}

/// Update every branch that shows pending commits in one shot:
/// - non-current local branches → `git fetch origin <b>:<b>` (fast-forward
///   only, no checkout needed);
/// - the current branch → real pull with auto-stash + conflict reporting
///   (same behaviour as `git_pull_branch`).
/// Branches that diverged from their remote cannot fast-forward and are
/// reported instead of failing the whole operation.
pub fn git_pull_all(path: &str) -> Result<PullBranchResult, String> {
    let git_dir = std::path::Path::new(path).join(".git");
    if !git_dir.exists() {
        return Err("非 Git 仓库".into());
    }

    let current = current_branch_name(path);
    let info = git_branches(path)?;

    let mut updated: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut current_behind = 0u32;

    if let Some(info) = info {
        for b in &info.branches {
            // Remote items mirror their local counterpart's count; the local
            // entry is the one that actually gets fast-forwarded.
            if b.is_remote {
                continue;
            }
            if Some(b.name.as_str()) == current.as_deref() {
                current_behind = b.behind;
                continue;
            }
            if b.behind == 0 {
                continue;
            }
            let spec = format!("{0}:{0}", b.name);
            let ok = git_command(path)
                .args(["fetch", "origin", &spec])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if ok {
                updated.push(b.name.clone());
            } else {
                skipped.push(b.name.clone());
            }
        }
    }

    // Pull the current branch last — it may stash local changes or merge.
    if current_behind > 0 {
        if let Some(cur) = current.as_deref() {
            let res = git_pull_branch(path, cur)?;
            if res.status == "conflicts" {
                let mut message = res.message;
                append_pull_all_summary(&mut message, &updated, &skipped);
                return Ok(PullBranchResult {
                    status: "conflicts".into(),
                    message,
                    merge: res.merge,
                });
            }
            if res.status == "updated" {
                updated.push(cur.to_string());
            }
        }
    }

    if updated.is_empty() && skipped.is_empty() {
        return Ok(PullBranchResult {
            status: "uptodate".into(),
            message: "所有分支已是最新".into(),
            merge: None,
        });
    }

    let mut message = String::new();
    if !updated.is_empty() {
        message.push_str(&format!(
            "已更新 {} 个分支：{}",
            updated.len(),
            updated.join("、")
        ));
    }
    if !skipped.is_empty() {
        if !message.is_empty() {
            message.push('；');
        }
        message.push_str(&format!(
            "{} 个分支与远端分叉，无法快进更新，请签出后手动合并：{}",
            skipped.len(),
            skipped.join("、")
        ));
    }

    Ok(PullBranchResult {
        status: if updated.is_empty() { "uptodate" } else { "updated" }.into(),
        message,
        merge: None,
    })
}

fn append_pull_all_summary(message: &mut String, updated: &[String], skipped: &[String]) {
    if updated.is_empty() && skipped.is_empty() {
        return;
    }
    message.push('；');
    if !updated.is_empty() {
        message.push_str(&format!("另已更新 {} 个分支", updated.len()));
    }
    if !skipped.is_empty() {
        if !updated.is_empty() {
            message.push('，');
        }
        message.push_str(&format!(
            "{} 个分支与远端分叉无法快进更新",
            skipped.len()
        ));
    }
}

fn merge_head_path(path: &str) -> std::path::PathBuf {
    std::path::Path::new(path).join(".git").join("MERGE_HEAD")
}

fn merge_in_progress(path: &str) -> bool {
    merge_head_path(path).is_file()
}

fn read_merge_incoming(path: &str) -> Option<String> {
    if !merge_in_progress(path) {
        return None;
    }
    // Prefer a friendly ref name.
    let named = git_command(path)
        .args(["name-rev", "--name-only", "MERGE_HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())?;
    Some(
        named
            .trim_start_matches("remotes/")
            .trim_start_matches("origin/")
            .to_string(),
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeFileEntry {
    pub path: String,
    pub code: String,
    pub conflict: bool,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeStatus {
    pub in_progress: bool,
    pub current: Option<String>,
    pub incoming: Option<String>,
    pub files: Vec<MergeFileEntry>,
    pub conflict_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeStartResult {
    /// "clean" | "conflicts"
    pub status: String,
    pub message: String,
    pub merge: MergeStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeFileSides {
    /// Common ancestor (stage 1) — used for per-side change highlighting.
    pub base: String,
    pub ours: String,
    pub theirs: String,
    pub working: String,
}

pub fn git_merge_status(path: &str) -> Result<MergeStatus, String> {
    require_git_repo(path)?;
    let in_progress = merge_in_progress(path);
    let current = current_branch_name(path);
    let incoming = read_merge_incoming(path);

    // Prefer a merge-aware file list: unmerged (conflicts) + staged merge changes.
    let mut files = merge_changed_files(path)?;
    if files.is_empty() {
        let status = git_status(path)?;
        files = status
            .entries
            .into_iter()
            .map(|e| {
                let conflict = is_conflict_code(&e.code);
                MergeFileEntry {
                    path: e.path,
                    code: e.code,
                    conflict,
                    label: e.label,
                }
            })
            .collect();
    }

    let conflict_count = files.iter().filter(|f| f.conflict).count() as u32;
    Ok(MergeStatus {
        in_progress,
        current,
        incoming,
        files,
        conflict_count,
    })
}

/// Files touched by an in-progress merge (conflicts + staged auto-merged).
fn merge_changed_files(path: &str) -> Result<Vec<MergeFileEntry>, String> {
    if !merge_in_progress(path) {
        return Ok(Vec::new());
    }

    use std::collections::BTreeMap;
    let mut map: BTreeMap<String, MergeFileEntry> = BTreeMap::new();

    // Unmerged paths → conflicts (UU).
    let unmerged = git_command(path)
        .args(["ls-files", "-u"])
        .output()
        .map_err(|e| e.to_string())?;
    if unmerged.status.success() {
        for line in String::from_utf8_lossy(&unmerged.stdout).lines() {
            // format: <mode> <hash> <stage>\t<path>
            let Some((_, rest)) = line.split_once('\t') else {
                continue;
            };
            let file = rest.trim().replace('\\', "/");
            if file.is_empty() {
                continue;
            }
            map.insert(
                file.clone(),
                MergeFileEntry {
                    path: file,
                    code: "UU".into(),
                    conflict: true,
                    label: "conflict".into(),
                },
            );
        }
    }

    // Staged changes from the merge (auto-resolved).
    let cached = git_command(path)
        .args(["diff", "--cached", "--name-status", "-z"])
        .output()
        .map_err(|e| e.to_string())?;
    if cached.status.success() {
        let raw = String::from_utf8_lossy(&cached.stdout);
        let parts: Vec<&str> = raw.split('\0').filter(|s| !s.is_empty()).collect();
        let mut i = 0;
        while i < parts.len() {
            let status = parts[i];
            i += 1;
            if i >= parts.len() {
                break;
            }
            // Rename/copy: status\0old\0new
            let (code, file) = if status.starts_with('R') || status.starts_with('C') {
                let _old = parts[i];
                i += 1;
                if i >= parts.len() {
                    break;
                }
                let newp = parts[i];
                i += 1;
                (status.chars().next().unwrap_or('R').to_string(), newp)
            } else {
                let f = parts[i];
                i += 1;
                (status.to_string(), f)
            };
            let file = file.replace('\\', "/");
            if file.is_empty() || map.contains_key(&file) {
                continue;
            }
            let label = match code.chars().next().unwrap_or('M') {
                'A' => "added",
                'D' => "deleted",
                'R' => "renamed",
                'C' => "copied",
                _ => "modified",
            };
            map.insert(
                file.clone(),
                MergeFileEntry {
                    path: file,
                    code,
                    conflict: false,
                    label: label.into(),
                },
            );
        }
    }

    Ok(map.into_values().collect())
}

pub fn git_merge_start(path: &str, git_ref: &str) -> Result<MergeStartResult, String> {
    require_git_repo(path)?;
    if merge_in_progress(path) {
        let merge = git_merge_status(path)?;
        return Ok(MergeStartResult {
            status: if merge.conflict_count > 0 {
                "conflicts".into()
            } else {
                "pending".into()
            },
            message: "已有未完成的合并，请先继续或取消".into(),
            merge,
        });
    }

    let git_ref = git_ref.trim();
    if git_ref.is_empty() {
        return Err("合并目标为空".into());
    }

    // Stop before commit so the UI can show the changed-file list (WebStorm-style).
    // --no-ff keeps MERGE_HEAD even when a fast-forward would otherwise apply.
    let output = git_command(path)
        .args(["merge", "--no-commit", "--no-ff", git_ref])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = format!("{stdout}\n{stderr}").to_lowercase();

    if combined.contains("already up to date") {
        return Ok(MergeStartResult {
            status: "uptodate".into(),
            message: "Already up to date.".into(),
            merge: git_merge_status(path)?,
        });
    }

    let merge = git_merge_status(path)?;
    if merge.in_progress {
        let status = if merge.conflict_count > 0 {
            "conflicts"
        } else {
            "pending"
        };
        return Ok(MergeStartResult {
            status: status.into(),
            message: if merge.conflict_count > 0 {
                format!("合并产生 {} 个冲突，请在弹框中解决", merge.conflict_count)
            } else {
                format!(
                    "已暂存 {} 个文件变更，请确认后完成合并",
                    merge.files.len()
                )
            },
            merge,
        });
    }

    Err(if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("合并失败: {git_ref}")
    })
}

pub fn git_merge_file_sides(path: &str, file: &str) -> Result<MergeFileSides, String> {
    require_git_repo(path)?;
    let file = file.trim().replace('\\', "/");
    if file.is_empty() {
        return Err("文件路径为空".into());
    }

    let base = git_show_stage(path, 1, &file).unwrap_or_default();
    let ours = git_show_stage(path, 2, &file).unwrap_or_default();
    let theirs = git_show_stage(path, 3, &file).unwrap_or_default();
    let working_path = std::path::Path::new(path).join(&file);
    let working = if working_path.is_file() {
        fs::read_to_string(&working_path).unwrap_or_default()
    } else {
        String::new()
    };

    Ok(MergeFileSides {
        base,
        ours,
        theirs,
        working,
    })
}

fn git_show_stage(path: &str, stage: u8, file: &str) -> Result<String, String> {
    let spec = format!(":{stage}:{file}");
    let output = git_command(path)
        .args(["show", &spec])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("无法读取 stage {stage}: {file}")
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiffHeadResult {
    pub head: String,
    pub working: String,
}

pub fn git_diff_head(path: &str, file: &str) -> Result<DiffHeadResult, String> {
    require_git_repo(path)?;
    let file = file.trim().replace('\\', "/");
    if file.is_empty() {
        return Err("文件路径为空".into());
    }
    let spec = format!("HEAD:{file}");
    let head = git_command(path)
        .args(["show", &spec])
        .output()
        .map_err(|e| e.to_string())
        .and_then(|output| {
            if !output.status.success() {
                // File might be untracked (new file) — return empty HEAD
                Ok(String::new())
            } else {
                Ok(String::from_utf8_lossy(&output.stdout).to_string())
            }
        })?;
    let working_path = std::path::Path::new(path).join(&file);
    let working = if working_path.is_file() {
        fs::read_to_string(&working_path).unwrap_or_default()
    } else {
        // File deleted in working tree
        String::new()
    };
    Ok(DiffHeadResult { head, working })
}

pub fn git_merge_resolve_ours_theirs(
    path: &str,
    file: &str,
    ours: bool,
) -> Result<MergeStatus, String> {
    require_git_repo(path)?;
    let file = file.trim().replace('\\', "/");
    if file.is_empty() {
        return Err("文件路径为空".into());
    }
    let which = if ours { "--ours" } else { "--theirs" };
    let checkout = git_command(path)
        .args(["checkout", which, "--", &file])
        .output()
        .map_err(|e| e.to_string())?;
    if !checkout.status.success() {
        let err = String::from_utf8_lossy(&checkout.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("无法采用 {}", if ours { "本人" } else { "他人" })
        } else {
            err
        });
    }
    let add = git_command(path)
        .args(["add", "--", &file])
        .output()
        .map_err(|e| e.to_string())?;
    if !add.status.success() {
        let err = String::from_utf8_lossy(&add.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("git add 失败: {file}")
        } else {
            err
        });
    }
    git_merge_status(path)
}

pub fn git_merge_resolve_content(
    path: &str,
    file: &str,
    content: &str,
) -> Result<MergeStatus, String> {
    require_git_repo(path)?;
    let file = file.trim().replace('\\', "/");
    if file.is_empty() {
        return Err("文件路径为空".into());
    }
    let full = std::path::Path::new(path).join(&file);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&full, content).map_err(|e| e.to_string())?;
    let add = git_command(path)
        .args(["add", "--", &file])
        .output()
        .map_err(|e| e.to_string())?;
    if !add.status.success() {
        let err = String::from_utf8_lossy(&add.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("git add 失败: {file}")
        } else {
            err
        });
    }
    git_merge_status(path)
}

/// Finish resolving a stash-pop conflict set: the popped changes are already
/// merged into the working tree, so drop the retained auto-stash entry.
pub fn git_stash_finish_pop(path: &str) -> Result<String, String> {
    require_git_repo(path)?;
    if merge_in_progress(path) {
        return Err("合并仍在进行中，请先完成或取消合并".into());
    }
    if !top_stash_is_auto(path) {
        return Ok("nothing to drop".into());
    }
    let output = git_command(path)
        .args(["stash", "drop", "stash@{0}"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "丢弃自动暂存记录失败".into()
        } else {
            err
        });
    }
    Ok("stash dropped".into())
}

pub fn git_merge_abort(path: &str) -> Result<String, String> {
    require_git_repo(path)?;
    if !merge_in_progress(path) {
        return Err("当前没有进行中的合并".into());
    }
    let output = git_command(path)
        .args(["merge", "--abort"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "取消合并失败".into()
        } else {
            err
        });
    }
    let mut msg = "merge aborted".to_string();
    pop_auto_stash(path, &mut msg);
    Ok(msg)
}

pub fn git_merge_commit(path: &str, message: Option<String>) -> Result<String, String> {
    require_git_repo(path)?;
    if !merge_in_progress(path) {
        return Err("当前没有进行中的合并".into());
    }
    let status = git_merge_status(path)?;
    if status.conflict_count > 0 {
        return Err(format!(
            "仍有 {} 个冲突文件未解决",
            status.conflict_count
        ));
    }

    let msg = message
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let incoming = status.incoming.unwrap_or_else(|| "branch".into());
            format!("Merge branch '{incoming}'")
        });

    let output = git_command(path)
        .args(["commit", "-m", &msg])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "合并提交失败".into()
        } else {
            err
        });
    }
    let mut msg = format!("merge committed: {msg}");
    pop_auto_stash(path, &mut msg);
    Ok(msg)
}
