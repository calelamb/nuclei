//! Shared test doubles and builders for the R4 tool-executor and orchestrator
//! tests: circuit/result/backend fixtures plus scripted [`ModelPort`]
//! implementations. Compiled only under `#[cfg(test)]`.

use std::cell::RefCell;
use std::collections::HashMap;

use serde_json::{json, Value};

use crate::dirac::analysis::{BackendInfo, CircuitSnapshot, Gate};
use crate::dirac::gateway::{ModelReply, ToolUse};
use crate::dirac::kernel::SimulationResult;
use crate::dirac::orchestrator::ModelPort;

pub const FILE_PATH: &str = "main.py";

/// A 2-qubit Bell snapshot (H then CNOT), the canonical happy-path circuit.
pub fn bell_snapshot() -> CircuitSnapshot {
    CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 2,
        classical_bit_count: 2,
        depth: 2,
        gates: vec![
            Gate {
                gate_type: "H".to_string(),
                targets: vec![0],
                controls: vec![],
                params: vec![],
                layer: 0,
            },
            Gate {
                gate_type: "CNOT".to_string(),
                targets: vec![1],
                controls: vec![0],
                params: vec![],
                layer: 1,
            },
        ],
    }
}

/// The 50/50 Bell measurement distribution a happy-path simulation returns.
pub fn bell_result() -> SimulationResult {
    let mut probabilities = HashMap::new();
    probabilities.insert("00".to_string(), 0.5);
    probabilities.insert("11".to_string(), 0.5);
    SimulationResult {
        probabilities,
        measurements: json!({}),
        execution_time_ms: 2.0,
        shot_count: 1024,
    }
}

/// A backend fixture with sensible defaults; tweak fields inline in a test.
pub fn backend(name: &str, provider: &str) -> BackendInfo {
    BackendInfo {
        name: name.to_string(),
        provider: provider.to_string(),
        qubit_count: 5,
        connectivity: vec![(0, 1), (1, 2)],
        queue_length: 3,
        average_error_rate: 0.01,
        gate_set: vec![],
        status: "online".to_string(),
    }
}

fn reply_from(text: Option<&str>, tool_uses: Vec<ToolUse>) -> ModelReply {
    let stop_reason = if tool_uses.is_empty() {
        "end_turn"
    } else {
        "tool_use"
    };
    ModelReply {
        text: text.unwrap_or("").to_string(),
        tool_uses,
        stop_reason: stop_reason.to_string(),
    }
}

/// A single scripted model turn.
pub struct ScriptedTurn {
    pub text: Option<String>,
    pub tool_uses: Vec<ToolUse>,
}

/// One tool_use content block.
pub fn tool_use(id: &str, name: &str, input: Value) -> ToolUse {
    ToolUse {
        id: id.to_string(),
        name: name.to_string(),
        input,
    }
}

/// A turn that issues exactly one tool call.
pub fn turn(id: &str, name: &str, input: Value) -> ScriptedTurn {
    ScriptedTurn {
        text: None,
        tool_uses: vec![tool_use(id, name, input)],
    }
}

/// Scripted [`ModelPort`]: replays canned turns and records the `messages`
/// slice it was handed each call, so a test can assert the multi-turn feedback
/// that reached the model (port of the TS `scriptedModel`).
pub struct ScriptedModel {
    turns: Vec<ScriptedTurn>,
    idx: RefCell<usize>,
    calls: RefCell<Vec<Vec<Value>>>,
}

impl ScriptedModel {
    pub fn new(turns: Vec<ScriptedTurn>) -> Self {
        Self {
            turns,
            idx: RefCell::new(0),
            calls: RefCell::new(Vec::new()),
        }
    }

    /// The `messages` slice handed to `complete` on each call, in order.
    pub fn calls(&self) -> Vec<Vec<Value>> {
        self.calls.borrow().clone()
    }
}

impl ModelPort for ScriptedModel {
    fn complete(
        &self,
        _system: &str,
        messages: &[Value],
        _tools: &[Value],
    ) -> Result<ModelReply, String> {
        self.calls.borrow_mut().push(messages.to_vec());
        let i = *self.idx.borrow();
        let clamped = i.min(self.turns.len().saturating_sub(1));
        let turn = &self.turns[clamped];
        *self.idx.borrow_mut() = i + 1;
        Ok(reply_from(turn.text.as_deref(), turn.tool_uses.clone()))
    }
}

/// A [`ModelPort`] driven by a closure of the 1-based call count, for tests
/// that need to react to the loop (budget exhaustion, mid-run cancellation).
pub struct FnModel<'a> {
    f: Box<dyn Fn(usize) -> ModelReply + 'a>,
    count: RefCell<usize>,
}

impl<'a> FnModel<'a> {
    pub fn new(f: impl Fn(usize) -> ModelReply + 'a) -> Self {
        Self {
            f: Box::new(f),
            count: RefCell::new(0),
        }
    }
}

impl ModelPort for FnModel<'_> {
    fn complete(
        &self,
        _system: &str,
        _messages: &[Value],
        _tools: &[Value],
    ) -> Result<ModelReply, String> {
        let n = {
            let mut c = self.count.borrow_mut();
            *c += 1;
            *c
        };
        Ok((self.f)(n))
    }
}

/// A reply carrying a single tool call — handy for [`FnModel`] closures.
pub fn reply_tool(id: &str, name: &str, input: Value) -> ModelReply {
    reply_from(None, vec![tool_use(id, name, input)])
}
