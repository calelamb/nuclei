//! Git provenance for experiment manifests (PRD 09 Phase C, C4).
//!
//! Shells out to the system `git` — no libgit2 dependency. The command is
//! deliberately infallible from the frontend's perspective: any problem
//! (path isn't a repo, git not installed, command failure) resolves to
//! `None` so the runner records `"git": null` in the manifest rather than
//! aborting a sweep. This mirrors the PRD's "honest reproducibility" stance:
//! we never fabricate a commit.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

/// Commit hash + working-tree dirtiness for a project directory.
#[derive(Debug, Clone, Serialize)]
pub struct GitProjectInfo {
    /// Full 40-char HEAD commit SHA.
    pub commit: String,
    /// True when `git status --porcelain` reports any change (staged,
    /// unstaged, or untracked) — i.e. the tree does not exactly match HEAD.
    pub dirty: bool,
}

/// Run a git subcommand rooted at `path`, returning trimmed stdout on
/// success. `-C <path>` makes git resolve the repo from that directory
/// without changing our process's cwd.
fn git_output(path: &Path, args: &[&str]) -> Option<String> {
    let mut full: Vec<&str> = vec!["-C", path.to_str()?];
    full.extend_from_slice(args);
    let out = Command::new("git").args(&full).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Resolve HEAD commit + dirty flag for `path`. `None` when the directory is
/// not a git repository, git is unavailable, or HEAD can't be resolved
/// (e.g. a fresh repo with no commits yet).
pub fn project_info(path: &Path) -> Option<GitProjectInfo> {
    // `rev-parse HEAD` fails on a repo with no commits and on non-repos.
    let commit = git_output(path, &["rev-parse", "HEAD"])?;
    if commit.is_empty() {
        return None;
    }
    // Any porcelain output means the tree differs from HEAD.
    let dirty = match git_output(path, &["status", "--porcelain"]) {
        Some(status) => !status.is_empty(),
        None => false,
    };
    Some(GitProjectInfo { commit, dirty })
}

/// Tauri command wrapper. Returns `Ok(None)` for every failure mode so the
/// frontend contract is "a repo → info, otherwise null" with no error path.
#[tauri::command]
pub fn git_project_info(path: String) -> Result<Option<GitProjectInfo>, String> {
    Ok(project_info(Path::new(&path)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn run(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args({
                let mut v = vec!["-C", dir.to_str().unwrap()];
                v.extend_from_slice(args);
                v
            })
            .output()
            .expect("git should be available in the test environment");
        assert!(status.status.success(), "git {:?} failed", args);
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let mut base = std::env::temp_dir();
        base.push(format!(
            "nuclei-git-info-{}-{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn non_repo_returns_none() {
        let dir = temp_dir("non-repo");
        assert!(project_info(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clean_repo_reports_commit_not_dirty() {
        let dir = temp_dir("clean");
        run(&dir, &["init"]);
        run(&dir, &["config", "user.email", "t@t.test"]);
        run(&dir, &["config", "user.name", "Tester"]);
        std::fs::write(dir.join("a.txt"), "hello").unwrap();
        run(&dir, &["add", "."]);
        run(&dir, &["commit", "-m", "init"]);

        let info = project_info(&dir).expect("committed repo should resolve");
        assert_eq!(info.commit.len(), 40);
        assert!(!info.dirty);

        // Adding an untracked file makes it dirty.
        std::fs::write(dir.join("b.txt"), "world").unwrap();
        let dirty = project_info(&dir).expect("still a repo");
        assert!(dirty.dirty);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
