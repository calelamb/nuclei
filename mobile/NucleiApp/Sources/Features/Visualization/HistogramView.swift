import SwiftUI
import Charts
import NucleiKit

/// Probability histogram (Swift Charts). Bars are labelled by basis state and
/// tinted teal; the tallest outcome is emphasized so the likely result reads at
/// a glance.
struct HistogramView: View {
    let probabilities: [(state: String, value: Double)]

    private var maxValue: Double { probabilities.map(\.value).max() ?? 1 }

    var body: some View {
        if probabilities.isEmpty {
            ContentUnavailableView("No distribution yet",
                                   systemImage: "chart.bar",
                                   description: Text("Add a gate to see outcome probabilities."))
        } else {
            Chart(probabilities, id: \.state) { item in
                BarMark(
                    x: .value("State", item.state),
                    y: .value("Probability", item.value)
                )
                .cornerRadius(4)
                .foregroundStyle(item.value >= maxValue - 1e-9 ? Palette.teal : Palette.tealDeep.opacity(0.6))
                .annotation(position: .top, alignment: .center) {
                    if item.value > 0.02 {
                        Text(String(format: "%.0f%%", item.value * 100))
                            .font(.mono(9))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .chartYScale(domain: 0...1)
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let s = value.as(String.self) {
                            Text("|\(s)⟩").font(.mono(10))
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(format: .percent.precision(.fractionLength(0)))
            }
        }
    }
}
