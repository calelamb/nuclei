import Foundation

/// A native Swift statevector simulator.
///
/// It takes a `CircuitSnapshot` (typically produced by the touch/Pencil composer)
/// and returns a `SimulationResult` whose shape is byte-compatible with the
/// Python kernel's (`kernel/models/snapshot.py`): full `state_vector`,
/// `probabilities` (entries ≤ 1e-10 pruned), sampled `measurements`, per-qubit
/// `bloch_coords`, timing, and the v1.1 `metrics` / `seed_honored` fields.
///
/// ## Conventions (documented because the composer defines them)
/// - **Qubit ordering:** qubit *q* is bit *q* of the basis index (little-endian,
///   qubit 0 = least-significant bit), matching Qiskit's convention.
/// - **Bitstring keys:** the plain base-2 string of the basis index, width
///   `qubit_count` — so qubit `n-1` is the leftmost character, qubit 0 the
///   rightmost. Treat keys as opaque labels, as the kernel docs advise.
/// - **Measurement:** `M`/`MEASURE`/`MZ` gates are no-ops for the statevector;
///   `measurements` is sampled over the *full register* in the computational
///   basis at the end. Partial-register measurement is out of scope for v1.
public enum StatevectorSimulator {

    public enum SimError: Error, Sendable, Equatable {
        /// Circuit exceeds the local qubit cap — route to a remote kernel instead.
        case tooManyQubits(requested: Int, cap: Int)
        /// A gate the local engine doesn't implement yet.
        case unsupportedGate(String)
        case badQubitIndex(gate: String, index: Int, qubitCount: Int)
    }

    /// Default local cap. 16 qubits = 65,536 amplitudes ≈ 1 MB — trivial on
    /// device. Callers can raise it on M-series iPads or lower it on old phones.
    public static let defaultQubitCap = 16

    /// Run a full simulation.
    /// - Parameters:
    ///   - snapshot: the circuit (gates applied in array order = program order).
    ///   - shots: number of measurement samples.
    ///   - seed: optional; when present, sampling is reproducible and the result
    ///           reports `seed_honored: true`.
    ///   - qubitCap: local qubit ceiling (see `defaultQubitCap`).
    public static func run(
        _ snapshot: CircuitSnapshot,
        shots: Int = 1024,
        seed: Int? = nil,
        qubitCap: Int = defaultQubitCap
    ) throws -> SimulationResult {
        let n = snapshot.qubit_count
        guard n <= qubitCap else { throw SimError.tooManyQubits(requested: n, cap: qubitCap) }
        let start = DispatchTime.now()

        var state = evolve(snapshot, qubitCount: n)

        // Probabilities (prune tiny, matching the kernel's ≤1e-10 rule).
        var probabilities: [String: Double] = [:]
        let dim = state.count
        for i in 0..<dim {
            let p = state[i].magnitudeSquared
            if p > 1e-10 {
                probabilities[bitstring(i, width: n)] = p
            }
        }

        // Sampled measurements over the full register.
        let hasMeasurement = snapshot.gates.contains { isMeasurement($0.type) }
        let measurements = hasMeasurement
            ? sample(state: state, qubitCount: n, shots: shots, seed: seed)
            : [:]

        let bloch = (0..<n).map { blochVector(state: state, qubit: $0) }

        let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
        // Clean numerical -0.0 noise out of the reported state vector.
        state = state.map { Complex(cleanup($0.re), cleanup($0.im)) }

        return SimulationResult(
            state_vector: state,
            probabilities: probabilities,
            measurements: measurements,
            bloch_coords: bloch,
            execution_time_ms: (elapsedMs * 10).rounded() / 10,
            shot_count: hasMeasurement ? shots : 0,
            metrics: [:],
            seed_honored: seed != nil ? true : nil
        )
    }

    // MARK: - Evolution

    /// Apply every gate to a fresh |0…0⟩ state and return the final amplitudes.
    static func evolve(_ snapshot: CircuitSnapshot, qubitCount n: Int) -> [Complex] {
        var state = [Complex](repeating: .zero, count: 1 << n)
        state[0] = .one
        for gate in snapshot.gates where !isMeasurement(gate.type) {
            evolveOne(gate, state: &state, qubitCount: n)
        }
        return state
    }

    /// Apply a single gate in place. Measurement gates are treated as no-ops by
    /// callers (`evolve`/`trace` filter them), so this assumes a unitary gate.
    static func evolveOne(_ gate: Gate, state: inout [Complex], qubitCount n: Int) {
        // SWAP is its own two-qubit permutation, not a controlled 1-qubit gate.
        if gate.type.uppercased() == "SWAP", gate.targets.count == 2 {
            applySwap(gate.targets[0], gate.targets[1], to: &state, qubitCount: n)
            return
        }
        guard let target = gate.targets.first else { return }
        let m = matrix(for: gate)
        applySingleQubit(m, target: target, controls: gate.controls, to: &state, qubitCount: n)
    }

    /// Apply a 2×2 matrix to `target`, gated by all `controls` being |1⟩.
    private static func applySingleQubit(
        _ m: [Complex], target: Int, controls: [Int],
        to state: inout [Complex], qubitCount n: Int
    ) {
        let targetBit = 1 << target
        let controlMask = controls.reduce(0) { $0 | (1 << $1) }
        let dim = state.count
        for i in 0..<dim where (i & targetBit) == 0 {
            // Only act where every control qubit is set.
            if (i & controlMask) != controlMask { continue }
            let j = i | targetBit
            let a = state[i]
            let b = state[j]
            state[i] = m[0] * a + m[1] * b
            state[j] = m[2] * a + m[3] * b
        }
    }

    private static func applySwap(_ q1: Int, _ q2: Int, to state: inout [Complex], qubitCount n: Int) {
        let b1 = 1 << q1, b2 = 1 << q2
        let dim = state.count
        for i in 0..<dim {
            let bit1 = (i & b1) != 0
            let bit2 = (i & b2) != 0
            if bit1 && !bit2 {
                let j = (i & ~b1) | b2
                state.swapAt(i, j)
            }
        }
    }

    // MARK: - Gate matrices  (row-major: [m00, m01, m10, m11])

    private static func matrix(for gate: Gate) -> [Complex] {
        let name = gate.type.uppercased()
        let theta = gate.params.first ?? 0
        let invSqrt2 = 1.0 / 2.0.squareRoot()
        switch name {
        case "H":
            return [Complex(invSqrt2), Complex(invSqrt2), Complex(invSqrt2), Complex(-invSqrt2)]
        case "X", "CNOT", "CX", "CCX", "TOFFOLI", "MCX":
            return [.zero, .one, .one, .zero]
        case "Y":
            return [.zero, Complex(0, -1), Complex(0, 1), .zero]
        case "Z", "CZ":
            return [.one, .zero, .zero, Complex(-1)]
        case "S":
            return [.one, .zero, .zero, Complex(0, 1)]
        case "SDG", "SDAG":
            return [.one, .zero, .zero, Complex(0, -1)]
        case "T":
            return [.one, .zero, .zero, .expi(.pi / 4)]
        case "TDG", "TDAG":
            return [.one, .zero, .zero, .expi(-.pi / 4)]
        case "SX": // √X
            return [Complex(0.5, 0.5), Complex(0.5, -0.5), Complex(0.5, -0.5), Complex(0.5, 0.5)]
        case "RX":
            let c = cos(theta / 2), s = sin(theta / 2)
            return [Complex(c), Complex(0, -s), Complex(0, -s), Complex(c)]
        case "RY":
            let c = cos(theta / 2), s = sin(theta / 2)
            return [Complex(c), Complex(-s), Complex(s), Complex(c)]
        case "RZ":
            return [.expi(-theta / 2), .zero, .zero, .expi(theta / 2)]
        case "P", "PHASE", "U1":
            return [.one, .zero, .zero, .expi(theta)]
        case "I", "ID":
            return [.one, .zero, .zero, .one]
        default:
            // Unknown single-qubit gate → identity (honest no-op); the caller can
            // detect unsupported gates ahead of time via `unsupportedGates`.
            return [.one, .zero, .zero, .one]
        }
    }

    /// Gate names the engine simulates natively (uppercased).
    public static let supportedGates: Set<String> = [
        "H", "X", "Y", "Z", "S", "SDG", "SDAG", "T", "TDG", "TDAG", "SX", "I", "ID",
        "RX", "RY", "RZ", "P", "PHASE", "U1",
        "CNOT", "CX", "CZ", "CCX", "TOFFOLI", "MCX", "SWAP",
        "M", "MEASURE", "MZ",
    ]

    /// Any gate types in the snapshot the local engine can't run — the app uses
    /// this to decide whether to route to a remote kernel.
    public static func unsupportedGates(in snapshot: CircuitSnapshot) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for g in snapshot.gates where !supportedGates.contains(g.type.uppercased()) {
            let u = g.type.uppercased()
            if seen.insert(u).inserted { out.append(g.type) }
        }
        return out
    }

    private static func isMeasurement(_ type: String) -> Bool {
        switch type.uppercased() {
        case "M", "MEASURE", "MZ", "MRESETZ": return true
        default: return false
        }
    }

    // MARK: - Observables

    /// Per-qubit Bloch vector (⟨X⟩, ⟨Y⟩, ⟨Z⟩). Length < 1 signals a mixed
    /// (entangled) reduced state.
    static func blochVector(state: [Complex], qubit q: Int) -> BlochCoord {
        let bit = 1 << q
        var x = 0.0, y = 0.0, z = 0.0
        for i in 0..<state.count where (i & bit) == 0 {
            let a = state[i]                 // qubit q = |0⟩ component
            let b = state[i | bit]           // qubit q = |1⟩ component
            let cross = a.conjugate * b      // ⟨a|b⟩ per pair
            x += 2 * cross.re
            y += 2 * cross.im
            z += a.magnitudeSquared - b.magnitudeSquared
        }
        return BlochCoord(x: cleanup(x), y: cleanup(y), z: cleanup(z))
    }

    // MARK: - Sampling

    static func sample(state: [Complex], qubitCount n: Int, shots: Int, seed: Int?) -> [String: Int] {
        guard shots > 0 else { return [:] }
        // Cumulative distribution over basis indices.
        var cumulative = [Double](repeating: 0, count: state.count)
        var running = 0.0
        for i in 0..<state.count {
            running += state[i].magnitudeSquared
            cumulative[i] = running
        }
        let total = running > 0 ? running : 1

        var counts: [String: Int] = [:]
        if let seed {
            var rng = SeededRNG(seed: UInt64(bitPattern: Int64(seed)))
            for _ in 0..<shots {
                let idx = pick(cumulative, r: rng.nextUnit() * total)
                counts[bitstring(idx, width: n), default: 0] += 1
            }
        } else {
            var rng = SystemRandomNumberGenerator()
            for _ in 0..<shots {
                let idx = pick(cumulative, r: Double.random(in: 0..<total, using: &rng))
                counts[bitstring(idx, width: n), default: 0] += 1
            }
        }
        return counts
    }

    /// Binary search into the cumulative distribution.
    private static func pick(_ cumulative: [Double], r: Double) -> Int {
        var lo = 0, hi = cumulative.count - 1
        while lo < hi {
            let mid = (lo + hi) / 2
            if r <= cumulative[mid] { hi = mid } else { lo = mid + 1 }
        }
        return lo
    }

    // MARK: - Helpers

    static func bitstring(_ index: Int, width: Int) -> String {
        var s = String(index, radix: 2)
        if s.count < width { s = String(repeating: "0", count: width - s.count) + s }
        return s
    }

    /// Squash sub-epsilon numerical dust (and -0.0) to a clean 0.
    private static func cleanup(_ v: Double) -> Double { abs(v) < 1e-12 ? 0 : v }
}
