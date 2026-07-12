"""QEC campaign engine — sinter as the orchestrator (PRD 10 D4, protocol v1.2).

This is the deliberate exception to PRD 09's "frontend orchestrates, kernel
stays dumb" principle: sinter IS the orchestrator (multiprocess workers,
adaptive shot allocation), and the kernel wraps it as a managed
long-running job.

Threading model: ``sinter.collect`` runs in ONE worker thread per campaign
(sinter spawns its own worker *processes* underneath). Progress flows back
onto the WebSocket event loop via ``asyncio.run_coroutine_threadsafe`` —
the collect thread never touches the socket directly. One campaign at a
time per kernel; a second start answers a 409-style
``campaign_already_running`` error.

Cancellation: sinter exposes no cancel handle, but a ``progress_callback``
that raises aborts the collection loop and tears down the workers —
verified empirically against sinter 1.16. Partial results (everything
accumulated before the abort, plus any resumed prior data) are returned
with ``partial: true``.

Resume: the caller passes previously collected sinter-CSV text
(``existing_stats_csv``); it is loaded through sinter's own
``existing_data_filepaths`` machinery, counts toward ``max_shots``/
``max_errors``, and completed tasks are never re-sampled. The result's
``sampled_shots`` field reports how many shots were NEWLY collected this
run — a resumed, already-complete campaign reports 0.

Version note (installed package is the truth, per implementation
guardrails): sinter 1.16's ``progress_callback`` receives a
``sinter.Progress`` (``new_stats`` tuple + free-form ``status_message``),
not a bare ``TaskStats`` as older docs suggest. And ``sinter.collect`` has
NO seed parameter — Monte Carlo campaigns are not seed-reproducible, so
the campaign protocol deliberately omits a ``seed`` field rather than
accepting one it can't honor.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import threading
import time
from dataclasses import dataclass, field

from kernel.models import KernelError

DEFAULT_PROGRESS_INTERVAL_S = 1.0
MIN_PROGRESS_INTERVAL_S = 0.1
MAX_CAMPAIGN_TASKS = 2_000


class _CampaignCancelled(Exception):
    """Raised inside sinter's progress callback to abort collection."""


@dataclass
class _TaskRow:
    """Accumulated per-task statistics, merged across progress updates."""

    strong_id: str
    decoder: str
    json_metadata: object
    shots: int = 0
    errors: int = 0
    discards: int = 0
    seconds: float = 0.0
    custom_counts: dict = field(default_factory=dict)

    def merge(self, stats) -> None:
        self.shots += stats.shots
        self.errors += stats.errors
        self.discards += stats.discards
        self.seconds += stats.seconds
        for key, value in (stats.custom_counts or {}).items():
            self.custom_counts[key] = self.custom_counts.get(key, 0) + value

    def to_payload(self) -> dict:
        return {
            "strong_id": self.strong_id,
            "decoder": self.decoder,
            "json_metadata": self.json_metadata,
            "shots": self.shots,
            "errors": self.errors,
            "discards": self.discards,
            "seconds": round(self.seconds, 3),
            "custom_counts": dict(self.custom_counts),
        }


def _validate_positive_int(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{name} must be a positive integer, got {value!r}")
    return value


def build_tasks(tasks_payload: object) -> list:
    """Convert the wire `tasks` array into sinter.Task objects.

    Every validation failure raises ValueError with a message that names
    the offending task index — safe to show the user verbatim.
    """
    import sinter
    import stim

    if not isinstance(tasks_payload, list) or not tasks_payload:
        raise ValueError("tasks must be a non-empty array")
    if len(tasks_payload) > MAX_CAMPAIGN_TASKS:
        raise ValueError(
            f"campaign has {len(tasks_payload)} tasks, which exceeds the "
            f"cap of {MAX_CAMPAIGN_TASKS}"
        )

    tasks = []
    for i, entry in enumerate(tasks_payload):
        if not isinstance(entry, dict):
            raise ValueError(f"tasks[{i}] must be an object")
        circuit_text = entry.get("circuit_text")
        decoder = entry.get("decoder")
        if not isinstance(circuit_text, str) or not circuit_text.strip():
            raise ValueError(f"tasks[{i}].circuit_text must be a non-empty string")
        if not isinstance(decoder, str) or not decoder:
            raise ValueError(f"tasks[{i}].decoder must be a decoder name string")
        try:
            circuit = stim.Circuit(circuit_text)
        except ValueError as exc:
            first = str(exc).strip().splitlines()[0] if str(exc).strip() else "invalid circuit"
            raise ValueError(f"tasks[{i}].circuit_text is not a valid stim circuit: {first}") from exc
        metadata = entry.get("json_metadata")
        try:
            json.dumps(metadata)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"tasks[{i}].json_metadata is not JSON-serializable") from exc
        tasks.append(
            sinter.Task(circuit=circuit, decoder=decoder, json_metadata=metadata)
        )
    return tasks


def stats_to_csv(rows: list) -> str:
    """Render TaskStats-shaped rows as sinter's native CSV — bit-for-bit
    loadable by researchers' existing scripts (PRD 10 constraint 5)."""
    import sinter

    lines = [sinter.CSV_HEADER]
    lines.extend(row.to_csv_line() for row in rows)
    return "\n".join(lines) + "\n"


class CampaignManager:
    """One-campaign-at-a-time owner of the sinter collect thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active_id: str | None = None
        self._cancel_event: threading.Event | None = None
        self._thread: threading.Thread | None = None

    @property
    def active_id(self) -> str | None:
        return self._active_id

    def start(
        self,
        *,
        campaign_id: str,
        tasks_payload: object,
        max_shots: object = None,
        max_errors: object = None,
        workers: object = "auto",
        existing_stats_csv: object = None,
        progress_interval_s: object = None,
        loop: asyncio.AbstractEventLoop,
        send_json,
    ) -> tuple[dict | None, KernelError | None]:
        """Validate and launch a campaign. Returns (started_payload, error).

        On success the ack payload is returned for the caller to send;
        progress and the final result are pushed to `send_json` (an async
        callable taking one dict) from the collect thread via the loop.
        """
        try:
            import sinter  # noqa: F401
            import stim  # noqa: F401
        except ImportError as exc:
            dependency = exc.name or "sinter"
            return None, KernelError(
                code="missing_dependency",
                message=(
                    f"{dependency} is not installed, so QEC campaigns cannot "
                    "run in this environment."
                ),
                framework="stim",
                dependency=dependency,
            )

        if not isinstance(campaign_id, str) or not campaign_id:
            return None, KernelError(
                code="qec_campaign_invalid", message="campaign_id must be a non-empty string"
            )

        try:
            tasks = build_tasks(tasks_payload)
            if max_shots is None and max_errors is None:
                raise ValueError(
                    "at least one of collect.max_shots / collect.max_errors is "
                    "required — an unbounded campaign never terminates"
                )
            if max_shots is not None:
                max_shots = _validate_positive_int(max_shots, "collect.max_shots")
            if max_errors is not None:
                max_errors = _validate_positive_int(max_errors, "collect.max_errors")
            if workers == "auto" or workers is None:
                num_workers = max(1, (os.cpu_count() or 2) - 1)
            else:
                num_workers = _validate_positive_int(workers, "workers")
            if progress_interval_s is None:
                interval = DEFAULT_PROGRESS_INTERVAL_S
            else:
                interval = max(MIN_PROGRESS_INTERVAL_S, float(progress_interval_s))
            if existing_stats_csv is not None and not isinstance(existing_stats_csv, str):
                raise ValueError("existing_stats_csv must be a string of sinter CSV text")
        except ValueError as exc:
            return None, KernelError(code="qec_campaign_invalid", message=str(exc))

        with self._lock:
            if self._active_id is not None:
                return None, KernelError(
                    code="campaign_already_running",
                    message=(
                        f"Campaign {self._active_id!r} is already running — one "
                        "campaign at a time per kernel. Cancel it or wait for "
                        "it to finish."
                    ),
                )
            self._active_id = campaign_id
            self._cancel_event = threading.Event()
            cancel_event = self._cancel_event

        thread = threading.Thread(
            target=self._run,
            kwargs={
                "campaign_id": campaign_id,
                "tasks": tasks,
                "max_shots": max_shots,
                "max_errors": max_errors,
                "num_workers": num_workers,
                "existing_stats_csv": existing_stats_csv,
                "interval": interval,
                "cancel_event": cancel_event,
                "loop": loop,
                "send_json": send_json,
            },
            name=f"qec-campaign-{campaign_id}",
            daemon=True,
        )
        with self._lock:
            self._thread = thread
        thread.start()

        return {
            "type": "qec_campaign_started",
            "campaign_id": campaign_id,
            "tasks_total": len(tasks),
            "workers": num_workers,
        }, None

    def cancel(self, campaign_id: object) -> bool:
        """Request graceful shutdown. True if a matching campaign was running."""
        with self._lock:
            if self._active_id is None:
                return False
            if campaign_id is not None and campaign_id != self._active_id:
                return False
            if self._cancel_event is not None:
                self._cancel_event.set()
            return True

    def join(self, timeout: float | None = None) -> None:
        """Test helper: wait for the active campaign thread to finish."""
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    # ───────── collect thread ─────────

    def _run(
        self,
        *,
        campaign_id: str,
        tasks: list,
        max_shots: int | None,
        max_errors: int | None,
        num_workers: int,
        existing_stats_csv: str | None,
        interval: float,
        cancel_event: threading.Event,
        loop: asyncio.AbstractEventLoop,
        send_json,
    ) -> None:
        import sinter

        def emit(payload: dict) -> None:
            # Fire-and-forget onto the WS loop; a closed connection must
            # not crash the collect thread (the campaign keeps its own
            # accumulated state regardless).
            try:
                asyncio.run_coroutine_threadsafe(send_json(payload), loop)
            except RuntimeError:
                pass  # loop already closed (kernel shutting down)

        # Keyed by strong_id, built lazily from incoming stats: sinter only
        # assigns strong ids once it derives each task's detector error
        # model, so rows appear as data (new or resumed) arrives.
        rows: dict[str, _TaskRow] = {}
        sampled_shots = 0
        last_emit = 0.0

        def row_for(stats) -> _TaskRow:
            row = rows.get(stats.strong_id)
            if row is None:
                row = _TaskRow(
                    strong_id=stats.strong_id,
                    decoder=stats.decoder,
                    json_metadata=stats.json_metadata,
                )
                rows[stats.strong_id] = row
            return row

        def is_complete(row: _TaskRow) -> bool:
            if max_shots is not None and row.shots >= max_shots:
                return True
            if max_errors is not None and row.errors >= max_errors:
                return True
            return False

        def on_progress(progress) -> None:
            nonlocal sampled_shots, last_emit
            changed: list[str] = []
            for stats in progress.new_stats:
                row = row_for(stats)
                row.merge(stats)
                sampled_shots += stats.shots
                changed.append(stats.strong_id)
            if cancel_event.is_set():
                raise _CampaignCancelled()
            now = time.monotonic()
            if changed and now - last_emit >= interval:
                last_emit = now
                emit({
                    "type": "qec_campaign_progress",
                    "campaign_id": campaign_id,
                    # Only tasks whose numbers changed since the last update;
                    # values are accumulated totals, merged client-side by
                    # strong_id.
                    "tasks": [rows[sid].to_payload() for sid in dict.fromkeys(changed)],
                    "tasks_complete": sum(1 for r in rows.values() if is_complete(r)),
                    "tasks_total": len(tasks),
                    "status_message": progress.status_message,
                })

        tmp_path: str | None = None
        partial = False
        error_message: str | None = None
        final_stats: list | None = None
        try:
            existing_paths: list[str] = []
            if existing_stats_csv:
                fd, tmp_path = tempfile.mkstemp(suffix=".csv", prefix="nuclei-qec-resume-")
                with os.fdopen(fd, "w") as f:
                    f.write(existing_stats_csv)
                existing_paths = [tmp_path]
                # Fold prior rows in up front so a cancelled resume still
                # reports everything known, and completion math sees them.
                for stats in sinter.read_stats_from_csv_files(tmp_path):
                    row_for(stats).merge(stats)

            final_stats = sinter.collect(
                num_workers=num_workers,
                tasks=tasks,
                max_shots=max_shots,
                max_errors=max_errors,
                existing_data_filepaths=existing_paths,
                progress_callback=on_progress,
            )
        except _CampaignCancelled:
            partial = True
        except BaseException as exc:  # sinter worker failures land here
            partial = True
            error_message = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
        finally:
            if tmp_path is not None:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
            with self._lock:
                self._active_id = None
                self._cancel_event = None
                self._thread = None

        if final_stats is not None:
            # collect()'s return is authoritative (includes resumed data);
            # rebuild rows from it so the result and CSV agree exactly.
            rows = {}
            for stats in final_stats:
                rows[stats.strong_id] = _TaskRow(
                    strong_id=stats.strong_id,
                    decoder=stats.decoder,
                    json_metadata=stats.json_metadata,
                    shots=stats.shots,
                    errors=stats.errors,
                    discards=stats.discards,
                    seconds=stats.seconds,
                    custom_counts=dict(stats.custom_counts or {}),
                )
            csv_text = stats_to_csv(final_stats)
        else:
            import sinter as _sinter

            synthetic = [
                _sinter.TaskStats(
                    strong_id=r.strong_id,
                    decoder=r.decoder,
                    json_metadata=r.json_metadata,
                    shots=r.shots,
                    errors=r.errors,
                    discards=r.discards,
                    seconds=r.seconds,
                )
                for r in rows.values()
                if r.shots > 0
            ]
            csv_text = stats_to_csv(synthetic)

        result: dict = {
            "type": "qec_campaign_result",
            "campaign_id": campaign_id,
            "partial": partial,
            "sampled_shots": sampled_shots,
            "stats": [r.to_payload() for r in rows.values() if r.shots > 0],
            "csv": csv_text,
        }
        if error_message is not None:
            result["error"] = error_message
        emit(result)


def decode_sample(circuit_text: str, decoder: str, seed: object) -> tuple[dict | None, KernelError | None]:
    """One sampled shot, decoded — the detector-graph overlay's data
    (`qec_decode_sample`, PRD 10 D4). Cheap and synchronous.

    Deterministic for a given (circuit, seed, stim/pymatching versions):
    fixture-tested. Only pymatching is supported for the visual single-shot
    decode in v1 — campaign decoding supports whatever sinter supports.
    """
    try:
        import pymatching
        import stim
    except ImportError as exc:
        dependency = exc.name or "pymatching"
        return None, KernelError(
            code="missing_dependency",
            message=f"{dependency} is not installed, so shots cannot be decoded in this environment.",
            framework="stim",
            dependency=dependency,
        )

    if decoder != "pymatching":
        return None, KernelError(
            code="qec_decode_invalid",
            message=(
                f"Single-shot visual decoding supports 'pymatching' in this "
                f"version, got {decoder!r}. (Campaigns support every decoder "
                "sinter knows.)"
            ),
        )

    try:
        circuit = stim.Circuit(circuit_text)
    except ValueError as exc:
        first = str(exc).strip().splitlines()[0] if str(exc).strip() else "invalid circuit"
        return None, KernelError(code="compile_error", message=first, framework="stim")

    try:
        seed_int = int(seed) if seed is not None else None
    except (TypeError, ValueError):
        seed_int = None

    try:
        dem = circuit.detector_error_model(decompose_errors=True)
        matching = pymatching.Matching.from_detector_error_model(dem)
        sampler = circuit.compile_detector_sampler(seed=seed_int)
        dets, obs = sampler.sample(shots=1, separate_observables=True)
    except ValueError as exc:
        first = str(exc).strip().splitlines()[0] if str(exc).strip() else "decode failed"
        return None, KernelError(code="qec_decode_invalid", message=first, framework="stim")

    syndrome = [i for i, fired in enumerate(dets[0]) if fired]
    edges = matching.decode_to_edges_array(dets[0])
    predicted = matching.decode(dets[0])

    return {
        "num_detectors": circuit.num_detectors,
        "syndrome": syndrome,
        # -1 is pymatching's boundary sentinel; surface as null on the wire.
        "matched_edges": [
            {"d1": int(a), "d2": (int(b) if int(b) >= 0 else None)}
            for a, b in edges.tolist()
        ],
        "predicted_observable_flips": [int(x) for x in predicted.tolist()],
        "actual_observable_flips": [int(bool(x)) for x in obs[0].tolist()],
    }, None
