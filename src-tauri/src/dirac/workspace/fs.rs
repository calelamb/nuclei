//! Filesystem-backed [`Workspace`] implementation, rooted at a project
//! directory. Every path is resolved relative to the root and confirmed to
//! stay within it before any read or write — a relative path containing
//! `..` segments (or an absolute path) that would escape the root is
//! rejected rather than followed, guarding against a rogue tool call walking
//! the patch target outside the project.
//!
//! Semantics otherwise mirror [`super::mem::MemWorkspace`]: `apply_patch`
//! conflict-checks against the caller's expected before-hash, and `rollback`
//! only succeeds while the file's current content hash still matches what
//! the transaction left behind.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};

use super::{
    hash_content, now_millis, ApplyPatchResult, PatchTransaction, Workspace, WorkspaceFile,
};

/// Lexically normalizes `..`/`.` components without touching the
/// filesystem (the target may not exist yet, so `Path::canonicalize` can't
/// be used for a write target). This is the same "pop on ParentDir"
/// approach most path-traversal guards use.
fn normalize_lexically(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                result.pop();
            }
            Component::CurDir => {}
            other => result.push(other.as_os_str()),
        }
    }
    result
}

fn framework_for_path(path: &str) -> String {
    if path.ends_with(".qs") {
        "qsharp".to_string()
    } else {
        "qiskit".to_string()
    }
}

/// Filesystem-backed workspace rooted at `root`. `root` is canonicalized at
/// construction so every subsequent path resolution compares against a
/// stable, symlink-resolved base.
pub struct FsWorkspace {
    root: PathBuf,
    transactions: HashMap<String, PatchTransaction>,
    txn_counter: u64,
    /// Paths touched by `apply_patch`/`rollback` this session — the
    /// filesystem has no built-in "dirty" bit, so it is tracked here,
    /// matching the in-memory workspace's per-file dirty flag.
    dirty: HashSet<String>,
    active: String,
}

impl FsWorkspace {
    /// Opens a workspace rooted at `root`. Fails if `root` cannot be
    /// canonicalized (e.g. it doesn't exist).
    pub fn new(root: impl Into<PathBuf>) -> std::io::Result<Self> {
        let root = root.into().canonicalize()?;
        Ok(Self {
            root,
            transactions: HashMap::new(),
            txn_counter: 0,
            dirty: HashSet::new(),
            active: String::new(),
        })
    }

    /// Opens a workspace rooted at `root` with a pre-set active file path.
    pub fn with_active(
        root: impl Into<PathBuf>,
        active: impl Into<String>,
    ) -> std::io::Result<Self> {
        let mut workspace = Self::new(root)?;
        workspace.active = active.into();
        Ok(workspace)
    }

    /// Resolves `path` relative to the root, rejecting anything that would
    /// escape it (an absolute path, or `..` segments that normalize outside
    /// the root).
    fn safe_path(&self, path: &str) -> Option<PathBuf> {
        if path.is_empty() || Path::new(path).is_absolute() {
            return None;
        }
        let candidate = normalize_lexically(&self.root.join(path));
        if candidate.starts_with(&self.root) {
            Some(candidate)
        } else {
            None
        }
    }

    fn collect_files(
        root: &Path,
        dir: &Path,
        dirty: &HashSet<String>,
        out: &mut Vec<WorkspaceFile>,
    ) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                Self::collect_files(root, &path, dirty, out);
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(relative) = path.strip_prefix(root) else {
                continue;
            };
            let rel = relative.to_string_lossy().replace('\\', "/");
            out.push(WorkspaceFile {
                framework: framework_for_path(&rel),
                dirty: dirty.contains(&rel),
                path: rel,
                content,
            });
        }
    }
}

impl Workspace for FsWorkspace {
    fn list_files(&self) -> Vec<WorkspaceFile> {
        let mut out = Vec::new();
        Self::collect_files(&self.root, &self.root, &self.dirty, &mut out);
        out
    }

    fn read_file(&self, path: &str) -> Option<WorkspaceFile> {
        let target = self.safe_path(path)?;
        let content = std::fs::read_to_string(target).ok()?;
        Some(WorkspaceFile {
            path: path.to_string(),
            framework: framework_for_path(path),
            content,
            dirty: self.dirty.contains(path),
        })
    }

    fn apply_patch(
        &mut self,
        path: &str,
        new_content: &str,
        expected_before_hash: Option<&str>,
    ) -> ApplyPatchResult {
        let Some(target) = self.safe_path(path) else {
            // Path traversal (or an otherwise invalid path): treated as a
            // conflict rather than a panic or a silent write outside root.
            return ApplyPatchResult::Conflict {
                current_hash: String::new(),
            };
        };

        let before_content = std::fs::read_to_string(&target).unwrap_or_default();
        let before_hash = hash_content(&before_content);

        if let Some(expected) = expected_before_hash {
            if expected != before_hash {
                return ApplyPatchResult::Conflict {
                    current_hash: before_hash,
                };
            }
        }

        if let Some(parent) = target.parent() {
            if std::fs::create_dir_all(parent).is_err() {
                return ApplyPatchResult::Conflict {
                    current_hash: before_hash,
                };
            }
        }
        if std::fs::write(&target, new_content).is_err() {
            return ApplyPatchResult::Conflict {
                current_hash: before_hash,
            };
        }

        let after_hash = hash_content(new_content);
        self.txn_counter += 1;
        let transaction = PatchTransaction {
            id: format!("txn_{}_{}", self.txn_counter, after_hash),
            path: path.to_string(),
            before_content,
            after_content: new_content.to_string(),
            before_hash,
            after_hash,
            applied_at: now_millis(),
            rolled_back: false,
        };

        self.dirty.insert(path.to_string());
        self.transactions
            .insert(transaction.id.clone(), transaction.clone());
        ApplyPatchResult::Applied(transaction)
    }

    fn rollback(&mut self, txn_id: &str) -> bool {
        let Some(transaction) = self.transactions.get(txn_id).cloned() else {
            return false;
        };
        if transaction.rolled_back {
            return false;
        }

        let Some(target) = self.safe_path(&transaction.path) else {
            return false;
        };
        let current_content = std::fs::read_to_string(&target).unwrap_or_default();
        let current_hash = hash_content(&current_content);
        if current_hash != transaction.after_hash {
            return false;
        }

        if std::fs::write(&target, &transaction.before_content).is_err() {
            return false;
        }
        self.dirty.insert(transaction.path.clone());
        if let Some(t) = self.transactions.get_mut(txn_id) {
            t.rolled_back = true;
        }
        true
    }

    fn active_path(&self) -> String {
        self.active.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_workspace() -> (tempfile::TempDir, FsWorkspace) {
        let dir = tempfile::tempdir().expect("tempdir should be creatable");
        std::fs::write(dir.path().join("main.py"), "print(\"hello\")\n")
            .expect("initial file should be writable");
        let workspace =
            FsWorkspace::with_active(dir.path(), "main.py").expect("root should canonicalize");
        (dir, workspace)
    }

    #[test]
    fn reads_a_known_file_and_returns_none_for_an_unknown_one() {
        let (_dir, ws) = make_workspace();
        assert_eq!(
            ws.read_file("main.py").map(|f| f.content),
            Some("print(\"hello\")\n".to_string())
        );
        assert!(ws.read_file("missing.py").is_none());
        assert_eq!(ws.active_path(), "main.py");
    }

    #[test]
    fn apply_patch_creates_a_transaction_and_writes_the_file() {
        let (dir, mut ws) = make_workspace();
        let new_content = "print(\"goodbye\")\n";
        let result = ws.apply_patch("main.py", new_content, None);

        let ApplyPatchResult::Applied(transaction) = result else {
            panic!("expected an applied transaction, not a conflict");
        };
        assert_eq!(transaction.before_content, "print(\"hello\")\n");
        assert_eq!(transaction.after_content, new_content);

        let on_disk =
            std::fs::read_to_string(dir.path().join("main.py")).expect("file should exist");
        assert_eq!(on_disk, new_content);
        assert_eq!(ws.read_file("main.py").map(|f| f.dirty), Some(true));
    }

    #[test]
    fn apply_patch_reports_a_conflict_and_does_not_write_when_expected_before_hash_mismatches() {
        let (dir, mut ws) = make_workspace();
        let result = ws.apply_patch("main.py", "print(\"nope\")\n", Some("not-the-real-hash"));

        assert!(matches!(result, ApplyPatchResult::Conflict { .. }));
        let on_disk =
            std::fs::read_to_string(dir.path().join("main.py")).expect("file should exist");
        assert_eq!(on_disk, "print(\"hello\")\n");
    }

    #[test]
    fn rollback_restores_content_when_nothing_has_changed_since() {
        let (dir, mut ws) = make_workspace();
        let ApplyPatchResult::Applied(transaction) =
            ws.apply_patch("main.py", "print(\"v2\")\n", None)
        else {
            panic!("expected an applied transaction");
        };

        assert!(ws.rollback(&transaction.id));
        let on_disk =
            std::fs::read_to_string(dir.path().join("main.py")).expect("file should exist");
        assert_eq!(on_disk, "print(\"hello\")\n");
    }

    #[test]
    fn rollback_fails_if_the_file_content_changed_since_the_patch_was_applied() {
        let (_dir, mut ws) = make_workspace();
        let ApplyPatchResult::Applied(first) = ws.apply_patch("main.py", "print(\"v2\")\n", None)
        else {
            panic!("expected an applied transaction");
        };
        ws.apply_patch("main.py", "print(\"v3\")\n", None);

        assert!(!ws.rollback(&first.id));
        assert_eq!(
            ws.read_file("main.py").map(|f| f.content),
            Some("print(\"v3\")\n".to_string())
        );
    }

    #[test]
    fn rejects_a_path_traversal_escape_attempt() {
        let (_dir, mut ws) = make_workspace();

        assert!(ws.read_file("../outside.py").is_none());

        let result = ws.apply_patch("../../etc/passwd", "malicious\n", None);
        assert!(matches!(result, ApplyPatchResult::Conflict { .. }));
    }

    #[test]
    fn rejects_an_absolute_path_escape_attempt() {
        let (_dir, mut ws) = make_workspace();

        assert!(ws.read_file("/etc/passwd").is_none());

        let result = ws.apply_patch("/etc/passwd", "malicious\n", None);
        assert!(matches!(result, ApplyPatchResult::Conflict { .. }));
    }

    #[test]
    fn list_files_includes_files_written_under_the_root() {
        let (_dir, ws) = make_workspace();
        let files = ws.list_files();
        assert!(files.iter().any(|f| f.path == "main.py"));
    }
}
