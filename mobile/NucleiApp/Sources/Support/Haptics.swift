import SwiftUI

/// Tiny helpers around SwiftUI's `sensoryFeedback`. Physical feedback is a big
/// part of what makes a touch circuit editor feel real: a tick when a gate lands,
/// a success buzz when a run finishes.
extension View {
    /// Light impact each time `count` changes (gate placed / removed).
    func gatePlacementFeedback(_ count: Int) -> some View {
        sensoryFeedback(.impact(weight: .light), trigger: count)
    }

    /// Success feedback when a run completes.
    func runCompletionFeedback(_ token: Int) -> some View {
        sensoryFeedback(.success, trigger: token)
    }

    /// A soft selection tick (qubit picker, tool selection).
    func selectionFeedback<T: Equatable>(_ value: T) -> some View {
        sensoryFeedback(.selection, trigger: value)
    }
}
