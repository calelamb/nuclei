"""Wire helpers shared by the run-worker pool and the worker process.

Control channel: a 4-byte big-endian length followed by one UTF-8 JSON object.  Nothing is ever
pickled, so the server never unpickles anything a worker sends.  User stdout/stderr travel on the
worker's own fds 1 and 2; the end of each request's output is marked by a per-worker random marker
(:func:`end_marker`).
"""

from __future__ import annotations

import json
import socket
import struct

TO_WORKER_MAX_BYTES = 8 * 1024 * 1024
FROM_WORKER_MAX_BYTES = 32 * 1024 * 1024
_HEADER = struct.Struct(">I")
MARKER_PREFIX = b"\x1eNUCLEI-END:"
MARKER_SUFFIX = b"\x1e\n"


class FrameError(Exception):
    """A malformed or oversized control frame (the peer is killed, never trusted again)."""


def encode_frame(obj: object) -> bytes:
    body = json.dumps(obj, separators=(",", ":"), allow_nan=True).encode("utf-8")
    return _HEADER.pack(len(body)) + body


def send_frame(sock: socket.socket, obj: object, cap: int) -> None:
    data = encode_frame(obj)
    if len(data) - _HEADER.size > cap:
        raise FrameError(f"frame of {len(data)} bytes exceeds the {cap}-byte cap")
    sock.sendall(data)


def _recv_exact(sock: socket.socket, count: int) -> bytes | None:
    chunks: list[bytes] = []
    remaining = count
    while remaining:
        chunk = sock.recv(min(remaining, 1 << 20))
        if not chunk:
            return None  # EOF
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def recv_frame(sock: socket.socket, cap: int) -> dict | None:
    """The next frame, or ``None`` at EOF.  Raises :class:`FrameError` on a bad frame."""
    header = _recv_exact(sock, _HEADER.size)
    if header is None:
        return None
    (length,) = _HEADER.unpack(header)
    if length > cap:
        raise FrameError(f"peer announced a {length}-byte frame (cap {cap})")
    body = _recv_exact(sock, length)
    if body is None:
        raise FrameError("connection closed in the middle of a frame")
    try:
        obj = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise FrameError(f"frame is not valid JSON: {exc}") from exc
    if not isinstance(obj, dict):
        raise FrameError("frame is not a JSON object")
    return obj


def end_marker(marker: str, seq: int) -> bytes:
    return MARKER_PREFIX + marker.encode("ascii") + b":" + str(seq).encode("ascii") + MARKER_SUFFIX
