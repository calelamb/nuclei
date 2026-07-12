from dataclasses import dataclass, field, asdict


@dataclass
class Gate:
    type: str
    targets: list[int]
    controls: list[int] = field(default_factory=list)
    params: list[float] = field(default_factory=list)
    layer: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class CircuitSnapshot:
    framework: str
    qubit_count: int
    classical_bit_count: int
    depth: int
    gates: list[Gate]

    def to_dict(self) -> dict:
        return {
            "framework": self.framework,
            "qubit_count": self.qubit_count,
            "classical_bit_count": self.classical_bit_count,
            "depth": self.depth,
            "gates": [g.to_dict() for g in self.gates],
        }


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

    def to_dict(self) -> dict:
        data = asdict(self)
        if self.seed_honored is None:
            data.pop("seed_honored", None)
        return data
