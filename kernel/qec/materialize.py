"""The `nuclei_circuits()` contract — Python entry sources for campaigns
(PRD 10 D4/Phase C, protocol v1.2).

A campaign whose `source` is a Python entry file provides its circuits by
defining::

    def nuclei_circuits(noise: dict) -> dict[str, stim.Circuit]:
        ...

The runner sends the file's code plus the resolved noise dict for one grid
point; the kernel executes the code, calls ``nuclei_circuits(noise)``, and
returns ``{label: circuit_text}``. Arbitrary custom noise stays possible —
the user applies the dict however they like (or ignores it).

Execution reuses the Executor's ``_run_code`` sandboxing (stdout/stderr
capture, timeout on the main thread) rather than a bare ``exec``, so entry
sources behave exactly like `parse`/`execute` code does.
"""

from __future__ import annotations

from kernel.models import KernelError

# A campaign is capped kernel-side at 10k tasks; a single materialization
# call returning more labels than this is certainly a bug in user code.
MAX_LABELS = 1_000


def materialize_circuits(
    executor, code: str, noise: dict | None
) -> tuple[dict[str, str] | None, str, str, KernelError | None]:
    """Run `code`, call its nuclei_circuits(noise), return labeled texts.

    Returns (circuits, stdout, stderr, error) — circuits is
    ``{label: circuit_text}`` on success. Every failure mode is a
    KernelError with a message safe to show verbatim.
    """
    try:
        import stim
    except ImportError:
        return None, "", "", KernelError(
            code="missing_dependency",
            message="Stim is not installed, so campaign circuits cannot be built in this environment.",
            framework="stim",
            dependency="stim",
        )

    noise_dict = dict(noise) if isinstance(noise, dict) else {}

    stdout, stderr, error = executor._run_code(code)
    if error is not None:
        return None, stdout, stderr, error

    fn = executor._namespace.get("nuclei_circuits")
    if not callable(fn):
        return None, stdout, stderr, KernelError(
            code="qec_materialize_invalid",
            message=(
                "The entry file must define nuclei_circuits(noise) returning "
                "a dict of {label: stim.Circuit} — no such function was found."
            ),
            framework="stim",
        )

    try:
        result = fn(noise_dict)
    except Exception as exc:
        first = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
        return None, stdout, stderr, KernelError(
            code="qec_materialize_invalid",
            message=f"nuclei_circuits(noise) raised: {first}",
            framework="stim",
        )

    if not isinstance(result, dict) or not result:
        return None, stdout, stderr, KernelError(
            code="qec_materialize_invalid",
            message=(
                "nuclei_circuits(noise) must return a non-empty dict of "
                f"{{label: stim.Circuit}}, got {type(result).__name__}."
            ),
            framework="stim",
        )
    if len(result) > MAX_LABELS:
        return None, stdout, stderr, KernelError(
            code="qec_materialize_invalid",
            message=(
                f"nuclei_circuits(noise) returned {len(result)} circuits, "
                f"which exceeds the cap of {MAX_LABELS} labels per call."
            ),
            framework="stim",
        )

    circuits: dict[str, str] = {}
    for label, circuit in result.items():
        if not isinstance(label, str) or not label:
            return None, stdout, stderr, KernelError(
                code="qec_materialize_invalid",
                message=f"nuclei_circuits(noise) keys must be non-empty strings, got {label!r}.",
                framework="stim",
            )
        if not isinstance(circuit, stim.Circuit):
            return None, stdout, stderr, KernelError(
                code="qec_materialize_invalid",
                message=(
                    f"nuclei_circuits(noise)[{label!r}] is "
                    f"{type(circuit).__name__}, expected stim.Circuit."
                ),
                framework="stim",
            )
        circuits[label] = str(circuit)

    return circuits, stdout, stderr, None
