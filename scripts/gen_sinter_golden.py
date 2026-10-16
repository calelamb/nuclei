"""Regenerate src/types/__fixtures__/sinter_golden.json.

Builds sinter CSVs with duplicate strong_id rows (what `sinter collect
--save_resume_filepath` / concatenated stats files produce) using real sinter
objects, then captures sinter.read_stats_from_csv_files output as the
expected value for the TypeScript parser (src/types/sinterCsv.ts).

Run: .venv-nuclei/bin/python scripts/gen_sinter_golden.py
"""
import collections
import io
import json
import pathlib

import sinter
import stim
from sinter._data._csv_out import csv_line

OUT = pathlib.Path(__file__).resolve().parent.parent / "src/types/__fixtures__/sinter_golden.json"


def task(d: int, p: float, decoder: str = "pymatching") -> sinter.Task:
    circuit = stim.Circuit.generated(
        "surface_code:rotated_memory_x", distance=d, rounds=d,
        after_clifford_depolarization=p,
    )
    return sinter.Task(circuit=circuit, decoder=decoder,
                       detector_error_model=circuit.detector_error_model(decompose_errors=True),
                       json_metadata={"d": d, "r": d, "p": p, "basis": "X"})


def stat(t: sinter.Task, shots, errors, discards=0, seconds=0.5, custom=None):
    return sinter.TaskStats(
        strong_id=t.strong_id(), decoder=t.decoder, json_metadata=t.json_metadata,
        shots=shots, errors=errors, discards=discards, seconds=seconds,
        custom_counts=collections.Counter(custom or {}),
    )


def to_csv(stats, header=sinter.CSV_HEADER, pad=False):
    lines = [header]
    for s in stats:
        line = csv_line(
            shots=s.shots, errors=s.errors, discards=s.discards, seconds=s.seconds,
            decoder=s.decoder, strong_id=s.strong_id, json_metadata=s.json_metadata,
            custom_counts=s.custom_counts)
        lines.append(line)
    return "\n".join(lines) + "\n"


def expected(csv_text):
    out = sinter.read_stats_from_csv_files(io.StringIO(csv_text))
    return [{
        "strong_id": s.strong_id, "decoder": s.decoder, "json_metadata": s.json_metadata,
        "shots": s.shots, "errors": s.errors, "discards": s.discards,
        "seconds": s.seconds, "custom_counts": dict(s.custom_counts),
    } for s in out]


t3, t5, t5b = task(3, 0.001), task(5, 0.001), task(5, 0.002)
resume = [
    stat(t3, 1000, 12, 3, 0.125, {"obs_mispredicts": 2, "dets": 40}),
    stat(t5, 1000, 4, 0, 0.25),
    stat(t3, 3000, 30, 5, 0.375, {"obs_mispredicts": 5, "other": 1}),
    stat(t5b, 500, 40, 0, 0.0625),
    stat(t3, 6000, 61, 0, 0.5, {"dets": 80}),
    stat(t5, 9000, 20, 1, 0.75),
]
cases = {
    "resume_duplicates_with_custom_counts": to_csv(resume),
    "no_duplicates": to_csv([resume[0], resume[1], resume[3]]),
}
# Header without custom_counts, padded numeric columns (sinter's printed style).
hdr = "shots,errors,discards,seconds,decoder,strong_id,json_metadata"
padded = ["     shots,    errors,  discards, seconds,decoder,strong_id,json_metadata",
          '     1000,        42,         0,   0.125,pymatching,9c31908e2b,"{""d"":9}"',
          '     3000,        24,         0,   0.125,pymatching,9c31908e2b,"{""d"":9}"',
          '     1000,       250,         0,   0.125,pymatching,deadbeef08,"{""d"":7}"']
cases["no_custom_counts_column_padded"] = "\n".join(padded) + "\n"

OUT.write_text(json.dumps({
    "sinter_version": sinter.__version__,
    "cases": [{"name": k, "csv": v, "expected": expected(v)} for k, v in cases.items()],
}, indent=1) + "\n")
print("wrote", OUT)
