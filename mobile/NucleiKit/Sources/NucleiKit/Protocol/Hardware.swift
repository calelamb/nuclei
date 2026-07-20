import Foundation

/// A hardware job's lifecycle status.
///
/// Mirrors the `status` union on `HardwareJobDTO` in `src/types/quantum.ts` and
/// `JobHandle.status` in `kernel/hardware/base.py`. `.unknown` also absorbs any
/// unrecognized provider state per the additive-protocol rule.
public enum JobStatus: String, Codable, Sendable {
    case queued, running, complete, failed, unknown, stale

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = JobStatus(rawValue: raw) ?? .unknown
    }

    /// Terminal states never poll further (history survives kernel restart).
    public var isTerminal: Bool { self == .complete || self == .failed }
}

/// A hardware job as seen on the wire.
///
/// Mirrors `HardwareJobDTO` (`src/types/quantum.ts`) / `JobHandle`
/// (`kernel/hardware/base.py`). NOTE: `id` is the kernel's locally-generated
/// UUID, **not** the provider's job id — cross-referencing a provider console
/// is manual. `queue_position` is `-1` when the provider can't determine it
/// (e.g. Azure), `nil` when not applicable.
public struct HardwareJob: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var provider: String
    public var backend: String
    public var status: JobStatus
    public var queue_position: Int?
    public var shots: Int
    /// ISO-8601 UTC timestamp.
    public var submitted_at: String
    public var error: String?

    public init(
        id: String,
        provider: String,
        backend: String,
        status: JobStatus,
        queue_position: Int?,
        shots: Int,
        submitted_at: String,
        error: String? = nil
    ) {
        self.id = id
        self.provider = provider
        self.backend = backend
        self.status = status
        self.queue_position = queue_position
        self.shots = shots
        self.submitted_at = submitted_at
        self.error = error
    }
}

/// The registered hardware provider ids (`kernel/hardware/manager.py`).
/// `google` is a scaffold only (connect returns false). `simulator` is
/// auto-connected by the kernel at startup.
public enum HardwareProvider: String, Codable, Sendable, CaseIterable {
    case simulator, ibm, google, ionq, nvidia, braket, azure, quantinuum
}
