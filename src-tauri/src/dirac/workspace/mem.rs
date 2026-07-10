//! In-memory [`Workspace`] implementation — the direct port of the TS
//! `InMemoryWorkspace` and the reference other implementations (e.g.
//! [`super::fs::FsWorkspace`]) must follow.

use std::collections::HashMap;

use super::{
    hash_content, now_millis, ApplyPatchResult, PatchTransaction, Workspace, WorkspaceFile,
};

const DEFAULT_FRAMEWORK: &str = "qiskit";

#[derive(Debug, Clone)]
struct FileRecord {
    content: String,
    framework: String,
    dirty: bool,
}

/// In-memory implementation of [`Workspace`]. Files are kept in an
/// insertion-ordered `Vec` (rather than a `HashMap`) so `list_files()` has a
/// stable, deterministic order matching the TS `Map`-backed original.
pub struct MemWorkspace {
    files: Vec<(String, FileRecord)>,
    transactions: HashMap<String, PatchTransaction>,
    active: String,
    txn_counter: u64,
}

impl MemWorkspace {
    pub fn new(initial_files: Vec<WorkspaceFile>, active_path: Option<String>) -> Self {
        let active = active_path.unwrap_or_else(|| {
            initial_files
                .first()
                .map(|f| f.path.clone())
                .unwrap_or_default()
        });
        let files = initial_files
            .into_iter()
            .map(|f| {
                (
                    f.path,
                    FileRecord {
                        content: f.content,
                        framework: f.framework,
                        dirty: f.dirty,
                    },
                )
            })
            .collect();
        Self {
            files,
            transactions: HashMap::new(),
            active,
            txn_counter: 0,
        }
    }

    fn find(&self, path: &str) -> Option<&FileRecord> {
        self.files.iter().find(|(p, _)| p == path).map(|(_, r)| r)
    }

    fn upsert(&mut self, path: &str, record: FileRecord) {
        if let Some(entry) = self.files.iter_mut().find(|(p, _)| p == path) {
            entry.1 = record;
        } else {
            self.files.push((path.to_string(), record));
        }
    }
}

impl Workspace for MemWorkspace {
    fn list_files(&self) -> Vec<WorkspaceFile> {
        self.files
            .iter()
            .map(|(path, record)| WorkspaceFile {
                path: path.clone(),
                framework: record.framework.clone(),
                content: record.content.clone(),
                dirty: record.dirty,
            })
            .collect()
    }

    fn read_file(&self, path: &str) -> Option<WorkspaceFile> {
        self.find(path).map(|record| WorkspaceFile {
            path: path.to_string(),
            framework: record.framework.clone(),
            content: record.content.clone(),
            dirty: record.dirty,
        })
    }

    fn apply_patch(
        &mut self,
        path: &str,
        new_content: &str,
        expected_before_hash: Option<&str>,
    ) -> ApplyPatchResult {
        let existing = self.find(path).cloned();
        let before_content = existing
            .as_ref()
            .map(|r| r.content.clone())
            .unwrap_or_default();
        let before_hash = hash_content(&before_content);

        if let Some(expected) = expected_before_hash {
            if expected != before_hash {
                return ApplyPatchResult::Conflict {
                    current_hash: before_hash,
                };
            }
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

        let framework = existing
            .map(|r| r.framework)
            .unwrap_or_else(|| DEFAULT_FRAMEWORK.to_string());
        self.upsert(
            path,
            FileRecord {
                content: new_content.to_string(),
                framework,
                dirty: true,
            },
        );
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

        let current_content = self
            .find(&transaction.path)
            .map(|r| r.content.clone())
            .unwrap_or_default();
        let current_hash = hash_content(&current_content);
        if current_hash != transaction.after_hash {
            return false;
        }

        let framework = self
            .find(&transaction.path)
            .map(|r| r.framework.clone())
            .unwrap_or_else(|| DEFAULT_FRAMEWORK.to_string());
        self.upsert(
            &transaction.path,
            FileRecord {
                content: transaction.before_content.clone(),
                framework,
                dirty: true,
            },
        );
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

    const FILE_PATH: &str = "main.py";
    const INITIAL_CONTENT: &str = "print(\"hello\")\n";

    fn make_workspace() -> MemWorkspace {
        MemWorkspace::new(
            vec![WorkspaceFile {
                path: FILE_PATH.to_string(),
                framework: "qiskit".to_string(),
                content: INITIAL_CONTENT.to_string(),
                dirty: false,
            }],
            None,
        )
    }

    #[test]
    fn lists_files_and_reports_the_active_path() {
        let ws = make_workspace();
        assert_eq!(
            ws.list_files(),
            vec![WorkspaceFile {
                path: FILE_PATH.to_string(),
                framework: "qiskit".to_string(),
                content: INITIAL_CONTENT.to_string(),
                dirty: false,
            }]
        );
        assert_eq!(ws.active_path(), FILE_PATH);
    }

    #[test]
    fn reads_a_known_file_and_returns_none_for_an_unknown_one() {
        let ws = make_workspace();
        assert_eq!(
            ws.read_file(FILE_PATH).map(|f| f.content),
            Some(INITIAL_CONTENT.to_string())
        );
        assert!(ws.read_file("missing.py").is_none());
    }

    #[test]
    fn apply_patch_creates_a_transaction_and_mutates_the_file() {
        let mut ws = make_workspace();
        let new_content = "print(\"goodbye\")\n";
        let result = ws.apply_patch(FILE_PATH, new_content, None);

        let ApplyPatchResult::Applied(transaction) = result else {
            panic!("expected an applied transaction, not a conflict");
        };

        assert_eq!(transaction.path, FILE_PATH);
        assert_eq!(transaction.before_content, INITIAL_CONTENT);
        assert_eq!(transaction.after_content, new_content);
        assert_eq!(transaction.before_hash, hash_content(INITIAL_CONTENT));
        assert_eq!(transaction.after_hash, hash_content(new_content));
        assert!(!transaction.rolled_back);
        assert!(!transaction.id.is_empty());

        assert_eq!(
            ws.read_file(FILE_PATH).map(|f| f.content),
            Some(new_content.to_string())
        );
        assert_eq!(ws.read_file(FILE_PATH).map(|f| f.dirty), Some(true));
    }

    #[test]
    fn apply_patch_reports_a_conflict_and_does_not_mutate_when_expected_before_hash_mismatches() {
        let mut ws = make_workspace();
        let result = ws.apply_patch(FILE_PATH, "print(\"nope\")\n", Some("not-the-real-hash"));

        match result {
            ApplyPatchResult::Conflict { current_hash } => {
                assert_eq!(current_hash, hash_content(INITIAL_CONTENT));
            }
            ApplyPatchResult::Applied(_) => panic!("expected a conflict"),
        }
        // Content must be untouched.
        assert_eq!(
            ws.read_file(FILE_PATH).map(|f| f.content),
            Some(INITIAL_CONTENT.to_string())
        );
        assert_eq!(ws.read_file(FILE_PATH).map(|f| f.dirty), Some(false));
    }

    #[test]
    fn apply_patch_succeeds_when_expected_before_hash_matches_the_current_hash() {
        let mut ws = make_workspace();
        let result = ws.apply_patch(
            FILE_PATH,
            "print(\"ok\")\n",
            Some(&hash_content(INITIAL_CONTENT)),
        );
        assert!(matches!(result, ApplyPatchResult::Applied(_)));
    }

    #[test]
    fn rollback_restores_content_when_nothing_has_changed_since() {
        let mut ws = make_workspace();
        let new_content = "print(\"goodbye\")\n";
        let ApplyPatchResult::Applied(transaction) = ws.apply_patch(FILE_PATH, new_content, None)
        else {
            panic!("expected an applied transaction");
        };

        assert!(ws.rollback(&transaction.id));
        assert_eq!(
            ws.read_file(FILE_PATH).map(|f| f.content),
            Some(INITIAL_CONTENT.to_string())
        );
    }

    #[test]
    fn rollback_fails_if_the_file_content_changed_since_the_patch_was_applied() {
        let mut ws = make_workspace();
        let ApplyPatchResult::Applied(first) = ws.apply_patch(FILE_PATH, "print(\"v2\")\n", None)
        else {
            panic!("expected an applied transaction");
        };

        // A second, unrelated edit lands on top.
        ws.apply_patch(FILE_PATH, "print(\"v3\")\n", None);

        assert!(!ws.rollback(&first.id));
        assert_eq!(
            ws.read_file(FILE_PATH).map(|f| f.content),
            Some("print(\"v3\")\n".to_string())
        );
    }

    #[test]
    fn rollback_fails_for_an_unknown_transaction_id() {
        let mut ws = make_workspace();
        assert!(!ws.rollback("does-not-exist"));
    }

    #[test]
    fn rollback_fails_if_called_twice_on_the_same_transaction() {
        let mut ws = make_workspace();
        let ApplyPatchResult::Applied(transaction) =
            ws.apply_patch(FILE_PATH, "print(\"v2\")\n", None)
        else {
            panic!("expected an applied transaction");
        };

        assert!(ws.rollback(&transaction.id));
        assert!(!ws.rollback(&transaction.id));
    }
}
