import SwiftUI

/// Nuclei's visual identity, ported to native tokens. Navy ground, teal quantum
/// accent, purple for Dirac — matching the desktop app (CLAUDE.md → Visual Design).
enum Palette {
    static let navy = Color(hex: 0x0F1B2D)
    static let surface = Color(hex: 0x16273E)
    static let teal = Color(hex: 0x00B4D8)
    static let tealDeep = Color(hex: 0x0090B4)
    static let purple = Color(hex: 0x7B2D8E)
    static let purpleBright = Color(hex: 0xC77BD6)
    static let amber = Color(hex: 0xE3A64A)
    static let good = Color(hex: 0x52C79B)

    /// Accent for a gate category, so the palette reads at a glance on the grid.
    static func gateColor(_ category: GateCategory) -> Color {
        switch category {
        case .single: return teal
        case .rotation: return amber
        case .controlled: return purpleBright
        case .measure: return Color.secondary
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// A shared monospaced style for amplitudes/bitstrings (Nuclei uses JetBrains
/// Mono on desktop; the system monospaced face is the faithful native stand-in).
extension Font {
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}
