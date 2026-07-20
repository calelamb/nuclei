import SwiftUI

@main
struct NucleiApp: App {
    @State private var circuit = CircuitModel()
    @State private var simulation = SimulationModel()
    @State private var workspace = WorkspaceModel()
    @State private var settings = SettingsModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(circuit)
                .environment(simulation)
                .environment(workspace)
                .environment(settings)
                .tint(Palette.teal)
        }
    }
}
