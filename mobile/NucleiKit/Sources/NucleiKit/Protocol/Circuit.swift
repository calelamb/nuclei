import Foundation

/// A single gate in a circuit.
///
/// Mirrors `Gate` in `src/types/quantum.ts` and `Gate` in
/// `kernel/models/snapshot.py`. Field names are snake-free here (Swift style),
/// but they decode from the exact wire keys via the synthesized CodingKeys since
/// the JSON keys already match (`type`, `targets`, `controls`, `params`, `layer`).
public struct Gate: Codable, Equatable, Sendable {
    /// Canonical gate name — "H", "CNOT", "RZ"… Unknown gates pass through uppercased.
    public var type: String
    /// Target qubit indices.
    public var targets: [Int]
    /// Control qubit indices (empty for uncontrolled gates).
    public var controls: [Int]
    /// Gate parameters — rotation angles in radians, etc.
    public var params: [Double]
    /// Depth position (0-based column in the circuit diagram).
    public var layer: Int

    public init(
        type: String,
        targets: [Int],
        controls: [Int] = [],
        params: [Double] = [],
        layer: Int = 0
    ) {
        self.type = type
        self.targets = targets
        self.controls = controls
        self.params = params
        self.layer = layer
    }

    // The kernel omits `controls`/`params` when empty in some emitters; decode
    // defensively so an absent key becomes [] rather than a decode failure.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decode(String.self, forKey: .type)
        targets = try c.decode([Int].self, forKey: .targets)
        controls = try c.decodeIfPresent([Int].self, forKey: .controls) ?? []
        params = try c.decodeIfPresent([Double].self, forKey: .params) ?? []
        layer = try c.decodeIfPresent(Int.self, forKey: .layer) ?? 0
    }
}

/// The lightweight circuit description sent on every parse (no simulation).
///
/// Mirrors `CircuitSnapshot` in `src/types/quantum.ts` and
/// `kernel/models/snapshot.py`.
public struct CircuitSnapshot: Codable, Equatable, Sendable {
    public var framework: Framework
    public var qubit_count: Int
    public var classical_bit_count: Int
    public var depth: Int
    public var gates: [Gate]

    public init(
        framework: Framework,
        qubit_count: Int,
        classical_bit_count: Int,
        depth: Int,
        gates: [Gate]
    ) {
        self.framework = framework
        self.qubit_count = qubit_count
        self.classical_bit_count = classical_bit_count
        self.depth = depth
        self.gates = gates
    }
}
