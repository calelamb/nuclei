import SwiftUI

/// The little box drawn for a placed gate (or a palette chip).
struct GateGlyph: View {
    let kind: GateKind
    var selected: Bool = false
    var size: CGFloat = 44

    var body: some View {
        let color = Palette.gateColor(kind.category)
        Text(kind.symbol)
            .font(.mono(kind.symbol.count > 1 ? size * 0.34 : size * 0.44, weight: .semibold))
            .foregroundStyle(kind.category == .measure ? Color.primary : .white)
            .frame(width: size, height: size)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(kind.category == .measure ? AnyShapeStyle(.thinMaterial) : AnyShapeStyle(color))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(selected ? Color.white : color.opacity(0.35),
                                  lineWidth: selected ? 2.5 : 1)
            )
            .shadow(color: color.opacity(selected ? 0.5 : 0), radius: 6)
    }
}
