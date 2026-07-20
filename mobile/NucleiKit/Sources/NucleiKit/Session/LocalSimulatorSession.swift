import Foundation

/// A `KernelSession` that answers `parse`/`execute` from the native Swift
/// `StatevectorSimulator` — no Python, no network. This is the third session
/// implementation PRD 13 calls for, alongside the WebSocket remote.
///
/// ## Contract
/// The local engine has no Python/Q# parser, so it executes **circuits, not
/// source**. On the local path the touch/Pencil composer is the editor: it pushes
/// the current `CircuitSnapshot` via `setCircuit(_:)`, and `parse`/`execute`
/// operate on that held circuit (the `code` string on those messages is ignored).
/// Everything the local engine can't do — hardware, transpile, QEC, Q#/CUDA-Q
/// execution — returns an honest "connect a kernel" error rather than pretending.
public final class LocalSimulatorSession: KernelSession, @unchecked Sendable {
    private let hub = ResponseHub()
    private let lock = NSLock()
    private var currentSnapshot: CircuitSnapshot?
    private let qubitCap: Int

    public var events: AsyncStream<KernelResponse> { hub.stream() }

    public init(qubitCap: Int = StatevectorSimulator.defaultQubitCap) {
        self.qubitCap = qubitCap
    }

    /// The composer pushes the live circuit here. Pass `nil` to clear.
    public func setCircuit(_ snapshot: CircuitSnapshot?) {
        lock.lock(); currentSnapshot = snapshot; lock.unlock()
    }

    /// Direct access for callers that already hold a snapshot (e.g. the debugger)
    /// and don't want to round-trip through the message interface.
    public func trace() throws -> DebugTrace? {
        lock.lock(); let snap = currentSnapshot; lock.unlock()
        guard let snap else { return nil }
        return try StatevectorSimulator.trace(snap, qubitCap: qubitCap)
    }

    public func send(_ message: KernelMessage) async throws {
        switch message {
        case .parse:
            lock.lock(); let snap = currentSnapshot; lock.unlock()
            hub.emit(.snapshot(snap))

        case let .execute(_, shots, _, _, seed):
            lock.lock(); let snap = currentSnapshot; lock.unlock()
            guard let snap else {
                hub.emit(.snapshot(nil))
                hub.emit(.result(nil))
                return
            }
            hub.emit(.snapshot(snap))
            do {
                let result = try StatevectorSimulator.run(
                    snap, shots: shots, seed: seed, qubitCap: qubitCap)
                hub.emit(.result(result))
            } catch let StatevectorSimulator.SimError.tooManyQubits(requested, cap) {
                hub.emit(.error(KernelErrorFrame(
                    message: "This circuit uses \(requested) qubits; the on-device "
                        + "simulator handles up to \(cap). Connect a kernel to run it.",
                    code: "execution_error", phase: "execute")))
                hub.emit(.result(nil))
            } catch {
                hub.emit(.error(KernelErrorFrame(
                    message: "Local simulation failed: \(error)",
                    code: "simulation_error", phase: "execute")))
                hub.emit(.result(nil))
            }

        case .environment:
            hub.emit(.environment(KernelEnvironment(
                python: "n/a (native Swift engine)",
                platform: "NucleiKit.StatevectorSimulator",
                packages: [:])))

        case .runPython:
            hub.emit(.error(KernelErrorFrame(
                message: "Running Python requires a kernel. Use the circuit composer "
                    + "for on-device simulation, or connect a kernel.",
                code: "unsupported_framework", phase: "python")))
            hub.emit(.pythonResult(success: false))

        default:
            // Hardware, transpile, QEC, lint/format, etc. — not available locally.
            hub.emit(.error(KernelErrorFrame(
                message: "That action needs a running kernel. Connect one in Settings "
                    + "to submit hardware jobs, run other frameworks, or use research tools.",
                code: "unsupported_framework")))
        }
    }

    public func close() { hub.finish() }
}
