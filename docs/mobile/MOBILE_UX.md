# Nuclei for iOS — mobile-first features

Desktop Nuclei assumes a keyboard, a mouse, and a big screen. A phone/iPad has
none of those but brings *touch, Pencil, voice, sensors, haptics, location-in-your-
pocket, and always-on notifications*. This is the running list of features that use
those to make quantum computing genuinely **easier** on mobile — what's built in the
Phase 1 drop, and what's queued.

## Built in this drop

| Feature | Why it helps on mobile | Where |
|---|---|---|
| **Tap-to-place composer** | Building a circuit by *arming a gate and tapping a wire* beats typing `qc.h(0)` on a glass keyboard — and beats fiddly drag-onto-a-thin-line. | `Features/Composer/` |
| **Instant live results** | The native Swift simulator runs on every edit, so the Bloch sphere and histogram move *as you build* — no run button needed to learn. | `SimulationModel.preview` |
| **One-tap templates** | The "blank canvas" tax is brutal on a phone. Bell / GHZ / superposition load a runnable circuit in a tap. | `Features/Templates/` |
| **Long-press → Explain with Dirac** | Point at a gate *in your circuit* and get a context-aware explanation — the phone-native version of "hover for a tooltip." | `ExplainGateSheet` |
| **Drag-to-rotate Bloch sphere (Metal/SceneKit)** | A 3D state you spin with a finger is more legible than a static diagram, and runs at ProMotion 120 fps. | `BlochSphereView` |
| **Haptics** | A tick when a gate lands, a success buzz when a run finishes — physical feedback makes a touch editor feel real. | `Support/Haptics` |
| **Angle dial** | Rotation gates get a π-unit slider with snap-to-common-angles; the Bloch vector spins live as you drag. | `GateParamSheet` |
| **Voice to Dirac** | Dictation ("what does this Bell circuit do?") is a natural input when typing is the bottleneck. | `SpeechTranscriber` |
| **Context-aware Dirac** | Every message carries the current circuit, so answers are about *your* work, not a textbook. | `DiracChatView` |
| **Share as Qiskit** | Getting a circuit *off* the phone — into a message, a desktop session, a notebook — via the system share sheet. | `CircuitExport` |
| **Keychain BYOK** | The Anthropic key lives in the iOS Keychain, not localStorage. | `Support/Keychain` |
| **Reproducible seed** | A toggle that pins the RNG seed so sampled results repeat — research hygiene, one tap. | `SettingsModel` |
| **Per-qubit Bloch picker** | Segmented control to inspect any qubit's state; length < 1 visibly flags entanglement. | `ResultsPanel` |

## Queued — high value, mostly no backend

- **Apple Pencil**: drag gates with the Pencil, hover-preview a gate before dropping
  (iPad M2+), scribble angles.
- **Drag-to-move & drag-from-palette**: native `draggable`/`dropDestination` as an
  alternative to tap-to-place, plus dragging a placed gate to a new cell.
- **Debugger scrubber**: a slider that scrubs the step-through trajectory
  (`StatevectorSimulator.trace`) with the Bloch sphere + histogram animating between
  gates — a "seek bar for your quantum state."
- **Measurement-collapse animation + haptic**: when you run with measurement, animate
  the superposition collapsing to the sampled outcome, with a matching haptic.
- **Widgets (WidgetKit)**: a daily-challenge widget and a running-job widget on the
  Home and Lock Screen.
- **App Intents / Siri / Spotlight**: "Simulate this circuit", "Ask Dirac",
  "Show my running jobs"; index saved circuits and glossary terms in Spotlight.
- **Handoff + iCloud sync**: start a circuit on the desktop, keep going on iPad, and
  back — the research loop follows you.
- **Result share card**: a nicely rendered image of the circuit + histogram + Bloch
  for sharing, and an animated GIF of the Bloch vector.
- **Accessibility as a feature**: VoiceOver announces gates and outcomes, Voice
  Control places gates hands-free, full Dynamic Type. This widens who can *do*
  quantum, not just who can read about it.
- **Camera → circuit** (stretch): scan a hand-drawn or textbook circuit diagram and
  reconstruct it (VisionKit + a small model). The ultimate "easier than typing."
- **Tinted app icon + light/dark**, pinch-zoom on the circuit, two-finger timeline
  scroll, shake-to-undo.

## Queued — needs the kernel gateway (Tier 2+)

- **Hardware job Live Activities**: queue position on the Lock Screen / Dynamic
  Island, push when a QPU job completes. The single best reason to have Nuclei on
  your phone (see PRD §1).
- **Campaign / sweep monitoring** with progress Live Activities and live threshold/Λ
  plots.
- **Contextual code keyboard**: a keyboard accessory row of quantum symbols (|0⟩, θ,
  ⊗, framework snippets) for when you *do* edit code against a remote kernel.
- **Apple Watch** complication for job status; **visionOS** spatial Bloch sphere.

## Principle

Every one of these earns its place by doing something the desktop *can't* do as well,
not by cramming the desktop onto a small screen. Touch, Pencil, voice, haptics,
notifications, and continuity are the material — the circuit, the state, and Dirac
are the subject.
