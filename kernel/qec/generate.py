"""Built-in QEC circuit generation — the `qec_generate` message (PRD 10 D1).

Wraps ``stim.Circuit.generated`` behind validation with user-readable
errors. The frontend's "New QEC circuit" flow writes the returned text into
a real project file the user can edit — never a hidden circuit.
"""

from __future__ import annotations

# Stim's built-in generator targets. Kept as an explicit allowlist so an
# unknown code produces a friendly error naming the options, instead of a
# stim traceback. (Mirrors `stim.Circuit.generated`'s documented set.)
GENERATED_CODES = (
    "repetition_code:memory",
    "surface_code:rotated_memory_x",
    "surface_code:rotated_memory_z",
    "surface_code:unrotated_memory_x",
    "surface_code:unrotated_memory_z",
    "color_code:memory_xyz",
)

# Noise arguments stim's generator accepts, applied at generation time.
# The named-noise-model library (PRD 10 Phase C) compiles down to these.
NOISE_ARGS = (
    "after_clifford_depolarization",
    "before_round_data_depolarization",
    "before_measure_flip_probability",
    "after_reset_flip_probability",
)


class QecGenerateError(ValueError):
    """Validation failure with a message safe to show the user verbatim."""


def _validate_probability(name: str, value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise QecGenerateError(f"noise.{name} must be a number, got {value!r}")
    p = float(value)
    if not 0.0 <= p <= 1.0:
        raise QecGenerateError(
            f"noise.{name} must be a probability between 0 and 1, got {p}"
        )
    return p


def generate_circuit(
    code: str,
    distance: int,
    rounds: int,
    noise: dict[str, object] | None = None,
) -> str:
    """Generate a built-in QEC circuit and return its Stim text.

    Raises QecGenerateError with a user-readable message for every invalid
    input; stim's own rejections (e.g. an even surface-code distance) are
    re-raised with the offending parameters named.
    """
    if code not in GENERATED_CODES:
        raise QecGenerateError(
            f"Unknown generated code {code!r}. "
            f"Available codes: {', '.join(GENERATED_CODES)}."
        )
    if not isinstance(distance, int) or isinstance(distance, bool) or distance < 2:
        raise QecGenerateError(
            f"distance must be an integer of at least 2, got {distance!r}"
        )
    if not isinstance(rounds, int) or isinstance(rounds, bool) or rounds < 1:
        raise QecGenerateError(
            f"rounds must be an integer of at least 1, got {rounds!r}"
        )

    noise_kwargs: dict[str, float] = {}
    for key, value in (noise or {}).items():
        if key not in NOISE_ARGS:
            raise QecGenerateError(
                f"Unknown noise argument {key!r}. "
                f"Available arguments: {', '.join(NOISE_ARGS)}."
            )
        noise_kwargs[key] = _validate_probability(key, value)

    import stim

    try:
        circuit = stim.Circuit.generated(
            code, distance=distance, rounds=rounds, **noise_kwargs
        )
    except ValueError as exc:
        raise QecGenerateError(
            f"stim rejected {code} with distance={distance}, rounds={rounds}: {exc}"
        ) from exc

    return str(circuit)
