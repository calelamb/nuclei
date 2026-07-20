import Foundation
import Speech
import AVFoundation
import Observation

/// On-device speech-to-text for dictating questions to Dirac (and, later,
/// voice-to-circuit: "add a Hadamard on qubit zero"). Voice is one of the most
/// natural mobile inputs for a hands-busy, small-keyboard context.
@Observable
@MainActor
final class SpeechTranscriber {
    var isRecording = false

    private let recognizer = SFSpeechRecognizer()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let engine = AVAudioEngine()

    /// Start if idle, stop if recording. `onUpdate` receives partial transcripts.
    func toggle(onUpdate: @escaping (String) -> Void) async {
        if isRecording { stop() } else { await start(onUpdate: onUpdate) }
    }

    func start(onUpdate: @escaping (String) -> Void) async {
        guard await requestAuthorization(), let recognizer, recognizer.isAvailable else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            request = req

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                req.append(buffer)
            }
            engine.prepare()
            try engine.start()
            isRecording = true

            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                Task { @MainActor in
                    if let result { onUpdate(result.bestTranscription.formattedString) }
                    if error != nil || (result?.isFinal ?? false) { self?.stop() }
                }
            }
        } catch {
            stop()
        }
    }

    func stop() {
        guard isRecording else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        request = nil
        task?.cancel()
        task = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func requestAuthorization() async -> Bool {
        let speechOK = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0 == .authorized) }
        }
        guard speechOK else { return false }
        return await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { cont.resume(returning: $0) }
        }
    }
}
