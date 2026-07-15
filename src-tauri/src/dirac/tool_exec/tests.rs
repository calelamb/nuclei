//! Tool-executor tests, with the core safety invariant front and center:
//! under the default (safe) policy, a real-QPU submission reaches ZERO calls to
//! the submit port. All deterministic — MockKernel + MemWorkspace + MockSubmitPort.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::test_support::{backend, bell_result, bell_snapshot, FILE_PATH};
use super::{execute_tool, ToolContext};
use crate::dirac::analysis::{BackendInfo, CircuitSnapshot};
use crate::dirac::budget::BudgetLedger;
use crate::dirac::kernel::{MockKernel, SimulationResult};
use crate::dirac::policy::{AutonomyPolicy, SubmissionFacts};
use crate::dirac::submit::{MockSubmitPort, UnavailableSubmitPort};
use crate::dirac::workspace::{MemWorkspace, WorkspaceFile};

fn workspace() -> MemWorkspace {
    MemWorkspace::new(
        vec![WorkspaceFile {
            path: FILE_PATH.to_string(),
            framework: "qiskit".to_string(),
            content: "from qiskit import QuantumCircuit\n".to_string(),
            dirty: false,
        }],
        None,
    )
}

/// Run a single tool call against a freshly-assembled context. The
/// backends/policy/submit-port/last_* are supplied by the caller so each test
/// controls exactly the safety-relevant inputs.
struct Fixture {
    kernel: MockKernel,
    policy: AutonomyPolicy,
    backends: Vec<BackendInfo>,
    last_snapshot: Option<CircuitSnapshot>,
    last_result: Option<SimulationResult>,
}

impl Fixture {
    fn new() -> Self {
        Self {
            kernel: MockKernel::new(bell_snapshot(), bell_result()),
            policy: AutonomyPolicy::safe_default(),
            backends: Vec::new(),
            last_snapshot: None,
            last_result: None,
        }
    }
}

#[test]
fn safety_real_qpu_under_default_policy_submits_nothing() {
    let fixture = Fixture {
        backends: vec![backend("ibm_torino", "ibm")],
        ..Fixture::new()
    };
    let mut ws = workspace();
    let mut ledger = BudgetLedger::new(1000.0);
    let submit = MockSubmitPort::new();
    let get_backends = || fixture.backends.clone();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &fixture.kernel,
        workspace: &mut ws,
        policy: &fixture.policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: fixture.last_snapshot.clone(),
        last_result: fixture.last_result.clone(),
        last_known_hash: HashMap::new(),
    };

    let evidence = execute_tool(
        "s1",
        "submit_hardware_job",
        &json!({ "backend": "ibm_torino", "shots": 1024 }),
        &mut ctx,
    );

    assert!(
        evidence.ok,
        "a policy-denied submission is a normal ok result"
    );
    assert_eq!(evidence.facts["submitted"], Value::Bool(false));
    assert_eq!(evidence.facts["decision"], "needs_approval");
    // THE invariant: the submit port was never touched.
    assert_eq!(submit.submission_count(), 0);
}

#[test]
fn safety_simulator_backend_submits_exactly_once() {
    let fixture = Fixture {
        backends: vec![backend("sim_aer", "simulator")],
        ..Fixture::new()
    };
    let mut ws = workspace();
    let mut ledger = BudgetLedger::new(1000.0);
    let submit = MockSubmitPort::new();
    let get_backends = || fixture.backends.clone();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &fixture.kernel,
        workspace: &mut ws,
        policy: &fixture.policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: None,
        last_result: None,
        last_known_hash: HashMap::new(),
    };

    let evidence = execute_tool(
        "s1",
        "submit_hardware_job",
        &json!({ "backend": "sim_aer", "shots": 512 }),
        &mut ctx,
    );

    assert!(evidence.ok);
    assert_eq!(evidence.facts["submitted"], Value::Bool(true));
    assert_eq!(evidence.facts["decision"], "allow");
    assert_eq!(submit.submission_count(), 1);
    let recorded = submit.submissions();
    assert_eq!(recorded[0].backend, "sim_aer");
    assert_eq!(recorded[0].shots, 512);
}

#[test]
fn duplicate_simulator_submission_is_idempotent() {
    let fixture = Fixture {
        backends: vec![backend("sim_aer", "simulator")],
        ..Fixture::new()
    };
    let mut ws = workspace();
    let mut ledger = BudgetLedger::new(1000.0);
    let submit = MockSubmitPort::new();
    let get_backends = || fixture.backends.clone();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &fixture.kernel,
        workspace: &mut ws,
        policy: &fixture.policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: None,
        last_result: None,
        last_known_hash: HashMap::new(),
    };

    let input = json!({ "backend": "sim_aer", "shots": 512 });
    let first = execute_tool("s1", "submit_hardware_job", &input, &mut ctx);
    assert_eq!(first.facts["submitted"], Value::Bool(true));

    let second = execute_tool("s2", "submit_hardware_job", &input, &mut ctx);
    assert_eq!(second.facts["submitted"], Value::Bool(false));
    assert_eq!(second.facts["decision"], "duplicate");
    // Still only one real submission despite two tool calls.
    assert_eq!(submit.submission_count(), 1);
}

#[test]
fn unavailable_port_reports_unavailable_after_an_allowing_decision() {
    let fixture = Fixture {
        backends: vec![backend("sim_aer", "simulator")],
        ..Fixture::new()
    };
    let mut ws = workspace();
    let mut ledger = BudgetLedger::new(1000.0);
    let submit = UnavailableSubmitPort;
    let get_backends = || fixture.backends.clone();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &fixture.kernel,
        workspace: &mut ws,
        policy: &fixture.policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: None,
        last_result: None,
        last_known_hash: HashMap::new(),
    };

    let evidence = execute_tool(
        "s1",
        "submit_hardware_job",
        &json!({ "backend": "sim_aer", "shots": 512 }),
        &mut ctx,
    );
    assert!(evidence.ok);
    assert_eq!(evidence.facts["submitted"], Value::Bool(false));
    assert_eq!(evidence.facts["decision"], "unavailable");
}

#[test]
fn check_algorithm_invariant_matches_a_bell_result() {
    let fixture = Fixture::new();
    let mut ws = workspace();
    let mut ledger = BudgetLedger::new(1.0);
    let submit = UnavailableSubmitPort;
    let get_backends = || Vec::<BackendInfo>::new();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &fixture.kernel,
        workspace: &mut ws,
        policy: &fixture.policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: Some(bell_snapshot()),
        last_result: Some(bell_result()),
        last_known_hash: HashMap::new(),
    };

    let evidence = execute_tool("c1", "check_algorithm_invariant", &json!({}), &mut ctx);
    assert!(evidence.ok);
    assert_eq!(evidence.facts["checked"], Value::Bool(true));
    assert_eq!(evidence.facts["algorithm"], "bell");
    assert_eq!(evidence.facts["matches"], Value::Bool(true));
}

#[test]
fn unknown_tool_and_malformed_input_never_panic() {
    let fixture = Fixture::new();
    let mut ws = workspace();
    let mut ledger = BudgetLedger::new(1.0);
    let submit = UnavailableSubmitPort;
    let get_backends = || Vec::<BackendInfo>::new();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &fixture.kernel,
        workspace: &mut ws,
        policy: &fixture.policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: None,
        last_result: None,
        last_known_hash: HashMap::new(),
    };

    let unknown = execute_tool("u1", "frobnicate_qubits", &json!({}), &mut ctx);
    assert!(!unknown.ok);
    assert!(unknown
        .diagnostics
        .as_deref()
        .unwrap_or("")
        .contains("Unknown tool"));

    // Non-object input is normalized to `{}` — apply_patch then fails on the
    // missing required "path" rather than panicking.
    let malformed = execute_tool("u2", "apply_patch", &Value::from(42), &mut ctx);
    assert!(!malformed.ok);

    // Missing new_content on an otherwise-object input.
    let partial = execute_tool("u3", "apply_patch", &json!({ "path": FILE_PATH }), &mut ctx);
    assert!(!partial.ok);
}

#[test]
fn poll_and_analyze_go_through_the_mock_submit_port() {
    let fixture = Fixture {
        backends: vec![backend("sim_aer", "simulator")],
        ..Fixture::new()
    };
    let mut ws = workspace();
    let mut ledger = BudgetLedger::new(1000.0);
    let submit = MockSubmitPort::new();
    let get_backends = || fixture.backends.clone();
    let estimate_cost = |_: &SubmissionFacts| -> Option<f64> { None };

    let mut ctx = ToolContext {
        kernel: &fixture.kernel,
        workspace: &mut ws,
        policy: &fixture.policy,
        ledger: &mut ledger,
        submit_port: &submit,
        get_backends: &get_backends,
        estimate_cost: &estimate_cost,
        last_snapshot: None,
        last_result: None,
        last_known_hash: HashMap::new(),
    };

    let submitted = execute_tool(
        "s1",
        "submit_hardware_job",
        &json!({ "backend": "sim_aer", "shots": 128 }),
        &mut ctx,
    );
    let job_id = submitted.facts["job_id"].as_str().unwrap().to_string();

    let polled = execute_tool(
        "p1",
        "poll_hardware_job",
        &json!({ "job_id": job_id }),
        &mut ctx,
    );
    assert!(polled.ok);
    assert_eq!(polled.facts["available"], Value::Bool(true));
    assert_eq!(polled.facts["status"], "queued");

    // Script a completed result and analyze it.
    let mut probs = std::collections::HashMap::new();
    probs.insert("00".to_string(), 0.5);
    probs.insert("11".to_string(), 0.5);
    submit.set_result(
        &job_id,
        crate::dirac::submit::JobResultsOutcome::Ok {
            job_id: job_id.clone(),
            probabilities: probs,
        },
    );

    let analyzed = execute_tool(
        "a1",
        "analyze_hardware_result",
        &json!({ "job_id": job_id, "expected_probabilities": { "00": 0.5, "11": 0.5 } }),
        &mut ctx,
    );
    assert!(analyzed.ok);
    assert_eq!(analyzed.facts["available"], Value::Bool(true));
    assert_eq!(analyzed.facts["comparison"]["matches"], Value::Bool(true));
}

#[test]
fn transpile_explore_forwards_the_pass_payload() {
    let payload = json!({
        "metrics": {
            "depth": { "before": 5, "after": 18 },
            "two_qubit": { "before": 3, "after": 6 },
            "gate_count": { "before": 4, "after": 39 },
        },
        "passes": [ { "name": "SabreLayout", "depth": 7, "added_gates": { "swap": 1 } } ],
        "target": { "basis_gates": ["rz", "sx", "x", "cx"], "coupling_size": 3 },
    });
    let kernel = MockKernel::new(bell_snapshot(), bell_result()).with_transpile_explore(payload);
    let policy = AutonomyPolicy::safe_default();
    let mut ws = workspace();
    let mut ledger = BudgetLedger::new(0.0);
    let submit = UnavailableSubmitPort;
    let backends: Vec<BackendInfo> = Vec::new();
    let get_backends = || backends.clone();
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
        last_known_hash: HashMap::new(),
    };

    let evidence = execute_tool(
        "t1",
        "transpile_explore",
        &json!({ "optimization_level": 2 }),
        &mut ctx,
    );

    assert!(evidence.ok);
    assert_eq!(evidence.facts["available"], Value::Bool(true));
    // No backend requested → the all-to-all simulator target.
    assert_eq!(evidence.facts["target"], "simulator");
    // The explorer payload is forwarded verbatim (pass list + metric deltas).
    assert!(evidence.facts["passes"].is_array());
    assert_eq!(evidence.facts["metrics"]["two_qubit"]["after"], 6);
    assert_eq!(evidence.facts["passes"][0]["added_gates"]["swap"], 1);
}

#[test]
fn transpile_explore_reports_unavailable_for_non_qiskit() {
    let kernel = MockKernel::new(bell_snapshot(), bell_result());
    let policy = AutonomyPolicy::safe_default();
    // A Cirq file — the tool must decline rather than send a doomed request.
    let mut ws = MemWorkspace::new(
        vec![WorkspaceFile {
            path: FILE_PATH.to_string(),
            framework: "cirq".to_string(),
            content: "import cirq\n".to_string(),
            dirty: false,
        }],
        None,
    );
    let mut ledger = BudgetLedger::new(0.0);
    let submit = UnavailableSubmitPort;
    let backends: Vec<BackendInfo> = Vec::new();
    let get_backends = || backends.clone();
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
        last_known_hash: HashMap::new(),
    };

    let evidence = execute_tool("t2", "transpile_explore", &json!({}), &mut ctx);
    assert!(evidence.ok);
    assert_eq!(evidence.facts["available"], Value::Bool(false));
}
