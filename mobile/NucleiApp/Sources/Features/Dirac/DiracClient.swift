import Foundation

/// Direct BYOK client for the Anthropic Messages API — the native analogue of
/// `claudeClient.ts`. No Nuclei server in the loop; the key (from the Keychain)
/// goes only to `api.anthropic.com`. On native there's no CORS, so the
/// `dangerous-direct-browser-access` header the web app needs is unnecessary.
struct DiracClient {
    let apiKey: String

    // Authoritative model IDs (mirror src/config/dirac.ts).
    static let haiku = "claude-haiku-4-5-20251001"
    static let sonnet = "claude-sonnet-4-6"

    enum DiracError: LocalizedError {
        case noKey, http(Int), badResponse, network(String)
        var errorDescription: String? {
            switch self {
            case .noKey: return "Add your Anthropic API key in Settings to chat with Dirac."
            case .http(let code): return "Anthropic returned HTTP \(code)."
            case .badResponse: return "Couldn't read Dirac's reply."
            case .network(let m): return m
            }
        }
    }

    func complete(system: String, user: String,
                  model: String = DiracClient.haiku, maxTokens: Int = 1024) async throws -> String {
        guard !apiKey.trimmingCharacters(in: .whitespaces).isEmpty else { throw DiracError.noKey }

        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

        let body: [String: Any] = [
            "model": model,
            "max_tokens": maxTokens,
            "system": system,
            "messages": [["role": "user", "content": user]],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw DiracError.badResponse }
            guard (200..<300).contains(http.statusCode) else { throw DiracError.http(http.statusCode) }
            let decoded = try JSONDecoder().decode(MessagesResponse.self, from: data)
            let text = decoded.content.compactMap { $0.text }.joined()
            guard !text.isEmpty else { throw DiracError.badResponse }
            return text
        } catch let e as DiracError {
            throw e
        } catch {
            throw DiracError.network(error.localizedDescription)
        }
    }

    private struct MessagesResponse: Decodable {
        struct Block: Decodable { let type: String; let text: String? }
        let content: [Block]
    }
}

/// Dirac's persona preambles, ported from `diracPersona.ts`. Learn is the tutor;
/// Research is the terse collaborator.
enum DiracPersona {
    static let learn = """
    You are Dirac, an AI teaching assistant for quantum computing, named after physicist Paul Dirac. \
    You live inside Nuclei, a quantum computing app. Be patient, encouraging, and never condescending. \
    Explain concepts in plain English first, then math if needed. Keep responses concise but thorough. \
    Do not use emojis. Inline code and braket notation (|0⟩, |ψ⟩) are welcome. Answer directly.
    """

    static let research = """
    You are Dirac, a research collaborator embedded in Nuclei. Assume graduate-level familiarity with \
    quantum computing; don't re-derive basics. Be terse, lead with substance, state uncertainty precisely, \
    and prefer concrete quantities. Do not use emojis.
    """
}
