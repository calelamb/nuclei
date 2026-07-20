import SwiftUI

/// The "Explain with Dirac" popover from a gate's long-press menu. Context-aware:
/// it tells Dirac which gate, on which qubit, in what circuit — so the answer is
/// about *your* circuit, not a textbook.
struct ExplainGateSheet: View {
    @Environment(CircuitModel.self) private var circuit
    @Environment(SettingsModel.self) private var settings
    @Environment(WorkspaceModel.self) private var workspace
    @Environment(\.dismiss) private var dismiss

    let gate: PlacedGate
    @State private var explanation: String?
    @State private var error: String?
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 12) {
                        GateGlyph(kind: gate.kind, size: 48)
                        VStack(alignment: .leading) {
                            Text(gate.kind.displayName).font(.title3.weight(.semibold))
                            Text("on q\(gate.targets.first ?? 0)").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }

                    if isLoading {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Dirac is thinking…").foregroundStyle(.secondary)
                        }
                    } else if let explanation {
                        Text(explanation).font(.body)
                    } else if let error {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Palette.amber)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            .navigationTitle("Gate explainer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .task { await explain() }
    }

    private func explain() async {
        let client = DiracClient(apiKey: settings.apiKey)
        let persona = workspace.mode == .research ? DiracPersona.research : DiracPersona.learn
        let user = """
        Explain the \(gate.kind.displayName) gate as used here, in 3-4 sentences. \
        Current circuit: \(CircuitExport.summary(circuit.snapshot)). \
        Focus on what it does to qubit \(gate.targets.first ?? 0) and why someone would use it.
        """
        do {
            explanation = try await client.complete(system: persona, user: user, maxTokens: 400)
        } catch {
            self.error = (error as? DiracClient.DiracError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }
}
