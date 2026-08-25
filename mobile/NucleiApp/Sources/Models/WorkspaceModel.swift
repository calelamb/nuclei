import Foundation
import Observation

/// Learn / Research workspace mode — a port of `workspaceStore`. On mobile,
/// Learn is the default and the app leads with it (widest audience). Research
/// surfaces the extra tools once a kernel is connected (Tier 2+).
@Observable
final class WorkspaceModel {
    enum Mode: String { case learn, research }

    var mode: Mode {
        didSet { UserDefaults.standard.set(mode.rawValue, forKey: "workspace_mode") }
    }

    init() {
        let raw = UserDefaults.standard.string(forKey: "workspace_mode") ?? "learn"
        mode = Mode(rawValue: raw) ?? .learn
    }
}
