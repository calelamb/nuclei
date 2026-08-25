"""Durable publication helpers for QEC storage metadata."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from .hashing import canonical_json_bytes
from .storage_durability import DurableMover


def publish_json(
    path: Path,
    value: object,
    mover: DurableMover,
    *,
    replace_existing: bool,
) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as output:
            output.write(canonical_json_bytes(value) + b"\n")
            output.flush()
            os.fsync(output.fileno())
        mover.move(temporary, path, replace_existing=replace_existing)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
