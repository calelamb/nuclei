import Foundation

/// A request sent to the kernel. Mirrors the `KernelMessage` union in
/// `src/types/quantum.ts`. Encodes to `{ "type": ..., <fields> }`.
///
/// This covers the execution + hardware surface the iOS app needs for tiers 1–2.
/// The QEC / transpile / debug / lint / format messages are additive and can be
/// added the same way when their panels land (tier 3+).
public enum KernelMessage: Encodable, Sendable {
    // ── Execution ───────────────────────────────────────────────
    case parse(code: String, language: KernelLanguage? = nil)
    case execute(
        code: String,
        shots: Int,
        language: KernelLanguage? = nil,
        params: [String: Double]? = nil,   // v1.1
        seed: Int? = nil                    // v1.1
    )
    case runPython(code: String)
    case environment

    // ── Hardware ────────────────────────────────────────────────
    case hardwareConnect(provider: String, credentials: [String: String])
    case hardwareSetCredentials(provider: String, credentials: [String: String])
    case hardwareClearCredentials(provider: String)
    case hardwareConnectedProviders
    case hardwareListJobs
    case hardwareListBackends(provider: String)
    case hardwareSubmit(provider: String, backend: String, code: String, shots: Int, language: KernelLanguage? = nil)
    case hardwareStatus(jobId: String)
    case hardwareResults(jobId: String)
    case hardwareCancel(jobId: String)
    case hardwareDismiss(jobId: String)

    private enum K: String, CodingKey {
        case type, code, language, shots, params, seed
        case provider, credentials, backend
        case job_id
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        switch self {
        case let .parse(code, language):
            try c.encode("parse", forKey: .type)
            try c.encode(code, forKey: .code)
            try c.encodeIfPresent(language, forKey: .language)

        case let .execute(code, shots, language, params, seed):
            try c.encode("execute", forKey: .type)
            try c.encode(code, forKey: .code)
            try c.encode(shots, forKey: .shots)
            try c.encodeIfPresent(language, forKey: .language)
            try c.encodeIfPresent(params, forKey: .params)
            try c.encodeIfPresent(seed, forKey: .seed)

        case let .runPython(code):
            try c.encode("run_python", forKey: .type)
            try c.encode(code, forKey: .code)

        case .environment:
            try c.encode("environment", forKey: .type)

        case let .hardwareConnect(provider, credentials):
            try c.encode("hardware_connect", forKey: .type)
            try c.encode(provider, forKey: .provider)
            try c.encode(credentials, forKey: .credentials)

        case let .hardwareSetCredentials(provider, credentials):
            try c.encode("hardware_set_credentials", forKey: .type)
            try c.encode(provider, forKey: .provider)
            try c.encode(credentials, forKey: .credentials)

        case let .hardwareClearCredentials(provider):
            try c.encode("hardware_clear_credentials", forKey: .type)
            try c.encode(provider, forKey: .provider)

        case .hardwareConnectedProviders:
            try c.encode("hardware_connected_providers", forKey: .type)

        case .hardwareListJobs:
            try c.encode("hardware_list_jobs", forKey: .type)

        case let .hardwareListBackends(provider):
            try c.encode("hardware_list_backends", forKey: .type)
            try c.encode(provider, forKey: .provider)

        case let .hardwareSubmit(provider, backend, code, shots, language):
            try c.encode("hardware_submit", forKey: .type)
            try c.encode(provider, forKey: .provider)
            try c.encode(backend, forKey: .backend)
            try c.encode(code, forKey: .code)
            try c.encode(shots, forKey: .shots)
            try c.encodeIfPresent(language, forKey: .language)

        case let .hardwareStatus(jobId):
            try c.encode("hardware_status", forKey: .type)
            try c.encode(jobId, forKey: .job_id)

        case let .hardwareResults(jobId):
            try c.encode("hardware_results", forKey: .type)
            try c.encode(jobId, forKey: .job_id)

        case let .hardwareCancel(jobId):
            try c.encode("hardware_cancel", forKey: .type)
            try c.encode(jobId, forKey: .job_id)

        case let .hardwareDismiss(jobId):
            try c.encode("hardware_dismiss", forKey: .type)
            try c.encode(jobId, forKey: .job_id)
        }
    }

    /// The response `type` that terminates this request's streamed sequence.
    /// A robust client loops until it sees this (see `overview.mdx` §streaming).
    /// `nil` for fire-and-forget-shaped requests handled generically.
    public var terminalResponseType: String? {
        switch self {
        case .parse: return "snapshot"          // a failed parse appends one `error` after it
        case .execute: return "result"
        case .runPython: return "python_result"
        case .environment: return "environment"
        case .hardwareConnect, .hardwareSetCredentials, .hardwareClearCredentials:
            return "hardware_connected"
        case .hardwareConnectedProviders: return "hardware_connected_providers"
        case .hardwareListJobs: return "hardware_jobs"
        case .hardwareListBackends: return "hardware_backends"
        case .hardwareSubmit: return "hardware_job_submitted"
        case .hardwareStatus: return "hardware_job_update"
        case .hardwareResults: return "hardware_result"
        case .hardwareCancel: return "hardware_job_cancelled"
        case .hardwareDismiss: return "hardware_job_dismissed"
        }
    }
}
