import SwiftUI
import NucleiKit

/// The composer screen. On iPad it splits into circuit + live results; on iPhone
/// the circuit is full-width and results open in a sheet. The whole thing runs on
/// the native simulator, so results update the instant you place a gate.
struct StudioView: View {
    @Environment(CircuitModel.self) private var circuit
    @Environment(SimulationModel.self) private var simulation
    @Environment(SettingsModel.self) private var settings
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var selectedTool: GateKind?
    @State private var pending: PendingPick?
    @State private var paramGate: PlacedGate?
    @State private var explainGate: PlacedGate?
    @State private var showResults = false

    struct PendingPick: Equatable { let qubit: Int; let column: Int }

    var body: some View {
        NavigationStack {
            Group {
                if sizeClass == .regular {
                    HStack(spacing: 0) {
                        composer
                        Divider()
                        ResultsPanel().frame(maxWidth: 380)
                    }
                } else {
                    composer
                }
            }
            .navigationTitle("Nuclei")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            .sheet(isPresented: $showResults) {
                ResultsPanel()
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(item: $paramGate) { GateParamSheet(gate: $0) }
            .sheet(item: $explainGate) { ExplainGateSheet(gate: $0) }
        }
        .onAppear { simulation.preview(circuit.snapshot) }
        .onChange(of: circuit.snapshot) { _, snap in simulation.preview(snap) }
        .onChange(of: selectedTool) { _, _ in pending = nil }
        .gatePlacementFeedback(circuit.gates.count)
        .runCompletionFeedback(simulation.completionToken)
    }

    // MARK: Composer column

    private var composer: some View {
        VStack(spacing: 0) {
            CircuitGridView(
                selectedTool: selectedTool,
                pending: pending.map { (qubit: $0.qubit, column: $0.column) },
                onCellTap: handleTap,
                onExplain: { explainGate = $0 },
                onEditAngle: { paramGate = $0 }
            )
            .frame(maxHeight: .infinity)

            if sizeClass != .regular {
                LiveResultStrip { showResults = true }
                    .padding(.horizontal, 12)
            }

            GatePaletteView(selectedTool: $selectedTool, hint: placementHint)
        }
    }

    // MARK: Placement

    private func handleTap(qubit q: Int, column c: Int) {
        guard let tool = selectedTool else { return }
        if tool.qubitCount == 1 {
            circuit.placeSingle(tool, qubit: q, column: c)
        } else if let p = pending {
            if p.qubit != q { circuit.placeTwoQubit(tool, a: p.qubit, b: q, column: p.column) }
            pending = nil
        } else {
            pending = PendingPick(qubit: q, column: c)
        }
    }

    private var placementHint: String? {
        guard let tool = selectedTool, tool.qubitCount == 2 else { return nil }
        if pending == nil {
            return tool.isControlled ? "Tap the control qubit" : "Tap the first qubit"
        }
        return tool.isControlled ? "Now tap the target qubit" : "Now tap the second qubit"
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarLeading) {
            Menu {
                Button { circuit.setQubitCount(circuit.qubitCount + 1) } label: {
                    Label("Add qubit", systemImage: "plus")
                }
                Button { circuit.setQubitCount(circuit.qubitCount - 1) } label: {
                    Label("Remove qubit", systemImage: "minus")
                }
                Divider()
                Button(role: .destructive) { circuit.clear() } label: {
                    Label("Clear circuit", systemImage: "trash")
                }
            } label: {
                Label("\(circuit.qubitCount) qubits", systemImage: "slider.horizontal.3")
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            ShareLink(item: CircuitExport.qiskit(circuit.snapshot)) {
                Image(systemName: "square.and.arrow.up")
            }
            Button {
                simulation.run(circuit.snapshot, seed: settings.effectiveSeed)
                if sizeClass != .regular { showResults = true }
            } label: {
                Label("Run", systemImage: "play.fill")
            }
            .buttonStyle(.borderedProminent)
            .disabled(circuit.isEmpty)
        }
    }
}

/// A slim always-on results teaser for iPhone: the top outcomes as tiny bars.
/// Tapping expands the full results sheet.
private struct LiveResultStrip: View {
    @Environment(SimulationModel.self) private var simulation
    let onExpand: () -> Void

    var body: some View {
        let top = simulation.sortedProbabilities
            .sorted { $0.value > $1.value }
            .prefix(4)
        Button(action: onExpand) {
            HStack(spacing: 10) {
                if top.isEmpty {
                    Text("Live results").font(.footnote).foregroundStyle(.secondary)
                } else {
                    ForEach(Array(top), id: \.state) { item in
                        VStack(spacing: 2) {
                            Text("|\(item.state)⟩").font(.mono(9)).foregroundStyle(.secondary)
                            Capsule().fill(Palette.teal)
                                .frame(width: 26, height: max(3, item.value * 26))
                        }
                    }
                }
                Spacer()
                Image(systemName: "chevron.up").font(.caption).foregroundStyle(.secondary)
            }
            .frame(height: 44)
            .padding(.horizontal, 12)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}
