"""Pre-auth frame-size cap and cap on concurrent unauthenticated connections."""

from __future__ import annotations

import asyncio
import json
import socket

import websockets
from websockets.asyncio.client import connect as ws_connect
from websockets.asyncio.server import serve as ws_serve

from kernel import auth, server

TOKEN = "t" * 43
CONFIG = auth.build_config(token=TOKEN, insecure=False, dev=False)
AUTH = json.dumps({"type": "authenticate", "token": TOKEN})


class Recorder:
    def __init__(self) -> None:
        self.sizes: list[int] = []

    async def __call__(self, websocket) -> None:
        async for raw in websocket:
            self.sizes.append(len(raw))
            await websocket.send("ok")


async def _serve(inner, **handler_kwargs):
    handler = auth.secure_handler(inner, CONFIG, **handler_kwargs)
    ws_server = await ws_serve(handler, "127.0.0.1", 0, max_size=auth.PRE_AUTH_MAX_SIZE)
    return ws_server, ws_server.sockets[0].getsockname()[1]


def _run(coro):
    return asyncio.run(coro)


def test_oversized_first_frame_is_refused_before_auth():
    async def scenario():
        inner = Recorder()
        ws_server, port = await _serve(inner, max_size_after_auth=server.MAX_MESSAGE_SIZE)
        try:
            async with ws_connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send("x" * (auth.PRE_AUTH_MAX_SIZE + 1))
                try:
                    await asyncio.wait_for(ws.recv(), 3)
                except websockets.ConnectionClosed:
                    pass
                return inner, ws.protocol.close_code
        finally:
            ws_server.close()
    inner, code = _run(scenario())
    assert code == 1009 and inner.sizes == []


def test_normal_limit_applies_after_authentication():
    async def scenario():
        inner = Recorder()
        ws_server, port = await _serve(inner, max_size_after_auth=server.MAX_MESSAGE_SIZE)
        try:
            async with ws_connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send(AUTH)
                assert json.loads(await ws.recv())["type"] == "authenticated"
                big = "y" * (auth.PRE_AUTH_MAX_SIZE * 10)
                await ws.send(big)
                assert await asyncio.wait_for(ws.recv(), 3) == "ok"
                return inner.sizes
        finally:
            ws_server.close()
    assert _run(scenario()) == [auth.PRE_AUTH_MAX_SIZE * 10]


def test_message_limit_still_enforced_after_authentication():
    async def scenario():
        ws_server, port = await _serve(Recorder(), max_size_after_auth=50_000)
        try:
            async with ws_connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send(AUTH)
                await ws.recv()
                await ws.send("z" * 60_000)
                try:
                    await asyncio.wait_for(ws.recv(), 3)
                except websockets.ConnectionClosed:
                    pass
                return ws.protocol.close_code
        finally:
            ws_server.close()
    assert _run(scenario()) == 1009


def test_concurrent_unauthenticated_connections_are_capped_and_refused_fast():
    async def scenario():
        ws_server, port = await _serve_with_timeout(2, 30)
        idle = []
        try:
            for _ in range(2):
                idle.append(await ws_connect(f"ws://127.0.0.1:{port}"))
            await asyncio.sleep(0.2)  # let both reach recv()
            extra = await ws_connect(f"ws://127.0.0.1:{port}")
            try:
                await asyncio.wait_for(extra.recv(), 2)
            except websockets.ConnectionClosed:
                pass
            refused = extra.protocol.close_code
            # An authenticated client still gets in once a slot frees up.
            await idle[0].close()
            await asyncio.sleep(0.2)
            async with ws_connect(f"ws://127.0.0.1:{port}") as ok:
                await ok.send(AUTH)
                ack = json.loads(await ok.recv())
            return refused, ack["type"]
        finally:
            for ws in idle:
                await ws.close()
            ws_server.close()
    refused, ack = _run(scenario())
    assert refused == auth.CLOSE_BUSY and ack == "authenticated"


async def _serve_with_timeout(cap: int, timeout: float):
    handler = auth.secure_handler(
        Recorder(), CONFIG, auth_timeout=timeout, max_pre_auth_connections=cap
    )
    ws_server = await ws_serve(handler, "127.0.0.1", 0, max_size=auth.PRE_AUTH_MAX_SIZE)
    return ws_server, ws_server.sockets[0].getsockname()[1]


def test_real_server_starts_with_the_small_pre_auth_limit():
    async def scenario():
        ws_server = await server._try_serve(0, CONFIG)
        try:
            port = next(s for s in ws_server.sockets if s.family == socket.AF_INET).getsockname()[1]
            async with ws_connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send("x" * (auth.PRE_AUTH_MAX_SIZE + 1))
                try:
                    await asyncio.wait_for(ws.recv(), 3)
                except websockets.ConnectionClosed:
                    pass
                return ws.protocol.close_code
        finally:
            ws_server.close()
    assert _run(scenario()) == 1009
