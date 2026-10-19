"""Shared test harness: in-process fake sockets that speak the real kernel handshake.

The kernel authenticates the first frame of every connection (``kernel.auth``).
Tests that drive the handler without a TCP socket must not skip that gate, so
their fakes mix in :class:`HandshakeSocket` and are served through
:func:`serve_authenticated`, which wraps the handler in the production
``auth.secure_handler`` (Host check, Origin check, token check, ack).

Nothing here disables or weakens authentication: the token is a fixed test
secret and the config is built exactly as production builds it.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from types import SimpleNamespace
from typing import Any, Awaitable, Callable

from kernel import auth

TEST_TOKEN = "test-kernel-token-" + "x" * 32
TEST_PORT = 9742


def make_auth_config() -> auth.KernelAuthConfig:
    return auth.build_config(token=TEST_TOKEN, insecure=False, dev=False)


async def _resolved() -> None:
    return None


class _Headers(dict):
    def get_all(self, name: str) -> list[str]:
        value = self.get(name)
        return [] if value is None else [value]


class HandshakeSocket:
    """Mixin: the connection attributes ``auth.secure_handler`` reads.

    ``recv`` yields the authenticate frame (once); ``send`` swallows the
    ``authenticated`` ack so tests keep asserting on application replies only.
    """

    handshake_token: str = TEST_TOKEN
    handshake_origin: str | None = None
    handshake_host: str = f"localhost:{TEST_PORT}"
    local_address = ("127.0.0.1", TEST_PORT)
    authenticated: bool = False
    rejected_with: tuple[int, str] | None = None

    @property
    def request(self) -> Any:
        headers = _Headers({"Host": self.handshake_host})
        if self.handshake_origin is not None:
            headers["Origin"] = self.handshake_origin
        return SimpleNamespace(headers=headers)

    async def recv(self) -> str:
        return json.dumps({"type": "authenticate", "token": self.handshake_token})

    def _swallow_ack(self, raw: str) -> bool:
        if '"authenticated"' in raw and json.loads(raw).get("type") == "authenticated":
            self.authenticated = True
            return True
        return False

    def _reject(self, code: int, reason: str) -> Awaitable[None]:
        self.rejected_with = (code, reason)
        return _resolved()


Handler = Callable[[Any], Awaitable[None]]


def serve_authenticated(ws: Any, inner: Handler | None = None) -> Awaitable[None]:
    """Run ``ws`` through the production auth gate, then the kernel handler."""
    from kernel import server

    return auth.secure_handler(inner or server.handle_message, make_auth_config())(ws)


class StreamingWS(HandshakeSocket):
    """Pushable fake connection: tests push requests in and await streamed replies."""

    def __init__(self, default_timeout: float = 90.0) -> None:
        self._incoming: asyncio.Queue = asyncio.Queue()
        self.sent: list[dict] = []
        self._activity = asyncio.Event()
        self._default_timeout = default_timeout

    def push(self, message: dict) -> None:
        self._incoming.put_nowait(json.dumps(message))

    def close(self, code: int | None = None, reason: str = ""):
        """No arguments: end of input (test side). With a code: the server rejecting the socket."""
        if code is None:
            self._incoming.put_nowait(None)
            return None
        return self._reject(code, reason)

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self._incoming.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def send(self, raw: str) -> None:
        if self._swallow_ack(raw):
            return
        self.sent.append(json.loads(raw))
        self._activity.set()

    def count(self, kind: str) -> int:
        return len([m for m in self.sent if m.get("type") == kind])

    def types(self) -> list[str]:
        return [m.get("type") for m in self.sent]

    async def wait_for(self, predicate, timeout: float | None = None) -> list[dict]:
        timeout = self._default_timeout if timeout is None else timeout
        deadline = time.monotonic() + timeout
        while True:
            match = [m for m in self.sent if predicate(m)]
            if match:
                return match
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"no message matched within {timeout}s; got {self.types()}")
            self._activity.clear()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._activity.wait(), timeout=min(remaining, 0.5))

    async def wait_type(self, msg_type: str, timeout: float | None = None) -> dict:
        return (await self.wait_for(lambda m: m.get("type") == msg_type, timeout))[0]
