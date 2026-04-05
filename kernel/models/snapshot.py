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

    def to_dict(self) -> dict:
        return asdict(self)
