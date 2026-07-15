//! Quantum-agent tool schemas (Stage R4 port of `src/services/agent/tools.ts`).
//!
//! The Anthropic tool-use JSON the model is given each turn. Every schema pins
//! `additionalProperties: false` and an explicit `required` list so the model
//! (and tests) can rely on strict, minimal inputs. Descriptions cast Dirac as a
//! rigorous quantum physicist–programmer: never assert an unobserved result,
//! verify by simulation, and treat a policy `needs_approval`/`deny` on hardware
//! submission as the expected safe outcome rather than an error to force past.

use serde_json::{json, Value};

/// One tool schema. Kept as a helper so every entry is uniformly shaped.
fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({
        "name": name,
        "description": description,
        "input_schema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false,
        }
    })
}

fn path_prop(desc: &str) -> Value {
    json!({ "path": { "type": "string", "description": desc } })
}

/// The full quantum-agent tool set, in the same order as the TS reference.
pub fn agent_tools() -> Vec<Value> {
    vec![
        tool(
            "inspect_project",
            "List every file currently in the workspace along with which one is active.",
            json!({}),
            &[],
        ),
        tool(
            "read_quantum_file",
            "Read the full current contents of a quantum program file in the workspace.",
            path_prop("Workspace-relative file path to read."),
            &["path"],
        ),
        tool(
            "apply_patch",
            "Apply a reversible, journaled edit that replaces the full contents of a file. \
             Conflict-checked against the last content this agent observed for the path.",
            json!({
                "path": { "type": "string", "description": "Workspace-relative file path to write." },
                "new_content": { "type": "string", "description": "The complete new contents of the file." },
                "rationale": { "type": "string", "description": "One-sentence reason for this edit." },
            }),
            &["path", "new_content", "rationale"],
        ),
        tool(
            "rollback_patch",
            "Revert a previously applied patch by its transaction id.",
            json!({
                "transaction_id": { "type": "string", "description": "The id returned by a prior apply_patch call." },
            }),
            &["transaction_id"],
        ),
        tool(
            "parse_quantum_program",
            "Parse and structurally validate a quantum program without running a simulation.",
            path_prop("Workspace-relative file path; defaults to the active file."),
            &[],
        ),
        tool(
            "validate_quantum_program",
            "Parse the program and run structural/semantic validators (out-of-range qubits, \
             control/target collisions, gate arity mismatches, empty circuits); returns a list of diagnostics.",
            path_prop("Workspace-relative file path; defaults to the active file."),
            &[],
        ),
        tool(
            "estimate_quantum_resources",
            "Parse the program and report qubit/gate/depth resource metrics, without running a simulation.",
            path_prop("Workspace-relative file path; defaults to the active file."),
            &[],
        ),
        tool(
            "run_simulation",
            "Simulate a quantum program locally and return probabilities and measurement facts. \
             This is how you actually OBSERVE a result — never assert an outcome you have not simulated.",
            json!({
                "path": { "type": "string", "description": "Workspace-relative file path; defaults to the active file." },
                "shots": { "type": "number", "description": "Number of shots to simulate; defaults to 1024." },
            }),
            &[],
        ),
        tool(
            "compare_quantum_results",
            "Compare the most recent run_simulation result's probabilities to an expected distribution.",
            json!({
                "expected_probabilities": {
                    "type": "object",
                    "description": "Map of measured bitstring state to expected probability (0-1).",
                    "additionalProperties": { "type": "number" },
                },
                "tolerance": { "type": "number", "description": "Allowed absolute delta per state; defaults to 0.05." },
            }),
            &["expected_probabilities"],
        ),
        tool(
            "check_algorithm_invariant",
            "After running a simulation, check the most recent result against the known-correct reference \
             distribution for a recognized canonical algorithm (Bell, GHZ, or uniform superposition). \
             Auto-detects the algorithm from the last parsed circuit when not given explicitly. Returns \
             checked:false with a reason when there's no simulation yet or no fixed reference distribution \
             applies (e.g. teleportation, whose correct output depends on the input state) — use \
             compare_quantum_results with your own expected_probabilities in that case instead.",
            json!({
                "algorithm": {
                    "type": "string",
                    "enum": ["bell", "ghz", "uniform_superposition", "teleportation", "unknown"],
                    "description": "Override the auto-detected algorithm classification.",
                },
                "tolerance": { "type": "number", "description": "Allowed absolute delta per state; defaults to 0.1." },
            }),
            &[],
        ),
        tool(
            "plan_hardware_run",
            "SHADOW MODE ONLY: analyze the parsed circuit against currently known hardware backends and \
             recommend a compatible one with an explainable score. This is a recommendation for the user's \
             consideration — it never submits a job or contacts a provider, and it is not a substitute for \
             run_simulation.",
            path_prop("Workspace-relative file path; defaults to the active file."),
            &[],
        ),
        tool(
            "preview_backend_transpilation",
            "Transpile the parsed circuit against a target hardware backend's real basis gates and coupling \
             map using qiskit's transpiler, and report the resulting depth, gate counts, and two-qubit-gate \
             count. Qiskit circuits only — other frameworks report unavailable rather than erroring. This is \
             analysis only; it never submits a job.",
            json!({
                "path": { "type": "string", "description": "Workspace-relative file path; defaults to the active file." },
                "backend": { "type": "string", "description": "Name of the backend to target; defaults to the first online backend." },
            }),
            &[],
        ),
        tool(
            "transpile_explore",
            "Transpile the active circuit and return the transpiler's per-pass behavior for a target: \
             before/after depth, two-qubit, and total gate counts, plus which passes added the routing \
             SWAPs and basis-translation gates. Qiskit circuits only. Use this to EXPLAIN why a circuit's \
             depth or two-qubit count grew for a device, beyond the headline numbers preview_backend_\
             transpilation reports. Analysis only; it never submits a job.",
            json!({
                "path": { "type": "string", "description": "Workspace-relative file path; defaults to the active file." },
                "backend": { "type": "string", "description": "Name of a connected backend to take basis gates and coupling map from. Omit for the all-to-all simulator target (optimization only, no routing)." },
                "optimization_level": { "type": "number", "description": "Qiskit preset optimization level 0-3; defaults to 1." },
            }),
            &[],
        ),
        tool(
            "submit_hardware_job",
            "Submit the active circuit to a named hardware backend for execution. POLICY-GATED: a real, paid \
             QPU submission is only ever sent if a human has explicitly enabled autonomous hardware submission \
             in Settings; otherwise this returns a needs_approval (or deny) result and NOTHING is submitted — \
             that is the expected, safe outcome, not an error. Simulator backends run for free under the \
             separate simulator policy toggle. Never retry this tool to try to force a submission after a \
             needs_approval or deny result — report the outcome to the user instead. Real hardware costs real money.",
            json!({
                "backend": { "type": "string", "description": "Name of the backend to submit to." },
                "shots": { "type": "number", "description": "Number of shots to request." },
            }),
            &["backend", "shots"],
        ),
        tool(
            "poll_hardware_job",
            "Check the current status and queue position of a previously submitted hardware job.",
            json!({
                "job_id": { "type": "string", "description": "The job id returned by submit_hardware_job." },
            }),
            &["job_id"],
        ),
        tool(
            "cancel_hardware_job",
            "Cancel a previously submitted, still-pending hardware job.",
            json!({
                "job_id": { "type": "string", "description": "The job id to cancel." },
            }),
            &["job_id"],
        ),
        tool(
            "analyze_hardware_result",
            "Fetch the measured probabilities for a completed hardware job, optionally comparing them against \
             an expected distribution the same way compare_quantum_results does for local simulations.",
            json!({
                "job_id": { "type": "string", "description": "The job id to fetch results for." },
                "expected_probabilities": {
                    "type": "object",
                    "description": "Optional map of measured bitstring state to expected probability (0-1).",
                    "additionalProperties": { "type": "number" },
                },
            }),
            &["job_id"],
        ),
        tool(
            "finish",
            "Terminate the run with a final summary and a verdict on whether the goal was met. Never call \
             finish with success:true without having actually observed a matching result via run_simulation.",
            json!({
                "summary": { "type": "string", "description": "Plain-English summary of what was done and the outcome." },
                "success": { "type": "boolean", "description": "Whether the success criterion was met." },
            }),
            &["summary", "success"],
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tool_has_a_strict_object_schema() {
        let tools = agent_tools();
        assert_eq!(tools.len(), 18);
        for t in &tools {
            let schema = &t["input_schema"];
            assert_eq!(schema["type"], "object");
            assert_eq!(schema["additionalProperties"], false);
            assert!(schema["properties"].is_object());
            assert!(schema["required"].is_array());
            assert!(t["name"].is_string());
            assert!(t["description"].is_string());
        }
    }

    #[test]
    fn contains_the_expected_tool_names_in_order() {
        let names: Vec<String> = agent_tools()
            .iter()
            .map(|t| t["name"].as_str().unwrap_or_default().to_string())
            .collect();
        assert_eq!(
            names,
            vec![
                "inspect_project",
                "read_quantum_file",
                "apply_patch",
                "rollback_patch",
                "parse_quantum_program",
                "validate_quantum_program",
                "estimate_quantum_resources",
                "run_simulation",
                "compare_quantum_results",
                "check_algorithm_invariant",
                "plan_hardware_run",
                "preview_backend_transpilation",
                "transpile_explore",
                "submit_hardware_job",
                "poll_hardware_job",
                "cancel_hardware_job",
                "analyze_hardware_result",
                "finish",
            ]
        );
    }

    #[test]
    fn required_fields_match_the_reference() {
        let tools = agent_tools();
        let by_name = |name: &str| tools.iter().find(|t| t["name"] == name).unwrap().clone();
        assert_eq!(
            by_name("apply_patch")["input_schema"]["required"],
            json!(["path", "new_content", "rationale"])
        );
        assert_eq!(
            by_name("submit_hardware_job")["input_schema"]["required"],
            json!(["backend", "shots"])
        );
        assert_eq!(
            by_name("finish")["input_schema"]["required"],
            json!(["summary", "success"])
        );
        assert_eq!(
            by_name("inspect_project")["input_schema"]["required"],
            json!([])
        );
    }
}
