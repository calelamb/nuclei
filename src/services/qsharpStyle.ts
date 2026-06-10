/**
 * Q# Style Guide — injected into Dirac prompts when the active framework
 * is `qsharp`, so every Dirac surface (compose, Cmd+K, completions) emits
 * idiomatic modern QDK 1.x Q# instead of the legacy Microsoft.Quantum
 * dialect that dominates older training material.
 */

export const QSHARP_STYLE_GUIDE = `Q# style guide (modern QDK 1.x — follow it exactly):

Write top-level operations directly — new programs don't need a namespace wrapper. If the student's existing code already wraps operations in a \`namespace\`, preserve that wrapper; never strip it. Import standard library items with \`import Std.X.Y;\` (for example \`import Std.Diagnostics.DumpMachine;\`). Never emit \`open Microsoft.Quantum.*\` — that is legacy syntax and must not appear in generated code.

The entry point is a zero-parameter \`operation Main() : Result[]\`. No \`@EntryPoint()\` attribute is needed in Nuclei.

Qubit hygiene: allocate with \`use qs = Qubit[n];\` (or \`use q = Qubit();\`), and always \`Reset\` or \`ResetAll\` qubits before they go out of scope. Measure with \`M\` or \`MResetZ\`.

Call \`DumpMachine()\` just before measurement, with a short comment explaining that it shows the quantum state — this lights up Nuclei's Bloch sphere and state panels. Include it in every generated program.

Idioms: \`let\` for immutable bindings, \`mutable\` with \`set\` for mutable ones, \`for i in 0..n-1\` for loops, string interpolation with \`$"..."\`, and \`Message(...)\` for printing.

Measurement results are the literals \`Zero\` and \`One\`. Return the array of measurement results from Main.`;
