//! The testable run driver (Stage R5a).
//!
//! [`drive_run`] is the seam between the pure R4 orchestrator ([`run_agent`])
//! and the app: it seeds a workspace/ledger/journal from a [`RunConfig`], runs
//! the agent loop, and streams every transition to an injected `emit` callback
//! as a [`RunEvent`]. The Tauri command in [`super::commands`] is a thin wrapper
//! that supplies real dependencies and an `emit` closure that forwards to the
//! `dirac://run-event` window event — so the run logic itself stays unit-tested
//! here with a scripted model and mock kernel, never an untestable black box.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::analysis::BackendInfo;
use super::budget::BudgetLedger;
use super::journal::{Journal, JournalEntry, MemJournal};
use super::kernel::AgentKernel;
use super::orchestrator::{run_agent, AgentBudget, AgentRunResult, ModelPort, RunState};
use super::policy::{AutonomyPolicy, SubmissionFacts};
use super::submit::SubmitPort;
use super::tool_exec::ToolContext;
use super::workspace::{ApplyPatchResult, MemWorkspace, Workspace, WorkspaceFile};

/// Real-money hardware is OFF for an agent run (safe policy), so the spend
/// ledger's ceiling is zero: no autonomous submission can reserve budget. The
/// policy gate already blocks paid QPU jobs; this is defence in depth.
const RUN_BUDGET_CEILING: f64 = 0.0;

/// One file used to seed the run's workspace (the frontend's editor buffers).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunSeedFile {
    pub path: String,
    pub framework: String,
    pub content: String,
}

/// Everything a single run needs, assembled by the command layer from the
/// frontend's request plus a freshly minted `run_id`.
#[derive(Debug, Clone)]
pub struct RunConfig {
    pub goal: String,
    pub files: Vec<RunSeedFile>,
    pub active_path: String,
    pub model: String,
    pub run_id: String,
}

/// The injected, borrowed dependencies of a run. Tests pass mocks; the command
/// passes the real gateway-backed model, `RealKernel`, and submit port.
pub struct RunDeps<'a> {
    pub model: &'a dyn ModelPort,
    pub kernel: &'a dyn AgentKernel,
    pub submit: &'a dyn SubmitPort,
    pub policy: &'a AutonomyPolicy,
    pub get_backends: &'a dyn Fn() -> Vec<BackendInfo>,
}

/// A single streamed progress event. `#[serde(tag = "kind")]` with camelCase
/// variants + fields so the React run-card can consume it as a discriminated
/// union off `dirac://run-event` (e.g. `{ kind: "toolCall", runId, toolCallId,
/// tool, input }`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RunEvent {
    Started {
        run_id: String,
        goal: String,
    },
    State {
        run_id: String,
        state: RunState,
    },
    ModelText {
        run_id: String,
        text: String,
    },
    ToolCall {
        run_id: String,
        tool_call_id: String,
        tool: String,
        input: Value,
    },
    ToolResult {
        run_id: String,
        tool_call_id: String,
        tool: String,
        ok: bool,
        facts: Value,
        diagnostics: Option<String>,
    },
    Patch {
        run_id: String,
        path: String,
        before_content: String,
        after_content: String,
        transaction_id: String,
    },
    Error {
        run_id: String,
        message: String,
    },
    Finished {
        run_id: String,
        success: bool,
        iterations: u32,
        summary: String,
    },
}

impl RunEvent {
    /// Map a journal entry to its streamed event. Patch events are NOT produced
    /// here (they need the workspace to recover file content); [`EmittingJournal`]
    /// emits those separately.
    pub fn from_journal(run_id: &str, entry: &JournalEntry) -> RunEvent {
        match entry {
            JournalEntry::StateChange { to, .. } => RunEvent::State {
                run_id: run_id.to_string(),
                state: *to,
            },
            JournalEntry::ModelText { text, .. } => RunEvent::ModelText {
                run_id: run_id.to_string(),
                text: text.clone(),
            },
            JournalEntry::ToolCall {
                tool_call_id,
                tool,
                input,
                ..
            } => RunEvent::ToolCall {
                run_id: run_id.to_string(),
                tool_call_id: tool_call_id.clone(),
                tool: tool.clone(),
                input: input.clone(),
            },
            JournalEntry::ToolResult { evidence, .. } => RunEvent::ToolResult {
                run_id: run_id.to_string(),
                tool_call_id: evidence.tool_call_id.clone(),
                tool: evidence.tool.clone(),
                ok: evidence.ok,
                facts: evidence.facts.clone(),
                diagnostics: evidence.diagnostics.clone(),
            },
            JournalEntry::Error { message, .. } => RunEvent::Error {
                run_id: run_id.to_string(),
                message: message.clone(),
            },
        }
    }
}

/// A [`Workspace`] view over a shared [`MemWorkspace`]. The driver keeps a
/// second handle to the same store so [`EmittingJournal`] can recover a patch's
/// before/after content when it sees an `apply_patch` result — the mutex is
/// only ever held for the duration of a single delegated call, so the journal
/// (which locks only AFTER a tool call has fully returned) never contends with
/// an in-flight mutation. Lock poisoning degrades gracefully; it never panics.
struct SharedWorkspace {
    inner: Arc<Mutex<MemWorkspace>>,
}

impl Workspace for SharedWorkspace {
    fn list_files(&self) -> Vec<WorkspaceFile> {
        self.inner
            .lock()
            .map(|w| w.list_files())
            .unwrap_or_default()
    }

    fn read_file(&self, path: &str) -> Option<WorkspaceFile> {
        self.inner.lock().ok().and_then(|w| w.read_file(path))
    }

    fn apply_patch(
        &mut self,
        path: &str,
        new_content: &str,
        expected_before_hash: Option<&str>,
    ) -> ApplyPatchResult {
        match self.inner.lock() {
            Ok(mut w) => w.apply_patch(path, new_content, expected_before_hash),
            // Never reached in practice (single-threaded run); a poisoned lock
            // reports a conflict rather than panicking or silently mutating.
            Err(_) => ApplyPatchResult::Conflict {
                current_hash: String::new(),
            },
        }
    }

    fn rollback(&mut self, txn_id: &str) -> bool {
        self.inner
            .lock()
            .map(|mut w| w.rollback(txn_id))
            .unwrap_or(false)
    }

    fn active_path(&self) -> String {
        self.inner
            .lock()
            .map(|w| w.active_path())
            .unwrap_or_default()
    }
}

/// A [`Journal`] that mirrors every append into an `emit` callback (as a
/// [`RunEvent`]) on top of an in-memory [`MemJournal`]. When it observes a
/// successful `apply_patch` result, it also emits a [`RunEvent::Patch`] carrying
/// the full before/after content read back from the shared workspace, so the
/// frontend can apply the edit to its editor.
struct EmittingJournal<'a> {
    inner: MemJournal,
    run_id: String,
    workspace: Arc<Mutex<MemWorkspace>>,
    emit: &'a dyn Fn(RunEvent),
}

impl EmittingJournal<'_> {
    fn maybe_emit_patch(&self, entry: &JournalEntry) {
        let JournalEntry::ToolResult { evidence, .. } = entry else {
            return;
        };
        if evidence.tool != "apply_patch" || !evidence.ok {
            return;
        }
        let Some(txn_id) = evidence.facts.get("transaction_id").and_then(Value::as_str) else {
            return;
        };
        let txn = self
            .workspace
            .lock()
            .ok()
            .and_then(|w| w.transaction(txn_id));
        if let Some(txn) = txn {
            (self.emit)(RunEvent::Patch {
                run_id: self.run_id.clone(),
                path: txn.path,
                before_content: txn.before_content,
                after_content: txn.after_content,
                transaction_id: txn.id,
            });
        }
    }
}

impl Journal for EmittingJournal<'_> {
    fn append(&mut self, entry: JournalEntry) {
        (self.emit)(RunEvent::from_journal(&self.run_id, &entry));
        self.maybe_emit_patch(&entry);
        self.inner.append(entry);
    }

    fn entries(&self) -> Vec<JournalEntry> {
        self.inner.entries()
    }
}

/// Drive one agent run to completion, streaming progress through `emit`.
///
/// Seeds a [`MemWorkspace`] (behind a shared handle so patch content can be
/// recovered for `Patch` events), a fresh zero-ceiling [`BudgetLedger`], and an
/// [`EmittingJournal`]; emits [`RunEvent::Started`] first and
/// [`RunEvent::Finished`] last; and returns the R4 [`AgentRunResult`]. The
/// streamed events carry `config.run_id`; the returned result keeps the
/// orchestrator's own internal run id.
pub fn drive_run(
    config: &RunConfig,
    deps: RunDeps<'_>,
    cancel: &AtomicBool,
    emit: &dyn Fn(RunEvent),
) -> AgentRunResult {
    emit(RunEvent::Started {
        run_id: config.run_id.clone(),
        goal: config.goal.clone(),
    });

    let seed_files: Vec<WorkspaceFile> = config
        .files
        .iter()
        .map(|f| WorkspaceFile {
            path: f.path.clone(),
            framework: f.framework.clone(),
            content: f.content.clone(),
            dirty: false,
        })
        .collect();
    let active = if config.active_path.trim().is_empty() {
        None
    } else {
        Some(config.active_path.clone())
    };

    let shared = Arc::new(Mutex::new(MemWorkspace::new(seed_files, active)));
    let mut shared_ws = SharedWorkspace {
        inner: shared.clone(),
    };

    let mut ledger = BudgetLedger::new(RUN_BUDGET_CEILING);
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: deps.kernel,
        workspace: &mut shared_ws,
        policy: deps.policy,
        ledger: &mut ledger,
        submit_port: deps.submit,
        get_backends: deps.get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: None,
        last_result: None,
        last_known_hash: HashMap::new(),
    };

    let mut journal = EmittingJournal {
        inner: MemJournal::new(),
        run_id: config.run_id.clone(),
        workspace: shared.clone(),
        emit,
    };

    let now = || Instant::now();
    let result = run_agent(
        &config.goal,
        deps.model,
        &mut ctx,
        &mut journal,
        AgentBudget::default(),
        cancel,
        &now,
    );

    emit(RunEvent::Finished {
        run_id: config.run_id.clone(),
        success: result.success,
        iterations: result.iterations,
        summary: result.summary.clone(),
    });

    result
}

#[cfg(test)]
mod tests;
