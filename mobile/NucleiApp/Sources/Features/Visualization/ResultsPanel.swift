import SwiftUI
import NucleiKit

/// The live results surface: Bloch sphere (with a per-qubit picker), probability
/// histogram, and a compact stats row. Updates instantly as the circuit changes.
struct ResultsPanel: View {
    @Environment(CircuitModel.self) private var circuit
    @Environment(SimulationModel.self) private var simulation

    var body: some View {
        @Bindable var sim = simulation
        ScrollView {
            VStack(spacing: 16) {
                if let error = simulation.errorMessage {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(Palette.amber)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Palette.amber.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                }

                // Bloch sphere with a qubit selector.
                VStack(spacing: 8) {
                    HStack {
                        Text("Bloch sphere").font(.subheadline.weight(.semibold))
                        Spacer()
                        if circuit.qubitCount > 1 {
                            Picker("Qubit", selection: $sim.focusedQubit) {
                                ForEach(0..<circuit.qubitCount, id: \.self) { q in
                                    Text("q\(q)").tag(q)
                                }
                            }
                            .pickerStyle(.segmented)
                            .frame(maxWidth: 200)
                        }
                    }
                    BlochSphereView(vector: blochTuple)
                        .frame(height: 240)
                        .background(Palette.navy.opacity(0.25), in: RoundedRectangle(cornerRadius: 14))
                    if let b = simulation.focusedBloch {
                        Text(String(format: "⟨X⟩ %.2f   ⟨Y⟩ %.2f   ⟨Z⟩ %.2f   |r| %.2f",
                                    b.x, b.y, b.z, (b.x*b.x + b.y*b.y + b.z*b.z).squareRoot()))
                            .font(.mono(11))
                            .foregroundStyle(.secondary)
                    }
                }

                Divider()

                // Histogram.
                VStack(alignment: .leading, spacing: 8) {
                    Text("Outcome probabilities").font(.subheadline.weight(.semibold))
                    HistogramView(probabilities: simulation.sortedProbabilities)
                        .frame(height: 200)
                }

                statsRow
            }
            .padding(16)
        }
    }

    private var blochTuple: (x: Double, y: Double, z: Double) {
        guard let b = simulation.focusedBloch else { return (0, 0, 1) }
        return (b.x, b.y, b.z)
    }

    private var statsRow: some View {
        HStack(spacing: 18) {
            stat("Qubits", "\(circuit.qubitCount)")
            stat("Depth", "\(circuit.snapshot.depth)")
            stat("Gates", "\(circuit.gates.count)")
            if let ms = simulation.result?.execution_time_ms {
                stat("Time", String(format: "%.1fms", ms))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.mono(15, weight: .semibold)).foregroundStyle(Palette.teal)
            Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
        }
    }
}
