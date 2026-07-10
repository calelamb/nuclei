//! `check_algorithm_invariant` executor (port of
//! `src/services/agent/algorithmInvariantExecutor.ts`). After a simulation,
//! checks the most recent result against the known-correct reference
//! distribution for a recognized canonical algorithm. Never throws: a missing
//! prerequisite resolves to `ok:true` with `checked:false`.

use serde_json::{json, Value};

use crate::dirac::analysis::{
    classify_algorithm, compare_distributions, expected_distribution, AlgorithmKind,
};

use super::{ev_fail, ev_ok, get_f64, get_str, has_key, ToolContext, ToolEvidence};

const TOOL: &str = "check_algorithm_invariant";
const DEFAULT_INVARIANT_TOLERANCE: f64 = 0.1;

fn algorithm_from_str(value: &str) -> Option<AlgorithmKind> {
    match value {
        "bell" => Some(AlgorithmKind::Bell),
        "ghz" => Some(AlgorithmKind::Ghz),
        "uniform_superposition" => Some(AlgorithmKind::UniformSuperposition),
        "teleportation" => Some(AlgorithmKind::Teleportation),
        "unknown" => Some(AlgorithmKind::Unknown),
        _ => None,
    }
}

fn algorithm_to_str(kind: AlgorithmKind) -> &'static str {
    match kind {
        AlgorithmKind::Bell => "bell",
        AlgorithmKind::Ghz => "ghz",
        AlgorithmKind::UniformSuperposition => "uniform_superposition",
        AlgorithmKind::Teleportation => "teleportation",
        AlgorithmKind::Unknown => "unknown",
    }
}

pub fn exec_check_algorithm_invariant(input: &Value, id: &str, ctx: &ToolContext) -> ToolEvidence {
    // Optional algorithm override; present-but-invalid is an error.
    let algorithm_override = if has_key(input, "algorithm") {
        match get_str(input, "algorithm") {
            Some(s) => match algorithm_from_str(&s) {
                Some(kind) => Some(kind),
                None => {
                    return ev_fail(
                        TOOL,
                        id,
                        "If provided, \"algorithm\" must be one of: bell, ghz, uniform_superposition, teleportation, unknown.",
                        json!({}),
                    )
                }
            },
            None => {
                return ev_fail(TOOL, id, "If provided, \"algorithm\" must be a string.", json!({}))
            }
        }
    } else {
        None
    };

    let tolerance = if has_key(input, "tolerance") {
        match get_f64(input, "tolerance") {
            Some(t) => t,
            None => {
                return ev_fail(
                    TOOL,
                    id,
                    "If provided, \"tolerance\" must be a number.",
                    json!({}),
                )
            }
        }
    } else {
        DEFAULT_INVARIANT_TOLERANCE
    };

    let Some(sim) = ctx.last_result.as_ref() else {
        return ev_ok(
            TOOL,
            id,
            json!({ "checked": false, "reason": "Run a simulation first, then check the invariant." }),
        );
    };

    let snapshot = ctx.last_snapshot.as_ref();
    let algorithm = algorithm_override.unwrap_or_else(|| match snapshot {
        Some(s) => classify_algorithm(s).algorithm,
        None => AlgorithmKind::Unknown,
    });
    let qubit_count = snapshot.map(|s| s.qubit_count).unwrap_or_else(|| {
        sim.probabilities
            .keys()
            .next()
            .map(|k| k.len() as u32)
            .unwrap_or(0)
    });

    let Some(expected) = expected_distribution(algorithm, qubit_count) else {
        return ev_ok(
            TOOL,
            id,
            json!({
                "checked": false,
                "algorithm": algorithm_to_str(algorithm),
                "reason": "No fixed reference distribution for this algorithm; compare against your own expected_probabilities instead.",
            }),
        );
    };

    let report = compare_distributions(&sim.probabilities, &expected, tolerance);

    ev_ok(
        TOOL,
        id,
        json!({
            "checked": true,
            "algorithm": algorithm_to_str(algorithm),
            "matches": report.matches,
            "total_variation_distance": report.total_variation_distance,
            "worst_delta": report.worst_delta,
            "expected": expected,
            "note": format!("Compared against the known {} reference distribution.", algorithm_to_str(algorithm)),
        }),
    )
}
