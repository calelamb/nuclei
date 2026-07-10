//! Append-only run journal (Stage R4 port of `src/services/agent/journal.ts`
//! and the `JournalEntry` type). Every entry is timestamped and tagged with a
//! `kind` so a run can be replayed, serialized, or inspected without
//! re-deriving state from the raw model transcript. Persistence and restart
//! recovery are deferred to R5; this stage provides the in-memory
//! [`MemJournal`] plus JSON round-trip helpers.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::orchestrator::RunState;
use super::tool_exec::ToolEvidence;

/// One append-only journal entry. Discriminated by `kind` on the wire so it
/// serializes to a stable, replayable shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum JournalEntry {
    StateChange {
        ts: u64,
        from: RunState,
        to: RunState,
    },
    ModelText {
        ts: u64,
        text: String,
    },
    ToolCall {
        ts: u64,
        tool_call_id: String,
        tool: String,
        input: Value,
    },
    ToolResult {
        ts: u64,
        evidence: ToolEvidence,
    },
    Error {
        ts: u64,
        message: String,
    },
}

/// The append-only run log. Entries are immutable once appended.
pub trait Journal {
    fn append(&mut self, entry: JournalEntry);
    fn entries(&self) -> Vec<JournalEntry>;
}

/// Vec-backed in-memory [`Journal`] (port of `InMemoryJournal`).
#[derive(Debug, Default)]
pub struct MemJournal {
    log: Vec<JournalEntry>,
}

impl MemJournal {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Journal for MemJournal {
    fn append(&mut self, entry: JournalEntry) {
        self.log.push(entry);
    }

    fn entries(&self) -> Vec<JournalEntry> {
        self.log.clone()
    }
}

/// JSON round-trip helpers so a run journal can be persisted later without
/// coupling this layer to any particular storage mechanism (port of
/// `serializeJournal`/`deserializeJournal`). Unused until R5 wires persistence.
#[allow(dead_code)]
pub fn serialize_journal(entries: &[JournalEntry]) -> String {
    serde_json::to_string(entries).unwrap_or_else(|_| "[]".to_string())
}

#[allow(dead_code)]
pub fn deserialize_journal(json: &str) -> Vec<JournalEntry> {
    serde_json::from_str(json).unwrap_or_default()
}
