import Foundation

/// A tiny fan-out hub so a session can hand every subscriber its own
/// `AsyncStream` while a single receive loop broadcasts frames to all of them.
///
/// `AsyncStream` is single-consumer by construction; this lets the app UI and
/// the `KernelSession.request(_:)` drain helper subscribe independently without
/// stealing frames from each other.
final class ResponseHub: @unchecked Sendable {
    private let lock = NSLock()
    private var continuations: [UUID: AsyncStream<KernelResponse>.Continuation] = [:]
    private var finished = false

    /// A fresh broadcast subscription. Each caller gets every frame emitted
    /// after it subscribes.
    func stream() -> AsyncStream<KernelResponse> {
        AsyncStream { continuation in
            lock.lock()
            if finished {
                lock.unlock()
                continuation.finish()
                return
            }
            let id = UUID()
            continuations[id] = continuation
            lock.unlock()
            continuation.onTermination = { [weak self] _ in
                guard let self else { return }
                self.lock.lock()
                self.continuations[id] = nil
                self.lock.unlock()
            }
        }
    }

    func emit(_ response: KernelResponse) {
        lock.lock()
        let targets = Array(continuations.values)
        lock.unlock()
        for c in targets { c.yield(response) }
    }

    func finish() {
        lock.lock()
        let targets = Array(continuations.values)
        continuations.removeAll()
        finished = true
        lock.unlock()
        for c in targets { c.finish() }
    }
}
