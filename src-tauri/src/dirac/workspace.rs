//! Project reads plus reversible, hash-checked patch transactions (Stage R3
//! port of `src/services/agent/workspace.ts`'s semantics).
//!
//! Every edit produces a [`PatchTransaction`]; `apply_patch` conflict-checks
//! against the caller's expectation of the file's current content (not a
//! full VCS, just a cheap optimistic-concurrency check), and `rollback` only
//! succeeds while the file's content still matches what the patch left
//! behind.
//!
//! Two implementations are provided:
//! - [`mem::MemWorkspace`] — in-memory, the direct port of the TS
//!   `InMemoryWorkspace` and the reference both for tests and for the
//!   semantics every other implementation must follow.
//! - [`fs::FsWorkspace`] — filesystem-backed, rooted at a project directory;
//!   every path is canonicalized and confirmed to stay within the root.
//!
//! Content hashing here uses SHA-256 (via `sha2`/`hex`) rather than porting
//! the TS FNV-1a implementation (`src/services/agent/hash.ts`) verbatim:
//! cross-language hash exactness is not required because this store is
//! desktop-authoritative (Rust never needs to validate a hash computed by the
//! TS side), and SHA-256 gives a much lower collision probability for a
//! conflict-detection mechanism that gates file mutation.
//!
//! Stage R4's orchestrator is the first live caller of this module; until
//! then it is exercised only by its own unit tests. The allow below covers
//! both the not-yet-called functions and the re-exports below (which have
//! no live caller yet either) — every path already has a unit test in this
//! module or its submodules.
#![allow(dead_code, unused_imports)] // remove-me: wired up by the Stage R4 orchestrator.

pub mod fs;
pub mod mem;

pub use fs::FsWorkspace;
pub use mem::MemWorkspace;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Deterministic, non-cryptographic-use content hash for conflict detection.
/// Not a security boundary — just "has this file changed since I last looked
/// at it".
pub fn hash_content(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    hex::encode(digest)
}

/// A file as seen by a [`Workspace`] implementation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceFile {
    pub path: String,
    pub framework: String,
    pub content: String,
    pub dirty: bool,
}

/// A reversible, hash-verified record of one `apply_patch` call. Rollback is
/// only permitted while the file's current content hash still matches
/// `after_hash` — if something else changed the file since, rollback fails
/// loudly instead of silently clobbering someone else's edit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PatchTransaction {
    pub id: String,
    pub path: String,
    pub before_content: String,
    pub after_content: String,
    pub before_hash: String,
    pub after_hash: String,
    pub applied_at: u64,
    pub rolled_back: bool,
}

/// Result of an `apply_patch` call: either the transaction that was applied,
/// or a conflict carrying the file's actual current hash so the caller can
/// decide how to reconcile.
#[derive(Debug, Clone, PartialEq)]
pub enum ApplyPatchResult {
    Applied(PatchTransaction),
    Conflict { current_hash: String },
}

/// A project's file store, with reversible, conflict-checked patches. No
/// method ever panics; every failure mode is represented in the return
/// value.
pub trait Workspace {
    fn list_files(&self) -> Vec<WorkspaceFile>;
    fn read_file(&self, path: &str) -> Option<WorkspaceFile>;
    fn apply_patch(
        &mut self,
        path: &str,
        new_content: &str,
        expected_before_hash: Option<&str>,
    ) -> ApplyPatchResult;
    fn rollback(&mut self, txn_id: &str) -> bool;
    fn active_path(&self) -> String;
}

/// Milliseconds since the Unix epoch, saturating on any clock error rather
/// than panicking (a monotonic-enough stand-in for `Date.now()`).
pub(crate) fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
