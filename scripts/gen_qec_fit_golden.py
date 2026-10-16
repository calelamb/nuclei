"""Regenerate golden fixtures for src/lib/qecFit.ts using the real sinter.

Run: .venv-nuclei/bin/python scripts/gen_qec_fit_golden.py
Writes src/lib/__fixtures__/{synthetic_rounds.csv,qec_fit_golden.json}.
"""
import json
import math
import pathlib

import numpy as np
import sinter
from scipy.stats import linregress

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIX = ROOT / "src/lib/__fixtures__"
CAMPAIGN = ROOT / "src/components/qec/__fixtures__/campaign_stats.csv"
FACTORS = [1.0, 9.0, 1000.0]
LAMBDA_STEP = 2


def fit_dict(f):
    return {"low": f.low, "best": f.best, "high": f.high}


def synthetic_csv():
    """3 distances x 3 p x 2 rounds-settings, with discards. Deterministic."""
    rng = np.random.default_rng(20261015)
    lines = ["     shots,    errors,  discards, seconds,decoder,strong_id,json_metadata,custom_counts"]
    for r_mult in (1, 3):
        for p in (0.002, 0.004, 0.008):
            for d in (3, 5, 7):
                rounds = d * r_mult
                shot_rate = min(0.45, 0.5 * (1 - (1 - 2 * 0.08 * (p / 0.01) ** ((d + 1) / 2)) ** rounds) + 1e-6)
                shots = 200000
                discards = int(rng.integers(0, 4000))
                kept = shots - discards
                errors = int(rng.binomial(kept, shot_rate))
                meta = json.dumps({"d": d, "decoder": "pymatching", "label": "synth", "p": p, "r": rounds},
                                  separators=(",", ":"), sort_keys=True)
                sid = f"{d}-{p}-{rounds}-pymatching"
                lines.append(f"{shots:>10},{errors:>10},{discards:>10},{0.5:>8.3f},pymatching,{sid},\"{meta.replace(chr(34), chr(34)*2)}\",")
    (FIX / "synthetic_rounds.csv").write_text("\n".join(lines) + "\n")


def load(path):
    return sinter.stats_from_csv_files(str(path))


def row_cases(stats):
    out = []
    for s in stats:
        rounds = s.json_metadata.get("r")
        case = {"strong_id": s.strong_id, "shots": s.shots, "errors": s.errors,
                "discards": s.discards, "rounds": rounds, "perShot": {}, "perRound": {}}
        for f in FACTORS:
            fit = sinter.fit_binomial(num_shots=s.shots - s.discards, num_hits=s.errors, max_likelihood_factor=f)
            case["perShot"][str(f)] = fit_dict(fit)
            if rounds:
                case["perRound"][str(f)] = fit_dict(
                    sinter.shot_error_rate_to_piece_error_rate(fit, pieces=rounds))
        out.append(case)
    return out


def lambda_cases(stats):
    groups = {}
    for s in stats:
        key = (s.decoder, s.json_metadata.get("label"), s.json_metadata["p"], s.json_metadata.get("r_per_d"))
        groups.setdefault(key[:3], []).append(s)
    out = []
    for (dec, label, p), ss in sorted(groups.items(), key=lambda kv: (kv[0][0], str(kv[0][1]), kv[0][2])):
        for per_round in (False, True):
            pts = []
            for s in ss:
                fit = sinter.fit_binomial(num_shots=s.shots - s.discards, num_hits=s.errors, max_likelihood_factor=1)
                rate = fit.best
                if per_round and s.json_metadata.get("r"):
                    rate = sinter.shot_error_rate_to_piece_error_rate(rate, pieces=s.json_metadata["r"])
                if s.errors > 0:
                    pts.append((s.json_metadata["d"], s.errors, rate))
            case = {"decoder": dec, "label": label, "p": p, "perRound": per_round,
                    "ids": sorted(s.strong_id for s in ss), "n": len(pts)}
            if len({x for x, _, _ in pts}) >= 3:
                xs = np.array([x for x, _, _ in pts], float)
                ys = np.log([r for _, _, r in pts])
                lr = linregress(xs, ys)
                n = len(xs)
                rss = float(np.sum((ys - (lr.intercept + lr.slope * xs)) ** 2))
                var_log = float(np.mean([1.0 / e for _, e, _ in pts]))
                extra = max(rss / (n - 2), var_log)
                sxx = float(np.sum((xs - xs.mean()) ** 2))
                half = math.sqrt(extra / sxx)
                sfit = sinter.fit_line_slope(xs=xs, ys=ys, max_extra_squared_error=extra)
                case.update({
                    "slope": float(lr.slope), "intercept": float(lr.intercept), "stderr": float(lr.stderr),
                    "rss": rss, "extra": extra, "sxx": sxx,
                    "slopeAnalytic": {"low": float(lr.slope) - half, "best": float(lr.slope), "high": float(lr.slope) + half},
                    "slopeSinter": {"low": sfit.low, "best": sfit.best, "high": sfit.high},
                    "lambda": {"best": math.exp(-LAMBDA_STEP * lr.slope),
                               "low": math.exp(-LAMBDA_STEP * (lr.slope + half)),
                               "high": math.exp(-LAMBDA_STEP * (lr.slope - half))},
                })
            out.append(case)
    return out


def scalar_cases():
    conv = []
    for s, pieces, values in [(0.1, 2, 1), (0.05278640450004207, 0.5, 1), (1e-9, 100, 1), (0.6, 10, 2),
                              (0.7, 5, 1), (0.5, 4, 1), (0.0, 7, 1), (1.0, 7, 1), (0.3, 1, 1), (1e-320, 1e6, 1),
                              (0.2, 12, 3), (0.9, 3, 2)]:
        conv.append({"shot": s, "pieces": pieces, "values": values,
                     "expected": sinter.shot_error_rate_to_piece_error_rate(s, pieces=pieces, values=values)})
    binom = []
    for n, k, f in [(100_000_000, 2, 1000), (10, 5, 9), (20000, 0, 1000), (20000, 20000, 1000), (0, 0, 10),
                    (1, 1, 5), (50, 0, 1), (1000, 1, 1e6), (3_000_000, 123, 1000)]:
        fit = sinter.fit_binomial(num_shots=n, num_hits=k, max_likelihood_factor=f)
        binom.append({"shots": n, "hits": k, "factor": f, **fit_dict(fit)})
    return conv, binom


def main():
    synthetic_csv()
    campaign = load(CAMPAIGN)
    synth = load(FIX / "synthetic_rounds.csv")
    conv, binom = scalar_cases()
    line = []
    for xs, ys, extra in [([1, 2, 3], [10, 12, 14], 1), ([3, 5, 7], [-4.0, -5.1, -6.3, ][:3], 0.05),
                          ([3, 5, 7, 9], [-3.0, -3.9, -5.2, -6.0], 0.2)]:
        f = sinter.fit_line_slope(xs=xs, ys=ys, max_extra_squared_error=extra)
        line.append({"xs": xs, "ys": ys, "extra": extra, **fit_dict(f)})
    golden = {
        "sinterVersion": sinter.__version__,
        "lambdaStep": LAMBDA_STEP,
        "conversions": conv, "binomials": binom, "lineSlopes": line,
        "campaign": {"rows": row_cases(campaign), "lambda": lambda_cases(campaign)},
        "synthetic": {"rows": row_cases(synth), "lambda": lambda_cases(synth)},
    }
    (FIX / "qec_fit_golden.json").write_text(json.dumps(golden, indent=1) + "\n")


main()
