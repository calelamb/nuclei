//! Execution port for the orchestrator (Stage R4).
//!
//! [`AgentKernel`] is the boundary between the pure agent loop and the actual
//! quantum stack: parse / simulate / transpile, each returning a deterministic
//! outcome that never throws. This lets the whole orchestrator be unit-tested
//! with a scripted [`MockKernel`] — no Python worker, no network — while
//! [`RealKernel`] wires the same trait to the R1 execution supervisor
//! (`executor::run_agent_request`) in production.
//!
//! Port of the TS `KernelPort` / `SessionKernel` (`src/services/agent/
//! interfaces.ts`, `liveKernel.ts`). Framework is an explicit parameter here
//! (rather than resolved inside the adapter as in `SessionKernel`) so the
//! orchestrator's tool executors own framework resolution.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::dirac::analysis::CircuitSnapshot;
use crate::dirac::executor::{run_agent_request, DEFAULT_WALL};
use crate::dirac::types::{AgentExecuteRequest, PROTOCOL_VERSION};

/// Map a framework to the source language the kernel must interpret the buffer
/// as (port of `kernelLanguageFor`). Q# is its own language; everything else
/// is Python.
pub fn kernel_language_for(framework: &str) -> String {
    if framework == "qsharp" {
        "qsharp".to_string()
    } else {
        "python".to_string()
    }
}

/// Simulation result the agent reasons about. Only the fields the tool
/// executors actually consume are typed; the rest of the kernel's richer
/// payload (state vector, bloch coords) is intentionally dropped here.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SimulationResult {
    #[serde(default)]
    pub probabilities: HashMap<String, f64>,
    #[serde(default)]
    pub measurements: Value,
    #[serde(default)]
    pub execution_time_ms: f64,
    #[serde(default)]
    pub shot_count: u64,
}

/// Post-transpile metrics for a target backend's basis gates / coupling map
/// (port of `TranspileMetrics`). Snake-cased to match the kernel's own
/// `result` payload (`kernel/executor.py::Executor.transpile`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TranspileMetrics {
    #[serde(default)]
    pub depth: u32,
    #[serde(default)]
    pub gate_counts: HashMap<String, u32>,
    #[serde(default)]
    pub two_qubit_count: u32,
    #[serde(default)]
    pub num_qubits: u32,
    #[serde(default)]
    pub coupling_mapped: bool,
}

/// A qiskit transpile target: basis gates, coupling map, optimization level
/// (port of `TranspileTarget`). Empty/omitted fields mean "no constraint".
#[derive(Debug, Clone, Default)]
pub struct TranspileTarget {
    pub basis_gates: Option<Vec<String>>,
    pub coupling_map: Option<Vec<(u32, u32)>>,
    pub optimization_level: Option<u8>,
}

/// Deterministic parse outcome. Never a `Result`/panic — a kernel error is a
/// normal, inspectable value (port of `ParseOutcome`).
#[derive(Debug, Clone)]
pub enum ParseOutcome {
    Ok { snapshot: CircuitSnapshot },
    Err { message: String, line: Option<i64> },
}

/// Deterministic simulate outcome (port of `SimOutcome`).
#[derive(Debug, Clone)]
pub enum SimOutcome {
    Ok { result: SimulationResult },
    Err { message: String, line: Option<i64> },
}

/// Deterministic transpile outcome (port of `TranspileOutcome`). Qiskit-only;
/// other frameworks come back as `Err` with a plain reason, never a panic.
#[derive(Debug, Clone)]
pub enum TranspileOutcome {
    Ok { metrics: TranspileMetrics },
    Err { message: String },
}

/// Deterministic transpile-explore outcome — the Transpiler Explorer's full
/// pass-by-pass payload (before/after snapshots, metric deltas, per-pass added
/// gates). The payload is forwarded opaquely to the model, so `Ok` carries the
/// raw JSON `Value` rather than a typed struct. Qiskit-only.
#[derive(Debug, Clone)]
pub enum TranspileExploreOutcome {
    Ok { payload: Value },
    Err { message: String },
}

/// The execution port. Every method is infallible at the type level — failures
/// are carried in the outcome enums so the loop can feed them back to the model
/// as evidence and repair. `Send + Sync` so a `RealKernel` can be shared.
pub trait AgentKernel: Send + Sync {
    fn parse(&self, code: &str, framework: &str, language: &str) -> ParseOutcome;
    fn simulate(&self, code: &str, shots: u32, framework: &str, language: &str) -> SimOutcome;
    fn transpile(&self, code: &str, target: &TranspileTarget) -> TranspileOutcome;
    /// Transpile and return the full Transpiler Explorer payload (pass-by-pass),
    /// as opposed to `transpile`'s headline metrics. Qiskit-only.
    fn transpile_explore(&self, code: &str, target: &TranspileTarget) -> TranspileExploreOutcome;
}

/// Monotonic request-id source so concurrent worker runs never collide.
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_request_id(action: &str) -> String {
    let n = REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst) + 1;
    format!("agent_{action}_{n}")
}

/// Production [`AgentKernel`]: each call spawns the disposable Python worker via
/// the R1 execution supervisor and maps its `AgentExecuteResponse` back to an
/// outcome. Status `ok` yields the snapshot/result; anything else becomes an
/// `Err` carrying the worker's error message.
pub struct RealKernel {
    python: PathBuf,
    worker: PathBuf,
    cwd: PathBuf,
    wall: Duration,
}

impl RealKernel {
    pub fn new(python: PathBuf, worker: PathBuf, cwd: PathBuf) -> Self {
        Self {
            python,
            worker,
            cwd,
            wall: DEFAULT_WALL,
        }
    }

    /// Override the per-run wall-clock budget (defaults to
    /// [`DEFAULT_WALL`]). Primarily for tests / tuning.
    pub fn with_wall(mut self, wall: Duration) -> Self {
        self.wall = wall;
        self
    }

    fn base_request(
        &self,
        action: &str,
        framework: &str,
        language: &str,
        code: &str,
    ) -> AgentExecuteRequest {
        AgentExecuteRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: next_request_id(action),
            action: action.to_string(),
            framework: framework.to_string(),
            language: language.to_string(),
            code: code.to_string(),
            shots: None,
            basis_gates: None,
            coupling_map: None,
            optimization_level: None,
        }
    }

    fn run(&self, request: &AgentExecuteRequest) -> crate::dirac::types::AgentExecuteResponse {
        run_agent_request(&self.python, &self.worker, &self.cwd, request, self.wall)
    }
}

/// Pull the worker error's `message` (falling back to a generic label).
fn error_message(error: &Value, action: &str) -> String {
    error
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("{action} failed"))
}

fn error_line(error: &Value) -> Option<i64> {
    error.get("line").and_then(Value::as_i64)
}

impl AgentKernel for RealKernel {
    fn parse(&self, code: &str, framework: &str, language: &str) -> ParseOutcome {
        let request = self.base_request("parse", framework, language, code);
        let response = self.run(&request);
        if response.status == "ok" {
            match serde_json::from_value::<CircuitSnapshot>(response.snapshot) {
                Ok(snapshot) => ParseOutcome::Ok { snapshot },
                Err(_) => ParseOutcome::Err {
                    message: "Kernel returned an empty or malformed snapshot.".to_string(),
                    line: None,
                },
            }
        } else {
            ParseOutcome::Err {
                message: error_message(&response.error, "parse"),
                line: error_line(&response.error),
            }
        }
    }

    fn simulate(&self, code: &str, shots: u32, framework: &str, language: &str) -> SimOutcome {
        let mut request = self.base_request("simulate", framework, language, code);
        request.shots = Some(shots);
        let response = self.run(&request);
        if response.status == "ok" {
            match serde_json::from_value::<SimulationResult>(response.result) {
                Ok(result) => SimOutcome::Ok { result },
                Err(_) => SimOutcome::Err {
                    message: "Kernel returned an empty or malformed result.".to_string(),
                    line: None,
                },
            }
        } else {
            SimOutcome::Err {
                message: error_message(&response.error, "simulate"),
                line: error_line(&response.error),
            }
        }
    }

    fn transpile(&self, code: &str, target: &TranspileTarget) -> TranspileOutcome {
        // Transpile is qiskit-only regardless of the active framework; the
        // worker's own checks reject non-qiskit code (see `SessionKernel`).
        let mut request = self.base_request("transpile", "qiskit", "python", code);
        request.basis_gates = target.basis_gates.clone();
        request.coupling_map = target.coupling_map.as_ref().map(|edges| {
            edges
                .iter()
                .map(|(a, b)| vec![i64::from(*a), i64::from(*b)])
                .collect()
        });
        request.optimization_level = target.optimization_level;
        let response = self.run(&request);
        if response.status == "ok" {
            match serde_json::from_value::<TranspileMetrics>(response.result) {
                Ok(metrics) => TranspileOutcome::Ok { metrics },
                Err(_) => TranspileOutcome::Err {
                    message: "Kernel returned an empty or malformed transpile result.".to_string(),
                },
            }
        } else {
            TranspileOutcome::Err {
                message: error_message(&response.error, "transpile"),
            }
        }
    }

    fn transpile_explore(&self, code: &str, target: &TranspileTarget) -> TranspileExploreOutcome {
        // Same qiskit-only path as `transpile`, but the worker returns the
        // richer explorer payload, which we forward opaquely to the model.
        let mut request = self.base_request("transpile_explore", "qiskit", "python", code);
        request.basis_gates = target.basis_gates.clone();
        request.coupling_map = target.coupling_map.as_ref().map(|edges| {
            edges
                .iter()
                .map(|(a, b)| vec![i64::from(*a), i64::from(*b)])
                .collect()
        });
        request.optimization_level = target.optimization_level;
        let response = self.run(&request);
        if response.status == "ok" {
            TranspileExploreOutcome::Ok {
                payload: response.result,
            }
        } else {
            TranspileExploreOutcome::Err {
                message: error_message(&response.error, "transpile_explore"),
            }
        }
    }
}

/// Scripted [`AgentKernel`] for tests. Parse/simulate branch on marker
/// substrings in the code (mirroring the TS `makeKernel` test double), so a run
/// can be driven deterministically without any quantum stack.
pub struct MockKernel {
    snapshot: CircuitSnapshot,
    result: SimulationResult,
    /// Code substring that forces a parse error.
    parse_error_marker: Option<String>,
    /// Code substring that forces a simulate error.
    sim_error_marker: Option<String>,
    transpile: Option<TranspileMetrics>,
    transpile_explore: Option<Value>,
}

impl MockKernel {
    /// A kernel that parses to `snapshot` and simulates to `result` unless a
    /// marker below is configured and present in the code.
    pub fn new(snapshot: CircuitSnapshot, result: SimulationResult) -> Self {
        Self {
            snapshot,
            result,
            parse_error_marker: Some("SYNTAX_ERROR".to_string()),
            sim_error_marker: Some("RUNTIME_ERROR".to_string()),
            transpile: None,
            transpile_explore: None,
        }
    }

    pub fn with_transpile(mut self, metrics: TranspileMetrics) -> Self {
        self.transpile = Some(metrics);
        self
    }

    pub fn with_transpile_explore(mut self, payload: Value) -> Self {
        self.transpile_explore = Some(payload);
        self
    }

    pub fn with_parse_error_marker(mut self, marker: Option<String>) -> Self {
        self.parse_error_marker = marker;
        self
    }

    pub fn with_sim_error_marker(mut self, marker: Option<String>) -> Self {
        self.sim_error_marker = marker;
        self
    }
}

impl AgentKernel for MockKernel {
    fn parse(&self, code: &str, _framework: &str, _language: &str) -> ParseOutcome {
        if let Some(marker) = &self.parse_error_marker {
            if code.contains(marker) {
                return ParseOutcome::Err {
                    message: "SyntaxError: invalid syntax".to_string(),
                    line: Some(1),
                };
            }
        }
        ParseOutcome::Ok {
            snapshot: self.snapshot.clone(),
        }
    }

    fn simulate(&self, code: &str, shots: u32, _framework: &str, _language: &str) -> SimOutcome {
        if let Some(marker) = &self.sim_error_marker {
            if code.contains(marker) {
                return SimOutcome::Err {
                    message: "ZeroDivisionError: division by zero".to_string(),
                    line: Some(1),
                };
            }
        }
        let mut result = self.result.clone();
        result.shot_count = u64::from(shots);
        SimOutcome::Ok { result }
    }

    fn transpile(&self, _code: &str, _target: &TranspileTarget) -> TranspileOutcome {
        match &self.transpile {
            Some(metrics) => TranspileOutcome::Ok {
                metrics: metrics.clone(),
            },
            None => TranspileOutcome::Err {
                message: "transpile not exercised by this test kernel".to_string(),
            },
        }
    }

    fn transpile_explore(&self, _code: &str, _target: &TranspileTarget) -> TranspileExploreOutcome {
        match &self.transpile_explore {
            Some(payload) => TranspileExploreOutcome::Ok {
                payload: payload.clone(),
            },
            None => TranspileExploreOutcome::Err {
                message: "transpile_explore not exercised by this test kernel".to_string(),
            },
        }
    }
}

/// Locate the bundled worker and resolve its `python` the same way the
/// `dirac_execute` command does. Returned by R5's command layer; kept here so
/// `RealKernel` has a documented construction path. Unused until R5 wires the
/// live command, hence the local allow.
#[allow(dead_code)]
pub fn real_kernel(python: &Path, worker: &Path, cwd: &Path) -> RealKernel {
    RealKernel::new(
        python.to_path_buf(),
        worker.to_path_buf(),
        cwd.to_path_buf(),
    )
}
