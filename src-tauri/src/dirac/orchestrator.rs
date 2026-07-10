//! The agent run loop + state machine (Stage R4 port of
//! `src/services/agent/orchestrator.ts`). Ties the model gateway, kernel,
//! workspace, policy, budget, and analysis into a working agentic quantum
//! coder: each turn the model proposes tool calls, the deterministic tool
//! executor runs them, and their evidence is fed back as the next turn's
//! `tool_result` — the multi-turn feedback that lets Dirac repair its own work.
//!
//! This module is the PURE, MOCKABLE core: no Tauri command or event surface
//! (that is R5). Everything is driven through the injectable [`ModelPort`],
//! [`ToolContext`], [`Journal`], clock, and cancellation flag, so the whole
//! loop is unit-testable with a scripted model and a mock kernel.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::gateway::{ModelGateway, ModelReply, ModelRequest};
use super::journal::{Journal, JournalEntry};
use super::tool_exec::{execute_tool, ToolContext};
use super::tools::agent_tools;

/// Lifecycle states for a single closed-loop agent run. A run begins in
/// `Planning`, spends the tool-use loop in `Working`, and always ends in
/// exactly one of `Completed`, `Failed`, or `Cancelled`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Planning,
    Working,
    Completed,
    Failed,
    Cancelled,
}

/// Hard limits on a run: the maximum number of model turns and the wall-clock
/// budget. Defaults mirror the TS `DEFAULT_BUDGET` (12 iterations / 120s).
#[derive(Debug, Clone, Copy)]
pub struct AgentBudget {
    pub max_iterations: u32,
    pub max_wall: Duration,
}

impl Default for AgentBudget {
    fn default() -> Self {
        Self {
            max_iterations: 12,
            max_wall: Duration::from_secs(120),
        }
    }
}

/// The result of a single agent run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunResult {
    pub run_id: String,
    pub state: RunState,
    pub success: bool,
    pub iterations: u32,
    pub summary: String,
    pub journal: Vec<JournalEntry>,
}

/// A non-streaming, multi-turn model turn. Implemented by [`GatewayModel`]
/// (real) over the R2 [`ModelGateway`] and by a scripted model in tests.
pub trait ModelPort {
    fn complete(
        &self,
        system: &str,
        messages: &[Value],
        tools: &[Value],
    ) -> Result<ModelReply, String>;
}

/// Default Anthropic model + token budget for a live run. The intent router in
/// the frontend picks Haiku/Sonnet per turn in the full product; the harness
/// core uses one capable default.
const DEFAULT_MODEL: &str = "claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// [`ModelPort`] backed by the secure R2 [`ModelGateway`]. The Anthropic key
/// never leaves the gateway; this adapter only shapes the request.
pub struct GatewayModel<'a> {
    gateway: &'a ModelGateway,
    model: String,
    max_tokens: u32,
}

impl<'a> GatewayModel<'a> {
    pub fn new(gateway: &'a ModelGateway) -> Self {
        Self {
            gateway,
            model: DEFAULT_MODEL.to_string(),
            max_tokens: DEFAULT_MAX_TOKENS,
        }
    }
}

impl ModelPort for GatewayModel<'_> {
    fn complete(
        &self,
        system: &str,
        messages: &[Value],
        tools: &[Value],
    ) -> Result<ModelReply, String> {
        let request = ModelRequest {
            model: self.model.clone(),
            max_tokens: self.max_tokens,
            system: system.to_string(),
            messages: messages.to_vec(),
            tools: tools.to_vec(),
        };
        self.gateway.complete(&request).map_err(|e| e.to_string())
    }
}

const SYSTEM_PROMPT: &str = "You are Dirac, an autonomous quantum-programming agent embedded in the Nuclei IDE.

Given a goal, use the provided tools to write, parse, and simulate a quantum program until you have
VERIFIED it meets the goal — never assume or invent a result you haven't actually observed.

Rules:
- Use apply_patch to write or edit code. Every edit is reversible and journaled; use rollback_patch if an
  edit turns out to be wrong.
- Use parse_quantum_program to check structure/syntax before simulating. You may also use
  validate_quantum_program to catch semantic issues (out-of-range qubits, control/target collisions,
  arity mismatches) and estimate_quantum_resources to check qubit/gate/depth cost, either before or after
  simulating.
- Use run_simulation to execute the program locally and obtain real probabilities and measurements.
- Use compare_quantum_results to check the simulated probabilities against a numeric success criterion,
  when one was given.
- After simulating a circuit you recognize as a canonical educational algorithm (Bell pair, GHZ state, or
  uniform superposition), you may call check_algorithm_invariant to verify the result against that
  algorithm's known-correct reference distribution instead of hand-deriving expected_probabilities yourself.
- You may call plan_hardware_run to get a shadow-mode recommendation of a compatible hardware backend for
  the circuit, with an explainable score; this is analysis only for the user's consideration — it never
  submits a job or contacts a provider, and it is not a substitute for run_simulation.
- You may call preview_backend_transpilation to see real post-transpile depth, gate-count, and two-qubit-
  count metrics for a target backend's basis gates and coupling map (Qiskit circuits only) before
  recommending or (if enabled) submitting a hardware run.
- You may submit a job to real quantum hardware ONLY via submit_hardware_job. This tool is policy-gated by a
  human-controlled autonomy setting: real, paid QPU submissions are disabled by default, and a
  \"needs_approval\" or \"deny\" result means NOTHING was submitted. That is the expected, safe outcome — do not
  retry submit_hardware_job to try to force it through; instead, report the result plainly to the user and
  stop. Once a job has actually been submitted, use poll_hardware_job to check its status and
  analyze_hardware_result to read back its measured probabilities (optionally against an expected
  distribution); cancel_hardware_job cancels a still-pending job. Real hardware costs real money.
- Only call finish once you have verified your result via run_simulation (and compare_quantum_results when
  a numeric target was given), or once you are truly blocked and cannot proceed further. Never call finish
  with success: true without having actually run the simulation.
- If a tool reports an error or a conflict, read it, adjust your approach, and try again — you have a
  limited number of turns.";

static RUN_COUNTER: AtomicU64 = AtomicU64::new(0);

fn generate_run_id() -> String {
    let n = RUN_COUNTER.fetch_add(1, Ordering::SeqCst);
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("run_{ms:x}_{n}")
}

/// The seed user message: goal plus a snapshot of the workspace so the model
/// knows what files exist before its first tool call.
fn build_seed_message(goal: &str, ctx: &ToolContext) -> Value {
    let paths: Vec<String> = ctx
        .workspace
        .list_files()
        .into_iter()
        .map(|f| f.path)
        .collect();
    let files_line = if paths.is_empty() {
        "(none yet)".to_string()
    } else {
        paths.join(", ")
    };
    let active = ctx.workspace.active_path();
    let active_line = if active.is_empty() {
        "(none)".to_string()
    } else {
        active
    };
    let hint = format!(
        "Goal: {goal}\n\nWorkspace files: {files_line}.\nActive file: {active_line}.\nCall inspect_project first if you need to see current file contents before editing."
    );
    json!({ "role": "user", "content": hint })
}

/// Run one closed-loop agent run to completion, failure, or cancellation.
///
/// The loop, faithful to `orchestrator.ts`: build the system prompt + seed
/// message; each iteration call the model, run every proposed tool through
/// [`execute_tool`], append the assistant `tool_use` and the user `tool_result`
/// (the multi-turn feedback), and journal every transition. A successful
/// `finish` sets the verdict; `max_iterations`/`max_wall` bound the run;
/// `cancel` yields `Cancelled`; a model error becomes a journaled error and
/// ends the loop (bounded repair, never a panic).
#[allow(clippy::too_many_arguments)]
pub fn run_agent(
    goal: &str,
    model: &dyn ModelPort,
    ctx: &mut ToolContext,
    journal: &mut dyn Journal,
    budget: AgentBudget,
    cancel: &AtomicBool,
    now: &dyn Fn() -> Instant,
) -> AgentRunResult {
    let run_id = generate_run_id();
    let started = now();
    let ts = || now().saturating_duration_since(started).as_millis() as u64;

    let tools = agent_tools();
    let mut messages: Vec<Value> = vec![build_seed_message(goal, ctx)];

    let mut state = RunState::Planning;
    journal.append(JournalEntry::StateChange {
        ts: ts(),
        from: state,
        to: RunState::Working,
    });
    state = RunState::Working;

    let mut last_compare_matched: Option<bool> = None;
    let mut iterations: u32 = 0;
    let mut success = false;
    let mut summary = String::new();
    let mut finished = false;

    while iterations < budget.max_iterations {
        if cancel.load(Ordering::SeqCst) {
            journal.append(JournalEntry::StateChange {
                ts: ts(),
                from: state,
                to: RunState::Cancelled,
            });
            state = RunState::Cancelled;
            return AgentRunResult {
                run_id,
                state,
                success: false,
                iterations,
                summary: "Run cancelled.".to_string(),
                journal: journal.entries(),
            };
        }

        if now().saturating_duration_since(started) > budget.max_wall {
            break;
        }

        iterations += 1;

        let reply = match model.complete(SYSTEM_PROMPT, &messages, &tools) {
            Ok(reply) => reply,
            Err(message) => {
                journal.append(JournalEntry::Error { ts: ts(), message });
                break;
            }
        };

        if !reply.text.is_empty() {
            journal.append(JournalEntry::ModelText {
                ts: ts(),
                text: reply.text.clone(),
            });
        }

        if reply.tool_uses.is_empty() {
            finished = true;
            success = last_compare_matched == Some(true);
            summary = if success {
                "Model ended the turn without calling finish, but a prior comparison had already matched.".to_string()
            } else {
                "Model ended the turn without calling finish or verifying a matching result."
                    .to_string()
            };
            break;
        }

        // Assistant turn: text (if any) followed by every proposed tool_use.
        let mut assistant_content: Vec<Value> = Vec::new();
        if !reply.text.is_empty() {
            assistant_content.push(json!({ "type": "text", "text": reply.text }));
        }
        for tu in &reply.tool_uses {
            assistant_content.push(json!({
                "type": "tool_use",
                "id": tu.id,
                "name": tu.name,
                "input": tu.input,
            }));
        }
        messages.push(json!({ "role": "assistant", "content": assistant_content }));

        let mut tool_result_blocks: Vec<Value> = Vec::new();
        let mut finish_requested: Option<(bool, String)> = None;

        for tu in &reply.tool_uses {
            journal.append(JournalEntry::ToolCall {
                ts: ts(),
                tool_call_id: tu.id.clone(),
                tool: tu.name.clone(),
                input: tu.input.clone(),
            });

            let evidence = execute_tool(&tu.id, &tu.name, &tu.input, ctx);

            if evidence.tool == "compare_quantum_results" && evidence.ok {
                last_compare_matched =
                    Some(evidence.facts.get("matches") == Some(&Value::Bool(true)));
            }
            if evidence.tool == "finish" && evidence.ok {
                let ok_success = evidence.facts.get("success") == Some(&Value::Bool(true));
                let ok_summary = evidence
                    .facts
                    .get("summary")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                finish_requested = Some((ok_success, ok_summary));
            }

            let content = serde_json::to_string(&json!({
                "facts": evidence.facts,
                "diagnostics": evidence.diagnostics,
            }))
            .unwrap_or_else(|_| "{}".to_string());

            journal.append(JournalEntry::ToolResult { ts: ts(), evidence });

            tool_result_blocks.push(json!({
                "type": "tool_result",
                "tool_use_id": tu.id,
                "content": content,
            }));
        }

        messages.push(json!({ "role": "user", "content": tool_result_blocks }));

        if let Some((ok_success, ok_summary)) = finish_requested {
            finished = true;
            success = ok_success;
            summary = if !ok_summary.is_empty() {
                ok_summary
            } else if success {
                "Goal verified.".to_string()
            } else {
                "Agent stopped without meeting the goal.".to_string()
            };
            break;
        }
    }

    if !finished {
        journal.append(JournalEntry::StateChange {
            ts: ts(),
            from: state,
            to: RunState::Failed,
        });
        state = RunState::Failed;
        return AgentRunResult {
            run_id,
            state,
            success: false,
            iterations,
            summary: if summary.is_empty() {
                "Budget exhausted before the goal could be verified.".to_string()
            } else {
                summary
            },
            journal: journal.entries(),
        };
    }

    journal.append(JournalEntry::StateChange {
        ts: ts(),
        from: state,
        to: RunState::Completed,
    });
    state = RunState::Completed;
    AgentRunResult {
        run_id,
        state,
        success,
        iterations,
        summary,
        journal: journal.entries(),
    }
}

#[cfg(test)]
mod tests;
