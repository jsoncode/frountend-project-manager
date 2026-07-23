use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

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

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
    let git_dir = std::path::Path::new(path).join(".git");
    if !git_dir.exists() {
        return Err("非 Git 仓库".into());
    }

    let current = git_command(path)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    let output = git_command(path)
        .args(["status", "--porcelain=v1", "-unormal"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "git status failed".into()
        } else {
            err
        });
    }

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
