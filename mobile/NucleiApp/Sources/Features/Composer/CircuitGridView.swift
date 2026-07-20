import SwiftUI

/// The interactive circuit grid. Tap an empty cell to place the selected gate;
/// long-press a placed gate for its menu. Wires and control connectors are drawn
/// in a non-interactive Canvas underneath.
struct CircuitGridView: View {
    @Environment(CircuitModel.self) private var circuit

    let selectedTool: GateKind?
    /// First qubit chosen for a two-qubit gate, awaiting the second (row, column).
    let pending: (qubit: Int, column: Int)?
    let onCellTap: (_ qubit: Int, _ column: Int) -> Void
    let onExplain: (PlacedGate) -> Void
    let onEditAngle: (PlacedGate) -> Void

    private let cellW: CGFloat = 60
    private let cellH: CGFloat = 66
    private let labelW: CGFloat = 40

    private func cellX(_ c: Int) -> CGFloat { labelW + CGFloat(c) * cellW + cellW / 2 }
    private func cellY(_ q: Int) -> CGFloat { CGFloat(q) * cellH + cellH / 2 }

    var body: some View {
        let cols = circuit.columnCount
        let rows = circuit.qubitCount
        let gridW = labelW + CGFloat(cols) * cellW
        let gridH = CGFloat(rows) * cellH

        ScrollView(.horizontal, showsIndicators: false) {
            ZStack(alignment: .topLeading) {
                wiresAndConnectors(rows: rows, cols: cols, width: gridW, height: gridH)
                    .allowsHitTesting(false)

                // Tap targets for empty cells (below the gates).
                ForEach(0..<rows, id: \.self) { q in
                    ForEach(0..<cols, id: \.self) { c in
                        Rectangle()
                            .fill(cellHighlight(q, c))
                            .frame(width: cellW - 8, height: cellH - 8)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .position(x: cellX(c), y: cellY(q))
                            .onTapGesture { onCellTap(q, c) }
                    }
                }

                // Placed gates (above the cells so they own touches).
                ForEach(circuit.gates) { gate in
                    placedGate(gate)
                }
            }
            .frame(width: gridW, height: gridH)
            .padding(.vertical, 8)
        }
    }

    // MARK: Cell highlight (affordance for where a tap will land)

    private func cellHighlight(_ q: Int, _ c: Int) -> Color {
        if let p = pending, p.qubit == q, p.column == c {
            return Palette.purpleBright.opacity(0.30)     // the first-picked qubit
        }
        if selectedTool != nil && circuit.isFree(qubit: q, column: c) {
            return Palette.teal.opacity(0.06)             // a legal drop target
        }
        return .clear
    }

    // MARK: Placed gate + its long-press menu

    @ViewBuilder
    private func placedGate(_ gate: PlacedGate) -> some View {
        let x = cellX(gate.column)
        Group {
            if gate.kind == .swap, gate.targets.count == 2 {
                swapEndpoint().position(x: x, y: cellY(gate.targets[0]))
                swapEndpoint().position(x: x, y: cellY(gate.targets[1]))
            } else if gate.kind.isControlled, let target = gate.targets.first {
                // Control dot is drawn in the Canvas; the target carries the glyph.
                GateGlyph(kind: gate.kind, size: 44)
                    .position(x: x, y: cellY(target))
            } else if let target = gate.targets.first {
                GateGlyph(kind: gate.kind, size: 44)
                    .position(x: x, y: cellY(target))
                    .overlay(alignment: .topTrailing) {
                        if !gate.params.isEmpty {
                            Text(angleLabel(gate.params[0]))
                                .font(.mono(9))
                                .foregroundStyle(.secondary)
                                .position(x: x + 22, y: cellY(target) - 22)
                        }
                    }
            }
        }
        .contentShape(Rectangle())
        .contextMenu {
            Button { onExplain(gate) } label: { Label("Explain with Dirac", systemImage: "sparkles") }
            if gate.kind.hasParameter {
                Button { onEditAngle(gate) } label: { Label("Edit angle", systemImage: "dial.min") }
            }
            Button(role: .destructive) { circuit.remove(gate) } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private func swapEndpoint() -> some View {
        Image(systemName: "xmark")
            .font(.system(size: 20, weight: .bold))
            .foregroundStyle(Palette.purpleBright)
            .frame(width: 44, height: 44)
    }

    private func angleLabel(_ radians: Double) -> String {
        String(format: "%.2fπ", radians / .pi)
    }

    // MARK: Wires + connectors

    private func wiresAndConnectors(rows: Int, cols: Int, width: CGFloat, height: CGFloat) -> some View {
        Canvas { context, _ in
            // Qubit labels + wires.
            for q in 0..<rows {
                let y = cellY(q)
                var line = Path()
                line.move(to: CGPoint(x: labelW, y: y))
                line.addLine(to: CGPoint(x: width, y: y))
                context.stroke(line, with: .color(.secondary.opacity(0.35)), lineWidth: 1)
                context.draw(
                    Text("q\(q)").font(.mono(12)).foregroundColor(.secondary),
                    at: CGPoint(x: labelW / 2, y: y))
            }
            // Connectors for controlled + swap gates.
            for gate in circuit.gates {
                let x = cellX(gate.column)
                if gate.kind.isControlled, let control = gate.controls.first, let target = gate.targets.first {
                    drawConnector(context, x: x, from: control, to: target,
                                  color: Palette.purpleBright)
                    // Filled control dot.
                    let dot = Path(ellipseIn: CGRect(x: x - 6, y: cellY(control) - 6, width: 12, height: 12))
                    context.fill(dot, with: .color(Palette.purpleBright))
                } else if gate.kind == .swap, gate.targets.count == 2 {
                    drawConnector(context, x: x, from: gate.targets[0], to: gate.targets[1],
                                  color: Palette.purpleBright)
                }
            }
        }
        .frame(width: width, height: height)
    }

    private func drawConnector(_ context: GraphicsContext, x: CGFloat, from a: Int, to b: Int, color: Color) {
        var path = Path()
        path.move(to: CGPoint(x: x, y: cellY(a)))
        path.addLine(to: CGPoint(x: x, y: cellY(b)))
        context.stroke(path, with: .color(color), lineWidth: 2)
    }
}
