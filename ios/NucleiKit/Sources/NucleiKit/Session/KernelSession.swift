import Foundation

/// The single seam the whole app is written against — the Swift analogue of
/// `KernelSession` in `src/services/kernelSession.ts` (`send` + `close`), plus
/// an `AsyncStream` of responses in place of the JS callback.
///
/// Two implementations ship in NucleiKit: `RemoteKernelSession` (WebSocket to a
/// hosted/desktop kernel) and `LocalSimulatorSession` (native Swift engine). The
/// app never knows which it's talking to.
public protocol KernelSession: AnyObject, Sendable {
    /// Every response frame from the kernel, in arrival order.
    var events: AsyncStream<KernelResponse> { get }
    /// Send one request. Streamed responses arrive on `events`.
    func send(_ message: KernelMessage) async throws
    /// Tear the session down.
    func close()
}

public extension KernelSession {
    /// Convenience drain: send a request and collect frames until its terminal
    /// response type (see `KernelMessage.terminalResponseType`). Interleaved
    /// `output`/`stderr`/`error` frames are included in the returned array so
    /// callers can surface them. A `parse` returns after `snapshot`; if an
    /// `error` immediately follows it on the wire it may arrive on the next
    /// call's stream — callers that care should read `events` directly.
    func request(_ message: KernelMessage) async throws -> [KernelResponse] {
        guard let terminal = message.terminalResponseType else {
            try await send(message)
            return []
        }
        var collected: [KernelResponse] = []
        // Subscribe BEFORE sending so we can't miss a fast reply.
        var iterator = events.makeAsyncIterator()
        try await send(message)
        while let frame = await iterator.next() {
            collected.append(frame)
            if frame.typeName == terminal { break }
            // A bare protocol error (e.g. "Unknown message type") also terminates.
            if case .error = frame, terminal != "snapshot" { break }
        }
        return collected
    }
}
