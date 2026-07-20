// swift-tools-version: 6.0
import PackageDescription

// NucleiKit — the reusable, transport- and UI-agnostic core of Nuclei for iOS.
//
// It contains three things (see PRD 13, docs/ios/PRD_13_NUCLEI_FOR_IOS.md):
//   1. Protocol/   — Codable mirrors of the kernel wire protocol (src/types/quantum.ts).
//   2. Session/    — the KernelSession abstraction with a remote (WebSocket) and a
//                    local (native simulator) implementation.
//   3. Simulator/  — a native Swift statevector engine that emits the SAME
//                    CircuitSnapshot / SimulationResult shapes as the Python kernel.
//
// No UIKit / SwiftUI here on purpose: everything is unit-testable on the command
// line and shareable across the app, widget, and Watch targets.
let package = Package(
    name: "NucleiKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "NucleiKit", targets: ["NucleiKit"]),
    ],
    targets: [
        .target(name: "NucleiKit"),
        .testTarget(name: "NucleiKitTests", dependencies: ["NucleiKit"]),
    ]
)
