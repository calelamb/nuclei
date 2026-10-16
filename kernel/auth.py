"""Authentication and origin policy for the kernel WebSocket.

The kernel executes code it receives, so every connection must clear three
gates before any message reaches a handler:

1. ``Host`` must be a loopback name on the port the connection arrived on
   (defeats DNS rebinding).
2. ``Origin``, when present, must be on the allowlist (defeats cross-site
   WebSockets from a browser tab).  Non-browser clients send no Origin.
3. The first frame must be ``{"type": "authenticate", "token": ...}`` carrying
   the per-launch token, compared in constant time.  The token never travels
   in the URL.

With no token configured the kernel refuses to start unless
``NUCLEI_KERNEL_INSECURE_DEV=1`` is set explicitly.
"""

from __future__ import annotations

import asyncio
import atexit
import hmac
import json
import os
import signal
import sys
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping

TOKEN_ENV = "NUCLEI_KERNEL_TOKEN"
INSECURE_ENV = "NUCLEI_KERNEL_INSECURE_DEV"
DEV_ENV = "NUCLEI_KERNEL_DEV"
STRICT_PORT_ENV = "NUCLEI_KERNEL_STRICT_PORT"
RUNTIME_DIR_ENV = "NUCLEI_RUNTIME_DIR"

RUNTIME_FILE_NAME = "kernel.json"
MIN_TOKEN_LENGTH = 32
MAX_TOKEN_LENGTH = 1_024
AUTH_TIMEOUT_SECONDS = 10.0

CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403

PRODUCTION_ORIGINS = frozenset({
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
})
DEV_ORIGINS = frozenset({
    "http://localhost:5173",
    "http://127.0.0.1:5173",
})
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "[::1]"})


class AuthConfigError(RuntimeError):
    """The kernel was started without a usable authentication setup."""


@dataclass(frozen=True)
class KernelAuthConfig:
    token: str | None
    insecure: bool
    allowed_origins: frozenset[str]


def build_config(*, token: str | None, insecure: bool, dev: bool) -> KernelAuthConfig:
    origins = PRODUCTION_ORIGINS | DEV_ORIGINS if dev else PRODUCTION_ORIGINS
    return KernelAuthConfig(token=token, insecure=insecure, allowed_origins=origins)


def config_from_env(env: Mapping[str, str] | None = None) -> KernelAuthConfig:
    """Read the auth setup from the environment, failing closed."""
    env = os.environ if env is None else env
    token = env.get(TOKEN_ENV) or None
    if env is os.environ:
        # Child processes (agent worker, user code) must not inherit the secret.
        os.environ.pop(TOKEN_ENV, None)
    insecure_flag = env.get(INSECURE_ENV, "")
    if insecure_flag not in ("", "0", "1"):
        raise AuthConfigError(f"{INSECURE_ENV} must be exactly 1 to enable insecure mode")
    insecure_allowed = insecure_flag == "1"
    dev = env.get(DEV_ENV) == "1"

    if token is not None and not MIN_TOKEN_LENGTH <= len(token) <= MAX_TOKEN_LENGTH:
        raise AuthConfigError(
            f"{TOKEN_ENV} must be {MIN_TOKEN_LENGTH}-{MAX_TOKEN_LENGTH} characters"
        )
    if token is None and not insecure_allowed:
        raise AuthConfigError(
            f"{TOKEN_ENV} is not set; refusing to start an unauthenticated kernel. "
            f"Set {INSECURE_ENV}=1 to override for local development only."
        )
    if token is None:
        print(
            "WARNING: Nuclei kernel is running in INSECURE dev mode: no token is "
            "required. Any local process (and, if Origin checks are bypassed, any "
            "web page) could run code through this socket. Never use outside "
            "development.",
            file=sys.stderr,
            flush=True,
        )
    return build_config(token=token, insecure=token is None, dev=dev)


# ── handshake checks ─────────────────────────────────────────────────────


def scrubbed_environment(env: Mapping[str, str] | None = None) -> dict[str, str]:
    """Copy of ``env`` without kernel auth variables, for child processes."""
    source = os.environ if env is None else env
    return {k: v for k, v in source.items() if k not in (TOKEN_ENV, INSECURE_ENV)}


def _request_headers(websocket: Any) -> Mapping[str, str]:
    request = getattr(websocket, "request", None)
    if request is not None and getattr(request, "headers", None) is not None:
        return request.headers
    return getattr(websocket, "request_headers", {})


def _header_values(headers: Mapping[str, str], name: str) -> list[str]:
    """All values of a header; duplicates must never be silently collapsed."""
    get_all = getattr(headers, "get_all", None)
    if get_all is not None:
        return list(get_all(name))
    value = headers.get(name)
    return [] if value is None else [value]


def _local_port(websocket: Any) -> int | None:
    address = getattr(websocket, "local_address", None)
    if address and len(address) >= 2:
        return int(address[1])
    return None


def host_allowed(host: str | None, port: int | None) -> bool:
    if not host or port is None:
        return False
    name, separator, host_port = host.rpartition(":")
    if not separator or host_port != str(port):
        return False
    return name.lower() in LOOPBACK_HOSTS


def origin_allowed(config: KernelAuthConfig, origin: str | None) -> bool:
    return origin is None or origin in config.allowed_origins


def token_matches(config: KernelAuthConfig, frame: object) -> bool:
    if config.token is None:
        return False
    try:
        value = json.loads(frame)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    if not isinstance(value, dict) or value.get("type") != "authenticate":
        return False
    supplied = value.get("token")
    if not isinstance(supplied, str) or not 1 <= len(supplied) <= MAX_TOKEN_LENGTH:
        return False
    return hmac.compare_digest(supplied.encode(), config.token.encode())


def handshake_violation(
    config: KernelAuthConfig, headers: Mapping[str, str], port: int | None
) -> str | None:
    """Reason the Host/Origin headers are unacceptable, or None if fine."""
    hosts = _header_values(headers, "Host")
    if len(hosts) != 1 or not host_allowed(hosts[0], port):
        return "forbidden host"
    origins = _header_values(headers, "Origin")
    if len(origins) > 1 or not origin_allowed(config, origins[0] if origins else None):
        return "forbidden origin"
    return None


def make_process_request(config: KernelAuthConfig):
    """websockets ``process_request`` hook: HTTP 403 before the upgrade."""

    def process_request(connection: Any, request: Any):
        address = getattr(connection, "local_address", None)
        port = int(address[1]) if address and len(address) >= 2 else None
        reason = handshake_violation(config, request.headers, port)
        if reason is None:
            return None
        return connection.respond(403, f"{reason}\n")

    return process_request


Handler = Callable[[Any], Awaitable[None]]


async def _reject(websocket: Any, code: int, reason: str) -> None:
    try:
        await websocket.close(code, reason)
    except Exception:  # noqa: BLE001 - connection may already be gone
        pass


def secure_handler(
    inner: Handler,
    config: KernelAuthConfig,
    auth_timeout: float = AUTH_TIMEOUT_SECONDS,
) -> Handler:
    """Wrap ``inner`` so it only ever sees authenticated, allowed connections."""

    async def handler(websocket: Any) -> None:
        # Second line of defence: process_request already rejects these with
        # HTTP 403 on the real server.
        reason = handshake_violation(
            config, _request_headers(websocket), _local_port(websocket)
        )
        if reason is not None:
            await _reject(websocket, CLOSE_FORBIDDEN, reason)
            return
        if not config.insecure:
            try:
                first = await asyncio.wait_for(websocket.recv(), auth_timeout)
            except Exception:  # noqa: BLE001 - timeout, close or protocol error
                await _reject(websocket, CLOSE_UNAUTHENTICATED, "authentication required")
                return
            if not token_matches(config, first):
                await _reject(websocket, CLOSE_UNAUTHENTICATED, "authentication failed")
                return
            await websocket.send(json.dumps({"type": "authenticated"}))
        await inner(websocket)

    return handler


# ── runtime file for local scripts ───────────────────────────────────────


def default_runtime_dir() -> Path:
    override = os.environ.get(RUNTIME_DIR_ENV)
    if override:
        return Path(override)
    return Path.home() / ".nuclei" / "runtime"


def write_runtime_file(
    config: KernelAuthConfig, port: int, runtime_dir: Path | None = None
) -> Path | None:
    """Publish connection details (including the token) to a user-only file.

    Mirrors Jupyter's runtime files: local scripts read it to authenticate.
    Returns None in insecure mode, where there is no token to publish.
    """
    if config.token is None:
        return None
    directory = Path(runtime_dir) if runtime_dir is not None else default_runtime_dir()
    directory.mkdir(parents=True, exist_ok=True)
    if os.name == "posix":
        os.chmod(directory, 0o700)
    payload = json.dumps({
        "url": f"ws://localhost:{port}",
        "port": port,
        "pid": os.getpid(),
        "token": config.token,
    })
    path = directory / RUNTIME_FILE_NAME
    fd, temp_name = tempfile.mkstemp(dir=directory, prefix=".kernel-")
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(payload)
        if os.name == "posix":
            os.chmod(temp_name, 0o600)
        os.replace(temp_name, path)
    except BaseException:
        Path(temp_name).unlink(missing_ok=True)
        raise
    atexit.register(_remove_runtime_file, path, os.getpid())
    _install_cleanup_signal_handlers(path, os.getpid())
    return path


def _install_cleanup_signal_handlers(path: Path, pid: int) -> None:
    """Remove the runtime file on SIGTERM/SIGINT (atexit does not run for
    SIGTERM), then defer to whatever handler was installed before."""
    if threading.current_thread() is not threading.main_thread():
        return
    for name in ("SIGTERM", "SIGINT"):
        signum = getattr(signal, name, None)
        if signum is None:
            continue
        previous = signal.getsignal(signum)

        def handler(received, frame, _previous=previous, _signum=signum):
            _remove_runtime_file(path, pid)
            if callable(_previous):
                _previous(received, frame)
                return
            signal.signal(_signum, signal.SIG_DFL)
            os.kill(os.getpid(), _signum)

        try:
            signal.signal(signum, handler)
        except (ValueError, OSError):
            continue


def _remove_runtime_file(path: Path, pid: int) -> None:
    try:
        if json.loads(path.read_text()).get("pid") == pid:
            path.unlink()
    except (OSError, ValueError):
        pass


class StaleRuntimeFileError(RuntimeError):
    """The runtime file names a kernel process that is no longer running."""


def _pid_alive(pid: object) -> bool:
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def read_runtime_file(runtime_dir: Path | None = None) -> dict:
    directory = Path(runtime_dir) if runtime_dir is not None else default_runtime_dir()
    info = json.loads((directory / RUNTIME_FILE_NAME).read_text())
    if not _pid_alive(info.get("pid")):
        raise StaleRuntimeFileError(
            f"runtime file names pid {info.get('pid')!r}, which is not running; "
            "start a kernel or supply the token another way"
        )
    return info
