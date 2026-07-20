import Foundation

/// A `KernelSession` backed by a WebSocket to a hosted (or LAN/desktop) kernel —
/// the Swift analogue of the WebSocket branch in `src/services/kernelSession.ts`.
///
/// Speaks the exact wire protocol from `src/types/quantum.ts`: JSON text frames,
/// one object per frame, terminal-message streaming. Enforces the client rules
/// from `overview.mdx`: ignore unknown response types (handled by
/// `KernelResponse.unknown`), tolerate absent fields, loop until terminal.
///
/// The kernel has **no auth of its own** (`Auth | None`), so a non-localhost URL
/// MUST point at the authenticated gateway described in PRD 13 §9 — never at a
/// raw kernel exposed to the network.
public final class RemoteKernelSession: KernelSession, @unchecked Sendable {
    private let hub = ResponseHub()
    private let task: URLSessionWebSocketTask
    private var receiveLoop: Task<Void, Never>?

    public var events: AsyncStream<KernelResponse> { hub.stream() }

    /// - Parameters:
    ///   - url: `wss://…` for the gateway, or `ws://localhost:9742` for a local kernel.
    ///   - authToken: bearer token for the gateway (omit for a trusted local kernel).
    ///   - session: injectable for tests.
    public init(url: URL, authToken: String? = nil, session: URLSession = .shared) {
        var request = URLRequest(url: url)
        if let authToken {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        // The kernel caps inbound frames at 1 MiB; match it so we fail fast
        // rather than having the connection dropped mid-stream.
        self.task = session.webSocketTask(with: request)
        self.task.maximumMessageSize = 1_048_576
        self.task.resume()
        startReceiving()
    }

    private func startReceiving() {
        receiveLoop = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do {
                    let message = try await self.task.receive()
                    switch message {
                    case let .string(text):
                        self.decodeAndEmit(text)
                    case let .data(data):
                        if let text = String(data: data, encoding: .utf8) {
                            self.decodeAndEmit(text)
                        }
                    @unknown default:
                        break
                    }
                } catch {
                    // Socket closed or errored — surface as an error frame and stop.
                    self.hub.emit(.error(KernelErrorFrame(
                        message: "Kernel connection closed: \(error.localizedDescription)",
                        code: "execution_error")))
                    self.hub.finish()
                    return
                }
            }
        }
    }

    private func decodeAndEmit(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        do {
            let response = try JSONDecoder().decode(KernelResponse.self, from: data)
            hub.emit(response)
        } catch {
            // A frame we can't decode is not fatal — the protocol's additive rule
            // says ignore unknowns. Emit an unknown so drains still make progress.
            hub.emit(.unknown(type: "undecodable"))
        }
    }

    public func send(_ message: KernelMessage) async throws {
        let data = try JSONEncoder().encode(message)
        guard let text = String(data: data, encoding: .utf8) else {
            throw KernelSessionError.encodingFailed
        }
        try await task.send(.string(text))
    }

    public func close() {
        receiveLoop?.cancel()
        task.cancel(with: .goingAway, reason: nil)
        hub.finish()
    }
}

public enum KernelSessionError: Error, Sendable {
    case encodingFailed
    case notSupportedLocally(String)
}
