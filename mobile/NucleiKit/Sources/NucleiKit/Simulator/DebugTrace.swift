import Foundation

/// One step of the step-through debugger: the state *after* applying the gate at
/// `gate_index` (`-1` = the initial |0…0⟩ before any gate). Mirrors `DebugStep`
/// in `src/types/quantum.ts`.
public struct DebugStep: Codable, Equatable, Sendable {
    public var gate_index: Int
    public var label: String
    public var probabilities: [String: Double]
    public var bloch_coords: [BlochCoord]
}

/// The full per-gate trajectory. Mirrors `DebugTrace` in `src/types/quantum.ts`.
/// `steps[0]` is the initial state; `steps[k+1]` aligns with `gates[k]`.
public struct DebugTrace: Codable, Equatable, Sendable {
    public var framework: Framework
    public var qubit_count: Int
    public var steps: [DebugStep]
}

public extension StatevectorSimulator {
    /// Compute the per-gate state trajectory in one pass, so the debugger can
    /// scrub instantly (the same design the kernel uses — one call, then cached).
    /// Measurement gates are skipped, matching `evolve`.
    static func trace(_ snapshot: CircuitSnapshot, qubitCap: Int = defaultQubitCap) throws -> DebugTrace {
        let n = snapshot.qubit_count
        guard n <= qubitCap else { throw SimError.tooManyQubits(requested: n, cap: qubitCap) }

        var state = [Complex](repeating: .zero, count: 1 << n)
        state[0] = .one

        func snapshotStep(_ index: Int, _ label: String) -> DebugStep {
            var probs: [String: Double] = [:]
            for i in 0..<state.count {
                let p = state[i].magnitudeSquared
                if p > 1e-10 { probs[bitstring(i, width: n)] = p }
            }
            let bloch = (0..<n).map { blochVector(state: state, qubit: $0) }
            return DebugStep(gate_index: index, label: label, probabilities: probs, bloch_coords: bloch)
        }

        var steps: [DebugStep] = [snapshotStep(-1, "|0…0⟩")]
        for (k, gate) in snapshot.gates.enumerated() {
            evolveOne(gate, state: &state, qubitCount: n)
            steps.append(snapshotStep(k, label(for: gate)))
        }
        return DebugTrace(framework: snapshot.framework, qubit_count: n, steps: steps)
    }

    /// A readable step label like `H q0` or `CNOT q0→q1`.
    private static func label(for gate: Gate) -> String {
        let t = gate.targets.map { "q\($0)" }.joined(separator: ",")
        if gate.controls.isEmpty { return "\(gate.type) \(t)" }
        let c = gate.controls.map { "q\($0)" }.joined(separator: ",")
        return "\(gate.type) \(c)→\(t)"
    }
}
