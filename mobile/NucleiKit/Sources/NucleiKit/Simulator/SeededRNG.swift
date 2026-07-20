import Foundation

/// A deterministic, seedable PRNG (SplitMix64) so measurement sampling is
/// reproducible when the caller passes a `seed` — matching the kernel's
/// `seed_honored` contract. The local simulator can *always* honor a seed, so it
/// reports `seed_honored: true` whenever a seed was requested.
public struct SeededRNG: RandomNumberGenerator {
    private var state: UInt64

    public init(seed: UInt64) {
        // Avoid a zero state producing a degenerate stream.
        self.state = seed &+ 0x9E37_79B9_7F4A_7C15
    }

    public mutating func next() -> UInt64 {
        state = state &+ 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /// A uniform double in [0, 1).
    public mutating func nextUnit() -> Double {
        // Top 53 bits → [0,1) with full double precision.
        Double(next() >> 11) * (1.0 / 9_007_199_254_740_992.0)
    }
}
