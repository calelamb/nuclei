"""Heavy QML benchmark: quantum vs classical inside Nuclei Trainability Lab APIs.

Run from kernel/ with the full test venv:
  ~/.cache/nuclei-test-venvs/full/bin/python ../docs/qml-benchmark-results/run_benchmark.py
Writes results.json + results.md next to this script.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.noise import NoiseSpec
from kernel.trainability.pauli import parse_observable
from kernel.trainability.qml_align import kernel_alignment_search
from kernel.trainability.qml_baseline import classical_baseline
from kernel.trainability.qml_kernel import quantum_kernel
from kernel.trainability.qml_qng import variational_qng
from kernel.trainability.qml_train import variational_train

OUT = Path(__file__).resolve().parent
DATASETS = ["moons", "circles", "blobs", "xor"]
SAMPLE_SIZES = [48, 120, 200]
SEED = 7


def feature_map() -> ParamCircuit:
    gates = [
        IrGate("RX", (0,), (ParamRef("x0"),), 0),
        IrGate("RX", (1,), (ParamRef("x1"),), 1),
        IrGate("CZ", (0, 1), (), 2),
    ]
    return ParamCircuit(2, gates, ["x0", "x1"])


def classifier(layers: int = 2) -> ParamCircuit:
    gates = []
    params = ["x0", "x1"]
    i = 0
    t = 0
    for layer in range(layers):
        gates.append(IrGate("RX", (0,), (ParamRef("x0"),), i)); i += 1
        gates.append(IrGate("RX", (1,), (ParamRef("x1"),), i)); i += 1
        for q in (0, 1):
            name = f"theta{t}"; t += 1; params.append(name)
            gates.append(IrGate("RY", (q,), (ParamRef(name),), i)); i += 1
        gates.append(IrGate("CZ", (0, 1), (), i)); i += 1
    gates.append(IrGate("RY", (0,), (ParamRef(f"theta{t}"),), i)); params.append(f"theta{t}")
    return ParamCircuit(2, gates, params)


def timed(fn):
    t0 = time.monotonic()
    res = fn()
    return res, round(time.monotonic() - t0, 3)


def main() -> None:
    obs = parse_observable("Z0", 2)
    rows = []
    for ds in DATASETS:
        for n in SAMPLE_SIZES:
            kw = dict(dataset=ds, dataset_samples=n, seed=SEED)
            # Variational: Adam/adjoint, SPSA, QNG (2-layer re-uploading)
            r, w = timed(lambda: variational_train(classifier(2), obs, epochs=60, learning_rate=0.15, optimizer="adam", **kw))
            rows.append(dict(dataset=ds, n=n, model="vqc_adam_L2", test_acc=r["final_test_accuracy"], train_acc=r.get("final_train_accuracy"), loss=r["final_loss"], wall_s=w))
            r, w = timed(lambda: variational_train(classifier(2), obs, epochs=60, optimizer="spsa", **kw))
            rows.append(dict(dataset=ds, n=n, model="vqc_spsa_L2", test_acc=r["final_test_accuracy"], train_acc=r.get("final_train_accuracy"), loss=r["final_loss"], wall_s=w))
            r, w = timed(lambda: variational_qng(classifier(2), obs, epochs=40, learning_rate=0.3, **kw))
            rows.append(dict(dataset=ds, n=n, model="vqc_qng_L2", test_acc=r["final_test_accuracy"], train_acc=r.get("final_train_accuracy"), loss=r["final_loss"], wall_s=w))
            # Adam under simulated device noise
            nz = NoiseSpec(shots=512, depolarizing_p=0.05, readout_flip_p=0.05)
            r, w = timed(lambda: variational_train(classifier(2), obs, epochs=60, learning_rate=0.15, optimizer="adam", channel_noise=nz, **kw))
            rows.append(dict(dataset=ds, n=n, model="vqc_adam_L2_noisy", test_acc=r["final_test_accuracy"], train_acc=r.get("final_train_accuracy"), loss=r["final_loss"], wall_s=w))
            # Quantum fidelity kernel + ridge
            r, w = timed(lambda: quantum_kernel(feature_map(), **kw))
            rows.append(dict(dataset=ds, n=n, model="quantum_kernel", test_acc=r["test_accuracy"], train_acc=r["train_accuracy"], alignment=r["alignment"], wall_s=w))
            # Classical baselines (RBF sweep + linear) on identical split + verdict
            r, w = timed(lambda: classical_baseline(feature_map(), **kw))
            best = max(r["baselines"], key=lambda b: b["test_accuracy"])
            rows.append(dict(dataset=ds, n=n, model=f"classical_best[{best['name']}]", test_acc=best["test_accuracy"], train_acc=best["train_accuracy"], verdict=r["verdict"], geometric_difference=r.get("geometric_difference"), wall_s=w))
            print(ds, n, "done", flush=True)
    # Depth study at n=120
    for ds in DATASETS:
        for layers in (1, 3, 4):
            r, w = timed(lambda: variational_train(classifier(layers), obs, dataset=ds, dataset_samples=120, seed=SEED, epochs=60, learning_rate=0.15, optimizer="adam"))
            rows.append(dict(dataset=ds, n=120, model=f"vqc_adam_L{layers}", test_acc=r["final_test_accuracy"], train_acc=r.get("final_train_accuracy"), loss=r["final_loss"], wall_s=w))
        # Kernel-alignment search improves the bare feature map?
        r, w = timed(lambda: kernel_alignment_search(feature_map(), dataset=ds, dataset_samples=120, seed=SEED, steps=40))
        rows.append(dict(dataset=ds, n=120, model="kernel_alignment_search", test_acc=r.get("best", {}).get("test_accuracy"), train_acc=r.get("best", {}).get("train_accuracy"), alignment_before=r["initial"]["alignment"], alignment_after=r.get("best", {}).get("alignment"), wall_s=w))
        print(ds, "depth+align done", flush=True)

    (OUT / "results.json").write_text(json.dumps(rows, indent=2, allow_nan=False))
    lines = ["# QML benchmark results (Nuclei Trainability Lab APIs, seed 7)", "",
             "| dataset | n | model | test acc | train acc | wall s | extra |",
             "|---|---|---|---|---|---|---|"]
    for r in rows:
        extra = []
        for k in ("loss", "alignment", "verdict", "geometric_difference", "alignment_before", "alignment_after"):
            if r.get(k) is not None:
                extra.append(f"{k}={r[k]}" if not isinstance(r[k], float) else f"{k}={r[k]:.4f}")
        def f(v): return f"{v:.3f}" if isinstance(v, float) else str(v)
        lines.append(f"| {r['dataset']} | {r['n']} | {r['model']} | {f(r.get('test_acc'))} | {f(r.get('train_acc'))} | {r['wall_s']} | {'; '.join(extra)} |")
    (OUT / "results.md").write_text("\n".join(lines) + "\n")
    print(f"wrote {len(rows)} rows to {OUT}")


if __name__ == "__main__":
    main()
