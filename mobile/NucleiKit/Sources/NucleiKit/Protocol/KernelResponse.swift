import Foundation

/// A free-form provider result dict from `hardware_result`. The kernel returns
/// whatever the provider gives (simulator → a full SimulationResult; IBM →
/// `{measurements, status}`; failures → `{error}`). We keep the structured
/// fields we know and treat `error` as the failure signal.
public struct HardwareResultData: Codable, Equatable, Sendable {
    public var measurements: [String: Int]?
    public var error: String?
    public var status: String?
}

/// A response frame from the kernel. Mirrors the `KernelResponse` union in
/// `src/types/quantum.ts`, decoded on the `type` discriminator.
///
/// Per the additive-protocol rule, an unrecognized `type` decodes to
/// `.unknown(type:)` rather than throwing — the client ignores it.
public enum KernelResponse: Decodable, Sendable {
    // ── Execution ───────────────────────────────────────────────
    case snapshot(CircuitSnapshot?)
    case result(SimulationResult?)
    case pythonResult(success: Bool)
    case output(text: String)
    case stderr(text: String)
    case error(KernelErrorFrame)
    case environment(KernelEnvironment)

    // ── Hardware ────────────────────────────────────────────────
    case hardwareConnected(provider: String, success: Bool)
    case hardwareConnectedProviders(providers: [String])
    case hardwareJobs(jobs: [HardwareJob])
    case hardwareBackends(backends: [[String: AnyCodable]])
    case hardwareJobSubmitted(job: HardwareJob)
    case hardwareJobUpdate(job: HardwareJob)
    case hardwareResult(jobId: String, data: HardwareResultData)
    case hardwareJobCancelled(jobId: String, success: Bool)
    case hardwareJobDismissed(jobId: String, success: Bool)

    /// Any response type NucleiKit doesn't model yet (QEC, transpile, debug,
    /// lint, format, and anything additive the kernel gains later).
    case unknown(type: String)

    /// The raw `type` string, handy for the terminal-message drain loop.
    public var typeName: String {
        switch self {
        case .snapshot: return "snapshot"
        case .result: return "result"
        case .pythonResult: return "python_result"
        case .output: return "output"
        case .stderr: return "stderr"
        case .error: return "error"
        case .environment: return "environment"
        case .hardwareConnected: return "hardware_connected"
        case .hardwareConnectedProviders: return "hardware_connected_providers"
        case .hardwareJobs: return "hardware_jobs"
        case .hardwareBackends: return "hardware_backends"
        case .hardwareJobSubmitted: return "hardware_job_submitted"
        case .hardwareJobUpdate: return "hardware_job_update"
        case .hardwareResult: return "hardware_result"
        case .hardwareJobCancelled: return "hardware_job_cancelled"
        case .hardwareJobDismissed: return "hardware_job_dismissed"
        case let .unknown(t): return t
        }
    }

    private enum K: String, CodingKey {
        case type, data, message, text, success, provider, providers
        case jobs, backends, job, job_id
        // KernelEnvironment is spread onto the frame (not nested under `data`):
        case python, platform, packages
        // KernelErrorFrame fields are spread onto the frame too:
        case code, phase, traceback, framework, dependency
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "snapshot":
            self = .snapshot(try c.decodeIfPresent(CircuitSnapshot.self, forKey: .data))
        case "result":
            self = .result(try c.decodeIfPresent(SimulationResult.self, forKey: .data))
        case "python_result":
            self = .pythonResult(success: try c.decodeIfPresent(Bool.self, forKey: .success) ?? false)
        case "output":
            self = .output(text: try c.decodeIfPresent(String.self, forKey: .text) ?? "")
        case "stderr":
            self = .stderr(text: try c.decodeIfPresent(String.self, forKey: .text) ?? "")
        case "error":
            // Error fields are spread directly onto the frame.
            self = .error(KernelErrorFrame(
                message: try c.decodeIfPresent(String.self, forKey: .message) ?? "",
                code: try c.decodeIfPresent(String.self, forKey: .code),
                phase: try c.decodeIfPresent(String.self, forKey: .phase),
                traceback: try c.decodeIfPresent(String.self, forKey: .traceback),
                framework: try c.decodeIfPresent(String.self, forKey: .framework),
                dependency: try c.decodeIfPresent(String.self, forKey: .dependency)
            ))
        case "environment":
            self = .environment(KernelEnvironment(
                python: try c.decodeIfPresent(String.self, forKey: .python) ?? "",
                platform: try c.decodeIfPresent(String.self, forKey: .platform) ?? "",
                packages: try c.decodeIfPresent([String: String].self, forKey: .packages) ?? [:]
            ))
        case "hardware_connected":
            self = .hardwareConnected(
                provider: try c.decodeIfPresent(String.self, forKey: .provider) ?? "",
                success: try c.decodeIfPresent(Bool.self, forKey: .success) ?? false)
        case "hardware_connected_providers":
            self = .hardwareConnectedProviders(
                providers: try c.decodeIfPresent([String].self, forKey: .providers) ?? [])
        case "hardware_jobs":
            self = .hardwareJobs(jobs: try c.decodeIfPresent([HardwareJob].self, forKey: .jobs) ?? [])
        case "hardware_backends":
            self = .hardwareBackends(
                backends: try c.decodeIfPresent([[String: AnyCodable]].self, forKey: .backends) ?? [])
        case "hardware_job_submitted":
            self = .hardwareJobSubmitted(job: try c.decode(HardwareJob.self, forKey: .job))
        case "hardware_job_update":
            self = .hardwareJobUpdate(job: try c.decode(HardwareJob.self, forKey: .job))
        case "hardware_result":
            self = .hardwareResult(
                jobId: try c.decodeIfPresent(String.self, forKey: .job_id) ?? "",
                data: try c.decodeIfPresent(HardwareResultData.self, forKey: .data) ?? HardwareResultData())
        case "hardware_job_cancelled":
            self = .hardwareJobCancelled(
                jobId: try c.decodeIfPresent(String.self, forKey: .job_id) ?? "",
                success: try c.decodeIfPresent(Bool.self, forKey: .success) ?? false)
        case "hardware_job_dismissed":
            self = .hardwareJobDismissed(
                jobId: try c.decodeIfPresent(String.self, forKey: .job_id) ?? "",
                success: try c.decodeIfPresent(Bool.self, forKey: .success) ?? false)
        default:
            self = .unknown(type: type)
        }
    }
}

/// A minimal type-erased Codable for the loosely-typed `hardware_backends`
/// entries (`Array<Record<string, unknown>>` on the wire). Decodes JSON scalars,
/// arrays, and objects without committing to a schema the providers don't share.
public struct AnyCodable: Codable, Equatable, Sendable {
    public let value: any Sendable

    public init(_ value: any Sendable) { self.value = value }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = Optional<Int>.none as any Sendable }
        else if let b = try? c.decode(Bool.self) { value = b }
        else if let i = try? c.decode(Int.self) { value = i }
        else if let d = try? c.decode(Double.self) { value = d }
        else if let s = try? c.decode(String.self) { value = s }
        else if let a = try? c.decode([AnyCodable].self) { value = a }
        else if let o = try? c.decode([String: AnyCodable].self) { value = o }
        else { value = Optional<Int>.none as any Sendable }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let b as Bool: try c.encode(b)
        case let i as Int: try c.encode(i)
        case let d as Double: try c.encode(d)
        case let s as String: try c.encode(s)
        case let a as [AnyCodable]: try c.encode(a)
        case let o as [String: AnyCodable]: try c.encode(o)
        default: try c.encodeNil()
        }
    }

    public static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        String(describing: lhs.value) == String(describing: rhs.value)
    }
}
