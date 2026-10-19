from dataclasses import dataclass, field, asdict


# Legacy wording from before PRD 15 R-4. The adapters no longer raise it: they raise
# `kernel.adapters.errors.UnboundParametersError` (info-class code `unbound_parameters`,
# naming the parameters). Kept only because existing tests pin this text.
UNBOUND_PARAMETERS_MESSAGE = (
    "bind circuit parameters before simulating (Trainability Lab analyzes free parameters)"
)


@dataclass
class Gate:
    type: str
    targets: list[int]
    controls: list[int] = field(default_factory=list)
    params: list[float] = field(default_factory=list)
    layer: int = 0
    # PRD 14: for gates built from unbound parameters, `params[i]` is 0.0 and
    # `symbols[i]` names the free symbol (None = numeric). Omitted from the
    # wire when None or all-None so existing snapshots stay byte-identical.
    symbols: list[str | None] | None = None

    def to_dict(self) -> dict:
        data = asdict(self)
        if self.symbols is None or all(s is None for s in self.symbols):
            data.pop("symbols", None)
        return data


@dataclass
class CircuitSnapshot:
    framework: str
    qubit_count: int
    classical_bit_count: int
    depth: int
    gates: list[Gate]
    # PRD 15 R-A: honest caveats about how this snapshot was derived (an
    # expansion that hit its cap, an instruction that could not be read).
    # Omitted from the wire when empty so ordinary snapshots stay byte-identical.
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        data = {
            "framework": self.framework,
            "qubit_count": self.qubit_count,
            "classical_bit_count": self.classical_bit_count,
            "depth": self.depth,
            "gates": [g.to_dict() for g in self.gates],
        }
        if self.notes:
            data["notes"] = list(self.notes)
        return data


@dataclass
class SimulationResult:
    state_vector: list[dict]  # [{"re": float, "im": float}, ...]
    probabilities: dict[str, float]
    measurements: dict[str, int]
    bloch_coords: list[dict]  # [{"x": float, "y": float, "z": float}, ...]
    execution_time_ms: float
    shot_count: int
    # Protocol v1.1 (PRD 09 Phase B) — both additive/optional on the wire.
    # `metrics` accumulates any `record_metric(name, value)` calls the
    # user's code made during this run; always present (empty when none
    # were recorded), never omitted.
    metrics: dict[str, float] = field(default_factory=dict)
    # `seed_honored` is None when no seed was requested for this run — in
    # that case the field is omitted from the wire payload entirely (see
    # to_dict below). When a seed WAS requested, this is True/False
    # depending on whether the backend actually honored it.
    seed_honored: bool | None = None
    # PRD 15 R-A (all omitted from the wire when None, so adapters that do not
    # report them are unchanged):
    # - `measurements_source`: "sampled" (shots from the simulator), "none" (the
    #   circuit has no measurements: `measurements` is {} and nothing is passed
    #   off as shots), or "sampled_from_statevector".
    # - `probabilities_exact`: `probabilities` is the deterministic state-vector
    #   distribution, not one trajectory of a non-unitary program.
    # - `bound_at`: the parameter point a parameterised circuit was run at.
    measurements_source: str | None = None
    probabilities_exact: bool | None = None
    bound_at: dict[str, float] | None = None

    _OPTIONAL_ON_WIRE = ("seed_honored", "measurements_source", "probabilities_exact", "bound_at")

    def to_dict(self) -> dict:
        data = asdict(self)
        for key in self._OPTIONAL_ON_WIRE:
            if data.get(key) is None:
                data.pop(key, None)
        return data
