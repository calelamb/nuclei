import Foundation
import Observation
import NucleiKit

/// The composer's circuit state — the native analogue of the web app's
/// `circuitStore`. Produces a `CircuitSnapshot` on demand so the simulator and
/// (later) a remote kernel see the exact same shape.
@Observable
final class CircuitModel {
    var qubitCount: Int = 2 {
        didSet { pruneOutOfRangeGates() }
    }
    var gates: [PlacedGate] = []

    // MARK: Derived

    /// The kernel-shaped snapshot. Gates are ordered by (column, first qubit);
    /// `layer` == the visual column; `depth` == column count.
    var snapshot: CircuitSnapshot {
        let ordered = gates.sorted {
            ($0.column, $0.targets.first ?? 0) < ($1.column, $1.targets.first ?? 0)
        }
        let mapped = ordered.map {
            Gate(type: $0.kind.canonicalName,
                 targets: $0.targets,
                 controls: $0.controls,
                 params: $0.params,
                 layer: $0.column)
        }
        let depth = (gates.map(\.column).max() ?? -1) + 1
        return CircuitSnapshot(framework: .qiskit,
                               qubit_count: qubitCount,
                               classical_bit_count: qubitCount,
                               depth: depth,
                               gates: mapped)
    }

    /// Columns to render (at least a few empty ones so there's always somewhere
    /// to drop the next gate).
    var columnCount: Int {
        let used = (gates.map(\.column).max() ?? -1) + 1
        return max(used + 1, 4)
    }

    var isEmpty: Bool { gates.isEmpty }

    // MARK: Mutation

    /// Is `(qubit, column)` free for a new single-qubit placement?
    func isFree(qubit: Int, column: Int) -> Bool {
        !gates.contains { $0.column == column && $0.occupiedQubits.contains(qubit) }
    }

    func placeSingle(_ kind: GateKind, qubit: Int, column: Int) {
        guard isFree(qubit: qubit, column: column) else { return }
        var g = PlacedGate(kind: kind, column: column, targets: [qubit])
        if kind.hasParameter { g.params = [.pi / 2] }   // a sensible default the user can tune
        gates.append(g)
    }

    func placeTwoQubit(_ kind: GateKind, a: Int, b: Int, column: Int) {
        guard a != b else { return }
        // Don't overlap an existing gate in this column on either row.
        guard isFree(qubit: a, column: column), isFree(qubit: b, column: column) else { return }
        if kind.isControlled {
            gates.append(PlacedGate(kind: kind, column: column, targets: [b], controls: [a]))
        } else { // SWAP
            gates.append(PlacedGate(kind: kind, column: column, targets: [a, b]))
        }
    }

    func remove(_ gate: PlacedGate) {
        gates.removeAll { $0.id == gate.id }
    }

    func setParam(_ gate: PlacedGate, radians: Double) {
        guard let i = gates.firstIndex(where: { $0.id == gate.id }) else { return }
        gates[i].params = [radians]
    }

    func clear() { gates.removeAll() }

    func setQubitCount(_ n: Int) {
        qubitCount = max(1, min(n, StatevectorSimulator.defaultQubitCap))
    }

    func load(_ template: CircuitTemplate) {
        qubitCount = template.qubitCount
        gates = template.gates
    }

    private func pruneOutOfRangeGates() {
        gates.removeAll { g in g.occupiedQubits.contains { $0 >= qubitCount } }
    }
}
