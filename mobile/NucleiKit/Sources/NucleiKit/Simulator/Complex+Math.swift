import Foundation

/// Arithmetic for the `Complex` wire DTO, kept out of `Simulation.swift` so the
/// DTO stays a plain Codable. Enough to run a statevector engine.
extension Complex {
    static let zero = Complex(0, 0)
    static let one = Complex(1, 0)
    static let i = Complex(0, 1)

    static func + (a: Complex, b: Complex) -> Complex { Complex(a.re + b.re, a.im + b.im) }
    static func - (a: Complex, b: Complex) -> Complex { Complex(a.re - b.re, a.im - b.im) }
    static func * (a: Complex, b: Complex) -> Complex {
        Complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
    }
    static func * (a: Complex, s: Double) -> Complex { Complex(a.re * s, a.im * s) }

    var conjugate: Complex { Complex(re, -im) }
    var magnitudeSquared: Double { re * re + im * im }

    /// e^{iθ} as a complex phase.
    static func expi(_ theta: Double) -> Complex { Complex(cos(theta), sin(theta)) }
}
