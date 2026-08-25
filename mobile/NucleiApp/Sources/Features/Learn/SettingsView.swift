import SwiftUI
import NucleiKit

/// Settings — API key (Keychain), reproducibility, workspace mode, and an honest
/// note about what runs on device vs. what needs a kernel.
struct SettingsView: View {
    @Environment(SettingsModel.self) private var settings
    @Environment(WorkspaceModel.self) private var workspace
    @Environment(SimulationModel.self) private var simulation

    var body: some View {
        @Bindable var settings = settings
        @Bindable var workspace = workspace
        @Bindable var simulation = simulation

        NavigationStack {
            Form {
                Section("Dirac AI") {
                    SecureField("Anthropic API key (sk-ant-…)", text: $settings.apiKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.mono(13))
                    HStack {
                        Image(systemName: settings.hasValidKey ? "checkmark.seal.fill" : "key")
                            .foregroundStyle(settings.hasValidKey ? Palette.good : .secondary)
                        Text(settings.hasValidKey ? "Key stored in the iOS Keychain."
                                                  : "Bring your own key. It never leaves your device except to Anthropic.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Link("Get a key at console.anthropic.com",
                         destination: URL(string: "https://console.anthropic.com")!)
                        .font(.footnote)
                }

                Section("Simulation") {
                    Stepper("Shots: \(simulation.shots)",
                            value: $simulation.shots, in: 128...8192, step: 128)
                    Toggle("Reproducible (fixed seed)", isOn: $settings.useFixedSeed)
                    if settings.useFixedSeed {
                        Stepper("Seed: \(settings.seed)", value: $settings.seed, in: 0...9999)
                    }
                    LabeledContent("On-device limit", value: "\(StatevectorSimulator.defaultQubitCap) qubits")
                }

                Section("Workspace") {
                    Picker("Mode", selection: $workspace.mode) {
                        Text("Learn").tag(WorkspaceModel.Mode.learn)
                        Text("Research").tag(WorkspaceModel.Mode.research)
                    }
                    .pickerStyle(.segmented)
                    Text(workspace.mode == .learn
                         ? "Dirac is a patient tutor; guidance is beginner-friendly."
                         : "Dirac is a terse collaborator; assumes graduate-level background.")
                        .font(.footnote).foregroundStyle(.secondary)
                }

                Section("What runs here") {
                    row("On-device now", "Circuit composer, statevector simulation, Bloch sphere, histograms, Dirac chat.", Palette.good)
                    row("Needs a kernel", "Qiskit / Cirq / CUDA-Q / Q# execution, real hardware, experiments, QEC. Coming in a later release.", .secondary)
                }

                Section {
                    LabeledContent("Nuclei", value: "iOS 0.1.0")
                    Link("Nuclei on GitHub", destination: URL(string: "https://github.com/calelamb/nuclei")!)
                }
            }
            .navigationTitle("Settings")
        }
    }

    private func row(_ title: String, _ detail: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(title, systemImage: "circle.fill").font(.subheadline.weight(.semibold))
                .foregroundStyle(color)
                .labelStyle(DotLabelStyle(color: color))
            Text(detail).font(.footnote).foregroundStyle(.secondary)
        }
    }
}

private struct DotLabelStyle: LabelStyle {
    let color: Color
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            configuration.title
        }
    }
}
