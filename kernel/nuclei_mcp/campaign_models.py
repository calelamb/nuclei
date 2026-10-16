"""Request schema for run_campaign. Noise model, rounds and decoders are required."""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

GENERATED_CODES = (
    "repetition_code:memory",
    "surface_code:rotated_memory_x",
    "surface_code:rotated_memory_z",
    "surface_code:unrotated_memory_x",
    "surface_code:unrotated_memory_z",
    "color_code:memory_xyz",
)
NOISE_CHANNELS = (
    "after_clifford_depolarization",
    "before_round_data_depolarization",
    "before_measure_flip_probability",
    "after_reset_flip_probability",
)

_STRICT = ConfigDict(frozen=True, extra="forbid")


class NoiseModel(BaseModel):
    """name labels the model in the journal. For generated circuits ``channels``
    maps stim noise arguments to multipliers of the swept physical error rate p
    (e.g. all four channels at 1.0 is uniform circuit-level depolarizing)."""

    model_config = _STRICT
    name: str = Field(min_length=1, max_length=80)
    channels: dict[str, float] | None = None


class GeneratorSource(BaseModel):
    model_config = _STRICT
    kind: Literal["generator"]
    code: str
    distances: list[int] = Field(min_length=1, max_length=50)
    rounds: int = Field(ge=1)
    noise_model: NoiseModel
    physical_error_rates: list[float] = Field(min_length=1, max_length=50)


class PathsSource(BaseModel):
    """Existing stim files. Their noise is whatever the file contains; the
    caller must still declare rounds and a noise-model label, which are
    recorded as metadata (not verified against the file)."""

    model_config = _STRICT
    kind: Literal["stim_paths"]
    paths: list[str] = Field(min_length=1, max_length=200)
    rounds: int = Field(ge=1)
    noise_model: NoiseModel


Source = Annotated[Union[GeneratorSource, PathsSource], Field(discriminator="kind")]


class CampaignRequest(BaseModel):
    model_config = _STRICT
    source: Source
    decoders: list[str] = Field(min_length=1, max_length=8)
    max_shots: int = Field(ge=1)
    max_errors: int = Field(ge=1)
    max_seconds: float = Field(gt=0)
    max_tasks: int = Field(ge=1)
    num_workers: int = Field(1, ge=1)
