import Foundation
import Observation
import NucleiKit

/// Runs circuits and holds results — the native analogue of `simulationStore`.
///
/// Live preview goes straight through the native `StatevectorSimulator` (instant,
/// no sampling) so the Bloch sphere and histogram update as you build. The Run
/// button additionally samples `shots` measurements. The remote-kernel path
/// (Tier 2) will swap in a `RemoteKernelSession` behind the same call site.
@Observable
final class SimulationModel {
    var result: SimulationResult?
    var shots: Int = 1024
    var isRunning = false
    var errorMessage: String?
    /// Bumps every time a run completes — a trigger for success haptics.
    var completionToken = 0
    /// Which qubit's Bloch vector the sphere is showing.
    var focusedQubit = 0

    /// Instant, sampling-free update for live preview. Safe to call on every edit.
    func preview(_ snapshot: CircuitSnapshot) {
        guard !snapshot.gates.isEmpty || snapshot.qubit_count > 0 else {
            result = nil
            return
        }
        do {
            result = try StatevectorSimulator.run(snapshot, shots: 0)
            errorMessage = nil
        } catch let StatevectorSimulator.SimError.tooManyQubits(requested, cap) {
            result = nil
            errorMessage = "\(requested) qubits exceeds the on-device limit of \(cap). "
                + "Connect a kernel to run larger circuits."
        } catch {
            result = nil
            errorMessage = "Couldn't simulate: \(error)"
        }
    }

    /// A full run with measurement sampling (⌘↵ / Run button).
    func run(_ snapshot: CircuitSnapshot, seed: Int? = nil) {
        isRunning = true
        defer { isRunning = false }
        do {
            result = try StatevectorSimulator.run(snapshot, shots: shots, seed: seed)
            errorMessage = nil
            completionToken &+= 1
        } catch let StatevectorSimulator.SimError.tooManyQubits(requested, cap) {
            errorMessage = "\(requested) qubits exceeds the on-device limit of \(cap)."
        } catch {
            errorMessage = "Simulation failed: \(error)"
        }
    }

    /// Probabilities sorted for a stable, readable histogram.
    var sortedProbabilities: [(state: String, value: Double)] {
        (result?.probabilities ?? [:])
            .sorted { $0.key < $1.key }
            .map { (state: $0.key, value: $0.value) }
    }

    var focusedBloch: BlochCoord? {
        guard let coords = result?.bloch_coords, focusedQubit < coords.count else { return nil }
        return coords[focusedQubit]
    }
}
