import Foundation

/// The eight kernel error codes (`kernel/models/errors.py`, docs `errors.mdx`).
/// `.unknown` preserves any future/unrecognized code per the additive-protocol
/// "ignore unknowns" rule rather than failing to decode.
public enum KernelErrorCode: String, Codable, Sendable {
    case unsupportedFramework = "unsupported_framework"
    case missingDependency = "missing_dependency"
    case compileError = "compile_error"
    case executionError = "execution_error"
    case noCircuit = "no_circuit"
    case adapterError = "adapter_error"
    case simulationError = "simulation_error"
    case timeout

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = KernelErrorCode(rawValue: raw) ?? .executionError
    }
}

/// The phase an error occurred in. Left as a raw String on the `error` frame
/// (below) so unrecognized phases never break decoding.
public enum KernelPhase: String, Codable, Sendable {
    case parse, execute, python, transpile, debug, lint, format
    case qecEstimate = "qec_estimate"
    case qecGenerate = "qec_generate"
    case qecSnapshot = "qec_snapshot"
    case qecMaterialize = "qec_materialize"
    case qecCampaign = "qec_campaign"
    case qecDecodeSample = "qec_decode_sample"
}

/// A decoded `error` frame. `code`/`phase`/`traceback`/`framework`/`dependency`
/// are all conditionally present on the wire (absent, never null-placeholder) —
/// see `kernel/models/errors.py` and `server.py`'s error envelope.
public struct KernelErrorFrame: Codable, Equatable, Sendable {
    public var message: String
    public var code: String?
    public var phase: String?
    public var traceback: String?
    public var framework: String?
    public var dependency: String?

    public init(
        message: String,
        code: String? = nil,
        phase: String? = nil,
        traceback: String? = nil,
        framework: String? = nil,
        dependency: String? = nil
    ) {
        self.message = message
        self.code = code
        self.phase = phase
        self.traceback = traceback
        self.framework = framework
        self.dependency = dependency
    }
}
