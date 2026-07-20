import Foundation

/// A one-tap starter circuit. Lowering the "blank canvas" cost is one of the
/// biggest mobile-usability wins — most people want to *see something happen*
/// before they learn the gates.
struct CircuitTemplate: Identifiable, Sendable {
    let id = UUID()
    let name: String
    let blurb: String
    let qubitCount: Int
    let gates: [PlacedGate]

    static let library: [CircuitTemplate] = [
        CircuitTemplate(
            name: "Superposition",
            blurb: "One Hadamard — a fair quantum coin.",
            qubitCount: 1,
            gates: [
                PlacedGate(kind: .h, column: 0, targets: [0]),
                PlacedGate(kind: .measure, column: 1, targets: [0]),
            ]),
        CircuitTemplate(
            name: "Bell pair",
            blurb: "Two entangled qubits: always 00 or 11.",
            qubitCount: 2,
            gates: [
                PlacedGate(kind: .h, column: 0, targets: [0]),
                PlacedGate(kind: .cnot, column: 1, targets: [1], controls: [0]),
                PlacedGate(kind: .measure, column: 2, targets: [0]),
                PlacedGate(kind: .measure, column: 2, targets: [1]),
            ]),
        CircuitTemplate(
            name: "GHZ state",
            blurb: "Three-way entanglement: 000 or 111.",
            qubitCount: 3,
            gates: [
                PlacedGate(kind: .h, column: 0, targets: [0]),
                PlacedGate(kind: .cnot, column: 1, targets: [1], controls: [0]),
                PlacedGate(kind: .cnot, column: 2, targets: [2], controls: [1]),
            ]),
        CircuitTemplate(
            name: "Phase kickback",
            blurb: "An Rz rotation you can dial — watch the Bloch vector spin.",
            qubitCount: 1,
            gates: [
                PlacedGate(kind: .h, column: 0, targets: [0]),
                PlacedGate(kind: .rz, column: 1, targets: [0], params: [.pi / 2]),
                PlacedGate(kind: .h, column: 2, targets: [0]),
            ]),
        CircuitTemplate(
            name: "Swap test seed",
            blurb: "A SWAP between two qubits after preparing them differently.",
            qubitCount: 2,
            gates: [
                PlacedGate(kind: .h, column: 0, targets: [0]),
                PlacedGate(kind: .x, column: 0, targets: [1]),
                PlacedGate(kind: .swap, column: 1, targets: [0, 1]),
            ]),
    ]
}
