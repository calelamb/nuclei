import SwiftUI

/// A focused sheet for tuning a rotation gate's angle — a dial-like slider in
/// units of π, with live snapping to common angles. Editing an angle updates the
/// circuit immediately, so the Bloch sphere spins as you drag.
struct GateParamSheet: View {
    @Environment(CircuitModel.self) private var circuit
    @Environment(\.dismiss) private var dismiss

    let gate: PlacedGate
    @State private var fraction: Double   // angle / π, range 0…2

    init(gate: PlacedGate) {
        self.gate = gate
        _fraction = State(initialValue: (gate.params.first ?? 0) / .pi)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 28) {
                Text("\(gate.kind.displayName) on q\(gate.targets.first ?? 0)")
                    .font(.headline)

                Text(String(format: "%.2f π", fraction))
                    .font(.mono(40, weight: .semibold))
                    .foregroundStyle(Palette.amber)
                    .contentTransition(.numericText())

                Slider(value: $fraction, in: 0...2, step: 0.01) {
                    Text("Angle")
                } minimumValueLabel: {
                    Text("0").font(.mono(12))
                } maximumValueLabel: {
                    Text("2π").font(.mono(12))
                }
                .tint(Palette.amber)
                .onChange(of: fraction) { _, new in
                    circuit.setParam(gate, radians: new * .pi)
                }

                HStack(spacing: 10) {
                    ForEach([("π/4", 0.25), ("π/2", 0.5), ("π", 1.0), ("3π/2", 1.5)], id: \.0) { label, value in
                        Button(label) { withAnimation(.snappy) { fraction = value } }
                            .font(.mono(13))
                            .buttonStyle(.bordered)
                    }
                }

                Spacer()
            }
            .padding(24)
            .navigationTitle("Angle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.height(340)])
    }
}
