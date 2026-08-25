import Foundation

/// A complex number on the wire: `{ re, im }`.
///
/// Mirrors `Complex` in `src/types/quantum.ts`. Arithmetic lives in
/// `Complex+Math.swift` (kept separate so the DTO stays a plain Codable).
public struct Complex: Codable, Equatable, Sendable {
    public var re: Double
    public var im: Double
    public init(_ re: Double, _ im: Double = 0) {
        self.re = re
        self.im = im
    }
}

/// A point on the Bloch sphere: `{ x, y, z }`.
///
/// Mirrors `BlochCoord` in `src/types/quantum.ts`.
public struct BlochCoord: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var z: Double
    public init(x: Double, y: Double, z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }
}

/// The full result of an execution.
///
/// Mirrors `SimulationResult` in `src/types/quantum.ts` and
/// `kernel/models/snapshot.py`. Protocol v1.1 added `metrics` (always present)
/// and `seed_honored` (present **only** when a seed was requested — omitted, not
/// false, otherwise), so `seed_honored` is optional here.
public struct SimulationResult: Codable, Equatable, Sendable {
    public var state_vector: [Complex]
    public var probabilities: [String: Double]
    public var measurements: [String: Int]
    public var bloch_coords: [BlochCoord]
    public var execution_time_ms: Double
    public var shot_count: Int
    /// v1.1 — accumulated `record_metric(name, value)` values; `[:]` when none.
    public var metrics: [String: Double]
    /// v1.1 — whether the backend honored a requested seed. Nil when no seed
    /// was requested (the key is absent on the wire).
    public var seed_honored: Bool?

    public init(
        state_vector: [Complex],
        probabilities: [String: Double],
        measurements: [String: Int],
        bloch_coords: [BlochCoord],
        execution_time_ms: Double,
        shot_count: Int,
        metrics: [String: Double] = [:],
        seed_honored: Bool? = nil
    ) {
        self.state_vector = state_vector
        self.probabilities = probabilities
        self.measurements = measurements
        self.bloch_coords = bloch_coords
        self.execution_time_ms = execution_time_ms
        self.shot_count = shot_count
        self.metrics = metrics
        self.seed_honored = seed_honored
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state_vector = try c.decodeIfPresent([Complex].self, forKey: .state_vector) ?? []
        probabilities = try c.decodeIfPresent([String: Double].self, forKey: .probabilities) ?? [:]
        measurements = try c.decodeIfPresent([String: Int].self, forKey: .measurements) ?? [:]
        bloch_coords = try c.decodeIfPresent([BlochCoord].self, forKey: .bloch_coords) ?? []
        execution_time_ms = try c.decodeIfPresent(Double.self, forKey: .execution_time_ms) ?? 0
        shot_count = try c.decodeIfPresent(Int.self, forKey: .shot_count) ?? 0
        metrics = try c.decodeIfPresent([String: Double].self, forKey: .metrics) ?? [:]
        seed_honored = try c.decodeIfPresent(Bool.self, forKey: .seed_honored)
    }
}

/// The kernel's self-report of interpreter/platform/installed frameworks.
///
/// Mirrors `KernelEnvironment` in `src/types/quantum.ts`. Package keys are
/// present only when that distribution resolved on the kernel host; absent keys
/// mean "not installed" (never a placeholder value).
public struct KernelEnvironment: Codable, Equatable, Sendable {
    public var python: String
    public var platform: String
    public var packages: [String: String]

    public init(python: String, platform: String, packages: [String: String]) {
        self.python = python
        self.platform = platform
        self.packages = packages
    }
}
