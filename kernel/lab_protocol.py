"""Wire-level helpers shared by the Lab handlers (trainability, discovery, conjecture).

``request_id`` (protocol v1.3, additive): every synchronous Lab request may carry an optional string
``request_id`` (1-64 characters from ``[A-Za-z0-9._:-]``).  The kernel echoes it on the reply *and* on any
error caused by that request, so a client can match replies to requests and drop stale ones.  A request
without an id gets a reply without one.  An id that is present but malformed is rejected with an
``invalid_request`` error that does not echo it.
"""

from __future__ import annotations

import re
from typing import Any

MAX_REQUEST_ID_LENGTH = 64
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
INVALID_REQUEST_ID_MESSAGE = (
    f"`request_id` must be a string of 1-{MAX_REQUEST_ID_LENGTH} characters from [A-Za-z0-9._:-]."
)


def valid_request_id(msg: Any) -> str | None:
    """The request's id, or ``None`` when it is absent *or* malformed (never raises)."""
    value = msg.get("request_id") if isinstance(msg, dict) else None
    if isinstance(value, str) and REQUEST_ID_PATTERN.match(value):
        return value
    return None


def request_id_problem(msg: Any) -> str | None:
    """A message describing why ``msg['request_id']`` is unusable, or ``None`` when absent or valid."""
    if not isinstance(msg, dict) or msg.get("request_id") is None:
        return None
    return None if valid_request_id(msg) is not None else INVALID_REQUEST_ID_MESSAGE


def with_request_id(payload: dict[str, Any], msg: Any) -> dict[str, Any]:
    """``payload`` plus the request's id when it has a valid one (a new dict; ``payload`` is not mutated)."""
    request_id = valid_request_id(msg)
    return payload if request_id is None else {**payload, "request_id": request_id}
