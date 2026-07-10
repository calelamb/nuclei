//! Orchestrator loop tests (port of `orchestrator.test.ts`). All deterministic:
//! ScriptedModel/FnModel + MockKernel + MemWorkspace + Mock/UnavailableSubmitPort,
//! no network, no real kernel.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use serde_json::{json, Value};

use super::*;
use crate::dirac::analysis::BackendInfo;
use crate::dirac::budget::BudgetLedger;
use crate::dirac::journal::{JournalEntry, MemJournal};
use crate::dirac::kernel::MockKernel;
use crate::dirac::policy::{AutonomyPolicy, SubmissionFacts};
use crate::dirac::submit::UnavailableSubmitPort;
use crate::dirac::tool_exec::test_support::{
    bell_result, bell_snapshot, reply_tool, turn, FnModel, ScriptedModel, FILE_PATH,
};
use crate::dirac::tool_exec::ToolContext;
use crate::dirac::workspace::{MemWorkspace, Workspace, WorkspaceFile};

const FIXED_CODE: &str = "from qiskit import QuantumCircuit\n# bell state\n";
const BUGGY_CODE: &str = "RUNTIME_ERROR marker\n";

fn workspace(content: &str) -> MemWorkspace {
    MemWorkspace::new(
        vec![WorkspaceFile {
            path: FILE_PATH.to_string(),
            framework: "qiskit".to_string(),
            content: content.to_string(),
            dirty: false,
        }],
        None,
    )
}

fn tool_calls(journal: &[JournalEntry]) -> Vec<String> {
    journal
        .iter()
        .filter_map(|e| match e {
            JournalEntry::ToolCall { tool, .. } => Some(tool.clone()),
            _ => None,
        })
        .collect()
}

fn tool_results(journal: &[JournalEntry]) -> Vec<crate::dirac::tool_exec::ToolEvidence> {
    journal
        .iter()
        .filter_map(|e| match e {
            JournalEntry::ToolResult { evidence, .. } => Some(evidence.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn happy_path_patch_parse_simulate_compare_finish() {
    let mut ws = workspace("");
    let kernel = MockKernel::new(bell_snapshot(), bell_result());
    let mut ledger = BudgetLedger::new(100.0);
    let policy = AutonomyPolicy::safe_default();
    let submit = UnavailableSubmitPort;
    let get_backends = || Vec::<BackendInfo>::new();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &kernel,
        workspace: &mut ws,
        policy: &policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: None,
        last_result: None,
        last_known_hash: std::collections::HashMap::new(),
    };

    let model = ScriptedModel::new(vec![
        turn(
            "t1",
            "apply_patch",
            json!({ "path": FILE_PATH, "new_content": FIXED_CODE, "rationale": "bell state" }),
        ),
        turn("t2", "parse_quantum_program", json!({})),
        turn("t3", "run_simulation", json!({})),
        turn(
            "t4",
            "compare_quantum_results",
            json!({ "expected_probabilities": { "00": 0.5, "11": 0.5 } }),
        ),
        turn(
            "t5",
            "finish",
            json!({ "summary": "Bell state verified.", "success": true }),
        ),
    ]);

    let mut journal = MemJournal::new();
    let cancel = AtomicBool::new(false);
    let now = || Instant::now();

    let result = run_agent(
        "Build a Bell state",
        &model,
        &mut ctx,
        &mut journal,
        AgentBudget::default(),
        &cancel,
        &now,
    );

    assert!(result.success);
    assert_eq!(result.state, RunState::Completed);
    assert_eq!(result.iterations, 5);
    assert_eq!(
        ws.read_file(FILE_PATH).map(|f| f.content),
        Some(FIXED_CODE.to_string())
    );

    assert_eq!(
        tool_calls(&result.journal),
        vec![
            "apply_patch",
            "parse_quantum_program",
            "run_simulation",
            "compare_quantum_results",
            "finish",
        ]
    );

    let results = tool_results(&result.journal);
    assert_eq!(results.len(), 5);
    assert!(results.iter().all(|e| e.ok));
}

#[test]
fn repair_loop_feeds_failing_sim_evidence_back_to_the_model() {
    let mut ws = workspace("");
    let kernel = MockKernel::new(bell_snapshot(), bell_result());
    let mut ledger = BudgetLedger::new(100.0);
    let policy = AutonomyPolicy::safe_default();
    let submit = UnavailableSubmitPort;
    let get_backends = || Vec::<BackendInfo>::new();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &kernel,
        workspace: &mut ws,
        policy: &policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: None,
        last_result: None,
        last_known_hash: std::collections::HashMap::new(),
    };

    let model = ScriptedModel::new(vec![
        turn(
            "t1",
            "apply_patch",
            json!({ "path": FILE_PATH, "new_content": BUGGY_CODE, "rationale": "first attempt" }),
        ),
        turn("t2", "run_simulation", json!({})),
        turn(
            "t3",
            "apply_patch",
            json!({ "path": FILE_PATH, "new_content": FIXED_CODE, "rationale": "fix runtime error" }),
        ),
        turn("t4", "run_simulation", json!({})),
        turn(
            "t5",
            "finish",
            json!({ "summary": "Fixed and verified.", "success": true }),
        ),
    ]);

    let mut journal = MemJournal::new();
    let cancel = AtomicBool::new(false);
    let now = || Instant::now();

    let result = run_agent(
        "Build a Bell state",
        &model,
        &mut ctx,
        &mut journal,
        AgentBudget::default(),
        &cancel,
        &now,
    );

    assert!(result.success);
    assert_eq!(result.state, RunState::Completed);
    assert_eq!(result.iterations, 5);
    assert_eq!(
        ws.read_file(FILE_PATH).map(|f| f.content),
        Some(FIXED_CODE.to_string())
    );

    let sim_results: Vec<_> = tool_results(&result.journal)
        .into_iter()
        .filter(|e| e.tool == "run_simulation")
        .collect();
    assert_eq!(sim_results.len(), 2);
    assert!(!sim_results[0].ok);
    assert!(sim_results[0]
        .diagnostics
        .as_deref()
        .unwrap_or("")
        .contains("ZeroDivisionError"));
    assert!(sim_results[1].ok);

    // THE multi-turn feedback: the failing-sim evidence must appear in the
    // messages handed to the model on the turn that produced the fix (call 3,
    // index 2).
    let calls = model.calls();
    assert!(calls.len() >= 3);
    let third_call_json = serde_json::to_string(&calls[2]).unwrap_or_default();
    assert!(
        third_call_json.contains("ZeroDivisionError"),
        "failing-sim evidence was not fed back to the model: {third_call_json}"
    );
}

#[test]
fn budget_exhaustion_stops_at_max_iterations_failed() {
    let mut ws = workspace("");
    let kernel = MockKernel::new(bell_snapshot(), bell_result());
    let mut ledger = BudgetLedger::new(100.0);
    let policy = AutonomyPolicy::safe_default();
    let submit = UnavailableSubmitPort;
    let get_backends = || Vec::<BackendInfo>::new();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &kernel,
        workspace: &mut ws,
        policy: &policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: None,
        last_result: None,
        last_known_hash: std::collections::HashMap::new(),
    };

    // Never calls finish — always inspects.
    let model = FnModel::new(|n| reply_tool(&format!("t{n}"), "inspect_project", json!({})));

    let mut journal = MemJournal::new();
    let cancel = AtomicBool::new(false);
    let now = || Instant::now();

    let result = run_agent(
        "Do something never finished",
        &model,
        &mut ctx,
        &mut journal,
        AgentBudget {
            max_iterations: 3,
            max_wall: std::time::Duration::from_secs(60),
        },
        &cancel,
        &now,
    );

    assert_eq!(result.state, RunState::Failed);
    assert!(!result.success);
    assert_eq!(result.iterations, 3);
}

#[test]
fn cancellation_yields_cancelled_state() {
    let mut ws = workspace("");
    let kernel = MockKernel::new(bell_snapshot(), bell_result());
    let mut ledger = BudgetLedger::new(100.0);
    let policy = AutonomyPolicy::safe_default();
    let submit = UnavailableSubmitPort;
    let get_backends = || Vec::<BackendInfo>::new();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &kernel,
        workspace: &mut ws,
        policy: &policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: None,
        last_result: None,
        last_known_hash: std::collections::HashMap::new(),
    };

    let cancel = AtomicBool::new(false);
    // Fire the cancel flag on the second model call (both the closure and
    // run_agent hold shared `&` borrows of the same AtomicBool, which is
    // allowed). The loop notices it at the top of the next iteration.
    let model = FnModel::new(|n| {
        if n == 2 {
            cancel.store(true, Ordering::SeqCst);
        }
        reply_tool(&format!("t{n}"), "inspect_project", json!({}))
    });

    let mut journal = MemJournal::new();
    let now = || Instant::now();

    let result = run_agent(
        "Build something",
        &model,
        &mut ctx,
        &mut journal,
        AgentBudget::default(),
        &cancel,
        &now,
    );

    assert_eq!(result.state, RunState::Cancelled);
    assert!(!result.success);
    assert!(result.iterations < 12);
    assert_eq!(result.iterations, 2);
}

#[test]
fn feeds_tool_result_evidence_back_into_the_next_model_call() {
    let mut ws = workspace("");
    let kernel = MockKernel::new(bell_snapshot(), bell_result());
    let mut ledger = BudgetLedger::new(100.0);
    let policy = AutonomyPolicy::safe_default();
    let submit = UnavailableSubmitPort;
    let get_backends = || Vec::<BackendInfo>::new();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &kernel,
        workspace: &mut ws,
        policy: &policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: None,
        last_result: None,
        last_known_hash: std::collections::HashMap::new(),
    };

    let model = ScriptedModel::new(vec![
        turn("t1", "inspect_project", json!({})),
        turn(
            "t2",
            "finish",
            json!({ "summary": "done", "success": true }),
        ),
    ]);

    let mut journal = MemJournal::new();
    let cancel = AtomicBool::new(false);
    let now = || Instant::now();

    run_agent(
        "Inspect then finish",
        &model,
        &mut ctx,
        &mut journal,
        AgentBudget::default(),
        &cancel,
        &now,
    );

    let calls = model.calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].len(), 1);

    let second = &calls[1];
    assert_eq!(second.len(), 3);
    let last = second.last().unwrap();
    assert_eq!(last["role"], "user");
    let content = last["content"].as_array().expect("content is an array");
    let tool_result = content
        .iter()
        .find(|b| b["type"] == "tool_result")
        .expect("a tool_result block is present");
    assert_eq!(tool_result["tool_use_id"], "t1");
    let inner: &Value = &tool_result["content"];
    assert!(inner.as_str().unwrap_or("").contains("active_path"));
}
