import Foundation
import Observation

/// User preferences + secrets — the native analogue of `settingsStore` +
/// `diracStore`'s key handling. The Anthropic key lives in the Keychain; simple
/// flags live in UserDefaults.
@Observable
final class SettingsModel {
    private static let apiKeyKey = "anthropic_api_key"

    var apiKey: String {
        didSet { persistKey() }
    }

    /// Reproducible sampling — when on, runs use a fixed seed so results repeat.
    var useFixedSeed: Bool {
        didSet { UserDefaults.standard.set(useFixedSeed, forKey: "use_fixed_seed") }
    }
    var seed: Int {
        didSet { UserDefaults.standard.set(seed, forKey: "seed") }
    }

    var hasValidKey: Bool { apiKey.hasPrefix("sk-ant-") }

    init() {
        apiKey = Keychain.get(Self.apiKeyKey) ?? ""
        useFixedSeed = UserDefaults.standard.bool(forKey: "use_fixed_seed")
        seed = UserDefaults.standard.object(forKey: "seed") as? Int ?? 42
    }

    private func persistKey() {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { Keychain.delete(Self.apiKeyKey) }
        else { Keychain.set(trimmed, for: Self.apiKeyKey) }
    }

    /// The seed to pass to a run, or nil when reproducible mode is off.
    var effectiveSeed: Int? { useFixedSeed ? seed : nil }
}
