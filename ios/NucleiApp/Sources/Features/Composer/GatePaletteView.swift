import SwiftUI

/// The scrollable gate tray. Tap a gate to arm it, then tap the grid to place —
/// a fast, reliable touch idiom (no fussy drag-onto-a-thin-wire). The armed gate
/// stays lit so you can drop several in a row.
struct GatePaletteView: View {
    @Binding var selectedTool: GateKind?
    /// Shown while a two-qubit gate waits for its second qubit.
    var hint: String?

    var body: some View {
        VStack(spacing: 6) {
            if let hint {
                Text(hint)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Palette.purpleBright)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .transition(.opacity)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(GateKind.paletteOrder) { kind in
                        Button {
                            withAnimation(.snappy(duration: 0.15)) {
                                selectedTool = (selectedTool == kind) ? nil : kind
                            }
                        } label: {
                            VStack(spacing: 3) {
                                GateGlyph(kind: kind, selected: selectedTool == kind, size: 46)
                                Text(kind.qubitCount == 2 ? "2q" : kind.displayName)
                                    .font(.system(size: 9))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .frame(width: 50)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
        }
        .selectionFeedback(selectedTool)
        .background(.ultraThinMaterial)
    }
}
