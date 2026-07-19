import SwiftUI

/// The app shell. A tab layout that reads naturally on iPhone; on iPad the
/// Studio tab itself splits into circuit + live results side by side (see
/// `StudioView`), so the big screen is used without a separate layout.
struct RootView: View {
    var body: some View {
        TabView {
            StudioView()
                .tabItem { Label("Studio", systemImage: "atom") }

            TemplateGalleryView()
                .tabItem { Label("Explore", systemImage: "square.grid.2x2") }

            DiracChatView()
                .tabItem { Label("Dirac", systemImage: "sparkles") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
