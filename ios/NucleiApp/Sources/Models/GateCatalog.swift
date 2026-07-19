import Foundation

/// Broad gate categories, used for coloring and layout.
enum GateCategory {
    case single, rotation, controlled, measure
}

/// A gate the composer can place. Display metadata + how it maps to the kernel's
/// canonical gate names (which `StatevectorSimulator` understands).
enum GateKind: String, CaseIterable, Identifiable, Sendable {
    case h, x, y, z, s, t, sdg, tdg
    case rx, ry, rz
    case cnot, cz, swap
    case measure

    var id: String { rawValue }

    /// The glyph shown on the grid.
    var symbol: String {
        switch self {
        case .h: return "H"
        case .x: return "X"
        case .y: return "Y"
        case .z: return "Z"
        case .s: return "S"
        case .t: return "T"
        case .sdg: return "S†"
        case .tdg: return "T†"
        case .rx: return "Rx"
        case .ry: return "Ry"
        case .rz: return "Rz"
        case .cnot: return "⊕"
        case .cz: return "CZ"
        case .swap: return "⤫"
        case .measure: return "M"
        }
    }

    /// A short human name for the palette + Dirac prompts.
    var displayName: String {
        switch self {
        case .h: return "Hadamard"
        case .x: return "Pauli-X"
        case .y: return "Pauli-Y"
        case .z: return "Pauli-Z"
        case .s: return "Phase S"
        case .t: return "T"
        case .sdg: return "S dagger"
        case .tdg: return "T dagger"
        case .rx: return "Rotation X"
        case .ry: return "Rotation Y"
        case .rz: return "Rotation Z"
        case .cnot: return "CNOT"
        case .cz: return "Controlled-Z"
        case .swap: return "SWAP"
        case .measure: return "Measure"
        }
    }

    /// The canonical name the kernel/simulator expects.
    var canonicalName: String {
        switch self {
        case .h: return "H"
        case .x: return "X"
        case .y: return "Y"
        case .z: return "Z"
        case .s: return "S"
        case .t: return "T"
        case .sdg: return "SDG"
        case .tdg: return "TDG"
        case .rx: return "RX"
        case .ry: return "RY"
        case .rz: return "RZ"
        case .cnot: return "CNOT"
        case .cz: return "CZ"
        case .swap: return "SWAP"
        case .measure: return "MEASURE"
        }
    }

    /// How many qubits the user must pick to place it.
    var qubitCount: Int {
        switch self {
        case .cnot, .cz, .swap: return 2
        default: return 1
        }
    }

    /// A control+target gate (first pick is the control).
    var isControlled: Bool { self == .cnot || self == .cz }

    /// Carries a rotation angle the user can tune.
    var hasParameter: Bool { self == .rx || self == .ry || self == .rz }

    var category: GateCategory {
        switch self {
        case .rx, .ry, .rz: return .rotation
        case .cnot, .cz, .swap: return .controlled
        case .measure: return .measure
        default: return .single
        }
    }

    /// Palette groupings for the gate tray.
    static let paletteOrder: [GateKind] =
        [.h, .x, .y, .z, .s, .t, .sdg, .tdg, .rx, .ry, .rz, .cnot, .cz, .swap, .measure]
}

/// A gate placed on the composer grid. Carries an explicit `column` so the grid
/// is stable while editing (the column becomes the snapshot's `layer`).
struct PlacedGate: Identifiable, Equatable, Sendable {
    let id = UUID()
    var kind: GateKind
    var column: Int
    /// Target qubit indices (SWAP has two; everything else has one).
    var targets: [Int]
    /// Control qubit indices (CNOT/CZ have one).
    var controls: [Int] = []
    /// Rotation angle in radians (rotation gates only).
    var params: [Double] = []

    /// Every qubit row this gate touches — used for occupancy/hit-testing.
    var occupiedQubits: [Int] { targets + controls }
}
