import SwiftUI

/// One-tap starter circuits. Loading a template drops you back into the Studio
/// with a runnable circuit — the fastest path from "blank app" to "something
/// quantum happened," which matters most on mobile.
struct TemplateGalleryView: View {
    @Environment(CircuitModel.self) private var circuit
    @Environment(SimulationModel.self) private var simulation

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: 14)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 14) {
                    ForEach(CircuitTemplate.library) { template in
                        Button {
                            circuit.load(template)
                            simulation.preview(circuit.snapshot)
                        } label: {
                            card(template)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .navigationTitle("Explore")
        }
    }

    private func card(_ template: CircuitTemplate) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(template.name).font(.headline)
                Spacer()
                Text("\(template.qubitCount)q").font(.mono(12)).foregroundStyle(Palette.teal)
            }
            Text(template.blurb)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                ForEach(template.gates.prefix(6)) { g in
                    Text(g.kind.symbol)
                        .font(.mono(11, weight: .semibold))
                        .frame(width: 22, height: 22)
                        .background(Palette.gateColor(g.kind.category).opacity(0.2),
                                    in: RoundedRectangle(cornerRadius: 5))
                }
            }
        }
        .padding(14)
        .frame(height: 150, alignment: .topLeading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.teal.opacity(0.15)))
    }
}
