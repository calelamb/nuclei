//! `drive_run` tests: a scripted model + mock kernel + capturing `emit`, so the
//! emitted event stream (the command layer's contract with the frontend) is
//! asserted deterministically without Tauri, a real kernel, or network.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde_json::json;

use super::*;
use crate::dirac::analysis::BackendInfo;
use crate::dirac::kernel::MockKernel;
use crate::dirac::policy::AutonomyPolicy;
use crate::dirac::submit::MockSubmitPort;
use crate::dirac::tool_exec::test_support::{
    bell_result, bell_snapshot, reply_tool, turn, FnModel, ScriptedModel, FILE_PATH,
};

const BELL_CODE: &str =
    "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)\n";

/// Collect every emitted event into a Vec behind a Mutex, returning a snapshot.
fn capture<'a>(sink: &'a Mutex<Vec<RunEvent>>) -> impl Fn(RunEvent) + 'a {
    move |event: RunEvent| {
        if let Ok(mut v) = sink.lock() {
            v.push(event);
        }
    }
}

fn config(goal: &str, seed_content: &str) -> RunConfig {
    RunConfig {
        goal: goal.to_string(),
        files: vec![RunSeedFile {
            path: FILE_PATH.to_string(),
            framework: "qiskit".to_string(),
            content: seed_content.to_string(),
        }],
        active_path: FILE_PATH.to_string(),
        model: "claude-sonnet-4-5".to_string(),
        run_id: "run_test_1".to_string(),
        persona: AgentPersona::Default,
    }
}

fn kinds(events: &[RunEvent]) -> Vec<&'static str> {
    events
        .iter()
        .map(|e| match e {
            RunEvent::Started { .. } => "started",
            RunEvent::State { .. } => "state",
            RunEvent::ModelText { .. } => "modelText",
            RunEvent::ToolCall { .. } => "toolCall",
            RunEvent::ToolResult { .. } => "toolResult",
            RunEvent::Patch { .. } => "patch",
            RunEvent::Error { .. } => "error",
            RunEvent::Finished { .. } => "finished",
        })
        .collect()
}

#[test]
fn streams_a_full_bell_run_started_toolpairs_patch_and_finished() {
    let kernel = MockKernel::new(bell_snapshot(), bell_result());
    let submit = MockSubmitPort::new();
    let policy = AutonomyPolicy::safe_default();
    let get_backends = || Vec::<BackendInfo>::new();

    let model = ScriptedModel::new(vec![
        turn(
            "t1",
            "apply_patch",
            json!({ "path": FILE_PATH, "new_content": BELL_CODE, "rationale": "build bell" }),
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

    let deps = RunDeps {
        model: &model,
        kernel: &kernel,
        submit: &submit,
        policy: &policy,
        get_backends: &get_backends,
    };
    let cfg = config("Build a Bell state", "");
    let cancel = AtomicBool::new(false);
    let sink = Mutex::new(Vec::<RunEvent>::new());
    let emit = capture(&sink);

    let result = drive_run(&cfg, deps, &cancel, &emit);

    assert!(result.success);
    assert_eq!(result.state, RunState::Completed);
    assert_eq!(result.iterations, 5);

    // No real hardware was touched.
    assert_eq!(submit.submission_count(), 0);

    let events = sink.lock().expect("sink lock").clone();
    let ks = kinds(&events);

    // First event is Started with the goal; last is a successful Finished.
    assert!(
        matches!(events.first(), Some(RunEvent::Started { run_id, goal })
        if run_id == "run_test_1" && goal == "Build a Bell state")
    );
    assert!(matches!(
        events.last(),
        Some(RunEvent::Finished {
            success: true,
            iterations: 5,
            ..
        })
    ));

    // Every tool call is paired with a tool result, in order, for all 5 tools.
    let tool_calls: Vec<&str> = events
        .iter()
        .filter_map(|e| match e {
            RunEvent::ToolCall { tool, .. } => Some(tool.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(
        tool_calls,
        vec![
            "apply_patch",
            "parse_quantum_program",
            "run_simulation",
            "compare_quantum_results",
            "finish",
        ]
    );
    assert_eq!(
        ks.iter().filter(|k| **k == "toolCall").count(),
        ks.iter().filter(|k| **k == "toolResult").count(),
        "every toolCall must have a matching toolResult"
    );

    // A Patch event carries the bell content the model wrote, for the frontend
    // to apply to its editor.
    let patch = events
        .iter()
        .find_map(|e| match e {
            RunEvent::Patch {
                path,
                before_content,
                after_content,
                transaction_id,
                ..
            } => Some((path, before_content, after_content, transaction_id)),
            _ => None,
        })
        .expect("a patch event is emitted");
    assert_eq!(patch.0, FILE_PATH);
    assert_eq!(patch.1, ""); // seeded empty
    assert_eq!(patch.2, BELL_CODE);
    assert!(!patch.3.is_empty());

    // Streams State transitions ending in Completed.
    let states: Vec<RunState> = events
        .iter()
        .filter_map(|e| match e {
            RunEvent::State { state, .. } => Some(*state),
            _ => None,
        })
        .collect();
    assert_eq!(states.first(), Some(&RunState::Working));
    assert_eq!(states.last(), Some(&RunState::Completed));
}

#[test]
fn cancellation_streams_a_cancelled_state_and_unsuccessful_finish() {
    let kernel = MockKernel::new(bell_snapshot(), bell_result());
    let submit = MockSubmitPort::new();
    let policy = AutonomyPolicy::safe_default();
    let get_backends = || Vec::<BackendInfo>::new();

    let cancel = AtomicBool::new(false);
    // Never calls finish; trips the cancel flag on the 2nd model turn.
    let model = FnModel::new(|n| {
        if n == 2 {
            cancel.store(true, Ordering::SeqCst);
        }
        reply_tool(&format!("t{n}"), "inspect_project", json!({}))
    });

    let deps = RunDeps {
        model: &model,
        kernel: &kernel,
        submit: &submit,
        policy: &policy,
        get_backends: &get_backends,
    };
    let cfg = config("Run then cancel", "");
    let sink = Mutex::new(Vec::<RunEvent>::new());
    let emit = capture(&sink);

    let result = drive_run(&cfg, deps, &cancel, &emit);

    assert_eq!(result.state, RunState::Cancelled);
    assert!(!result.success);

    let events = sink.lock().expect("sink lock").clone();
    // A Cancelled State event is streamed.
    assert!(events.iter().any(|e| matches!(
        e,
        RunEvent::State {
            state: RunState::Cancelled,
            ..
        }
    )));
    // And a final unsuccessful Finished.
    assert!(matches!(
        events.last(),
        Some(RunEvent::Finished { success: false, .. })
    ));
    // No Patch event (nothing was written) and no real submission.
    assert!(!events.iter().any(|e| matches!(e, RunEvent::Patch { .. })));
    assert_eq!(submit.submission_count(), 0);
}

#[test]
fn from_journal_maps_each_entry_kind() {
    let state = RunEvent::from_journal(
        "r",
        &JournalEntry::StateChange {
            ts: 0,
            from: RunState::Planning,
            to: RunState::Working,
        },
    );
    assert!(matches!(
        state,
        RunEvent::State {
            state: RunState::Working,
            ..
        }
    ));

    let text = RunEvent::from_journal(
        "r",
        &JournalEntry::ModelText {
            ts: 1,
            text: "hi".to_string(),
        },
    );
    assert!(matches!(text, RunEvent::ModelText { text, .. } if text == "hi"));

    let err = RunEvent::from_journal(
        "r",
        &JournalEntry::Error {
            ts: 2,
            message: "boom".to_string(),
        },
    );
    assert!(matches!(err, RunEvent::Error { message, .. } if message == "boom"));
}
