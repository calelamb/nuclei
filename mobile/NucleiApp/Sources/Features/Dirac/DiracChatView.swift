import SwiftUI

/// The Dirac chat tab. Every message carries the current circuit as context, so
/// Dirac always answers about what you're building. Includes voice dictation — a
/// natural fit on mobile ("what does this Bell circuit do?").
struct DiracChatView: View {
    @Environment(CircuitModel.self) private var circuit
    @Environment(SettingsModel.self) private var settings
    @Environment(WorkspaceModel.self) private var workspace

    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var isSending = false
    @State private var speech = SpeechTranscriber()

    struct ChatMessage: Identifiable, Equatable {
        enum Role { case user, dirac }
        let id = UUID()
        let role: Role
        var text: String
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if messages.isEmpty { emptyState } else { transcript }
                composer
            }
            .navigationTitle("Dirac")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "sparkles").font(.system(size: 40)).foregroundStyle(Palette.purpleBright)
            Text("Ask Dirac about your circuit").font(.headline)
            Text("It can see what you're building in the Studio tab.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if !settings.hasValidKey {
                Text("Add your Anthropic key in Settings to begin.")
                    .font(.footnote).foregroundStyle(Palette.amber).padding(.top, 4)
            }
        }
        .padding(40)
        .frame(maxHeight: .infinity)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(messages) { message in
                        bubble(message).id(message.id)
                    }
                    if isSending {
                        HStack { ProgressView(); Text("Dirac…").foregroundStyle(.secondary) }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14)
                    }
                }
                .padding(14)
            }
            .onChange(of: messages) { _, _ in
                if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
        }
    }

    private func bubble(_ message: ChatMessage) -> some View {
        HStack {
            if message.role == .user { Spacer(minLength: 40) }
            Text(message.text)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(
                    message.role == .user ? AnyShapeStyle(Palette.teal.opacity(0.18))
                                          : AnyShapeStyle(.thinMaterial),
                    in: RoundedRectangle(cornerRadius: 16))
                .frame(maxWidth: .infinity,
                       alignment: message.role == .user ? .trailing : .leading)
            if message.role == .dirac { Spacer(minLength: 40) }
        }
    }

    private var composer: some View {
        HStack(spacing: 10) {
            Button {
                Task { await speech.toggle { transcript in input = transcript } }
            } label: {
                Image(systemName: speech.isRecording ? "mic.fill" : "mic")
                    .foregroundStyle(speech.isRecording ? Palette.purpleBright : .secondary)
                    .font(.title3)
            }

            TextField("Ask Dirac…", text: $input, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...4)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.thinMaterial, in: Capsule())

            Button {
                Task { await send() }
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.title)
            }
            .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
        }
        .padding(12)
        .background(.bar)
    }

    private func send() async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        speech.stop()
        messages.append(ChatMessage(role: .user, text: text))
        input = ""
        isSending = true
        defer { isSending = false }

        let persona = workspace.mode == .research ? DiracPersona.research : DiracPersona.learn
        let system = persona + "\n\nThe user's current circuit: " + CircuitExport.summary(circuit.snapshot)
        // Simple routing (port of diracRouting): longer/analytical → Sonnet.
        let model = (text.count > 100 || text.localizedCaseInsensitiveContains("why")
                     || text.localizedCaseInsensitiveContains("explain"))
            ? DiracClient.sonnet : DiracClient.haiku
        do {
            let reply = try await DiracClient(apiKey: settings.apiKey)
                .complete(system: system, user: text, model: model, maxTokens: 1024)
            messages.append(ChatMessage(role: .dirac, text: reply))
        } catch {
            let msg = (error as? DiracClient.DiracError)?.errorDescription ?? error.localizedDescription
            messages.append(ChatMessage(role: .dirac, text: msg))
        }
    }
}
