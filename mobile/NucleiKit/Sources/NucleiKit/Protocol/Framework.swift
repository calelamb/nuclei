import Foundation

/// Quantum framework a circuit belongs to.
///
/// Mirrors `Framework` in `src/types/quantum.ts`. Note the raw value for CUDA-Q
/// is the hyphenated `"cuda-q"` the wire uses, not `cudaq`.
public enum Framework: String, Codable, Sendable, CaseIterable {
    case qiskit
    case cirq
    case cudaq = "cuda-q"
    case qsharp
    case stim
}

/// Source language the kernel should interpret a buffer as.
///
/// Mirrors `KernelLanguage` in `src/types/quantum.ts`. Q# is its own language;
/// Stim is language-driven only for raw `.stim` text — everything else is Python.
public enum KernelLanguage: String, Codable, Sendable {
    case python
    case qsharp
    case stim
}

public extension Framework {
    /// Map a framework (and optional file path) to the source language the kernel
    /// must parse it as — a direct port of `kernelLanguageFor` in quantum.ts.
    ///
    /// `framework: .stim` normally means Python code building `stim.Circuit`
    /// objects; only a `.stim` file path sends `language: "stim"`.
    func kernelLanguage(filePath: String? = nil) -> KernelLanguage {
        if self == .qsharp { return .qsharp }
        if let p = filePath?.lowercased(), p.hasSuffix(".stim") { return .stim }
        return .python
    }
}
