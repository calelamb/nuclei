"""Authentication and origin policy for the kernel WebSocket.

The kernel executes code it receives, so every connection must clear three
gates before any message reaches a handler:

1. ``Host`` must be a loopback name on the port the connection arrived on
   (defeats DNS rebinding).
2. ``Origin``, when present, must be on the allowlist (defeats cross-site
   WebSockets from a browser tab).  Non-browser clients send no Origin.
3. The first frame must be ``{"type": "authenticate", "token": ...}`` carrying
   the per-launch token, compared in constant time.  The token never travels
   in the URL.  The frame may also carry a client ``nonce``; the kernel then
   proves it knows the token by answering with
   ``{"type": "authenticated", "proof": HMAC-SHA256(token, nonce)}`` (hex), so
   a client can tell the real kernel from a process squatting the port.

The token comes from stdin (``NUCLEI_KERNEL_TOKEN_STDIN=1``, used by the
desktop shell) or from ``NUCLEI_KERNEL_TOKEN`` (manual and dev runs).

With no token configured the kernel refuses to start unless
``NUCLEI_KERNEL_INSECURE_DEV=1`` is set explicitly.
"""

from __future__ import annotations

import asyncio
import atexit
import hashlib
import hmac
import json
import os
import re
import signal
import sys
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping, TextIO

TOKEN_ENV = "NUCLEI_KERNEL_TOKEN"
# "1" means the launcher writes the token as one line on stdin (it carries no
# secret itself). The initial environment block of a process stays readable by
# same-user processes (sysctl KERN_PROCARGS2, /proc/<pid>/environ), so the
# desktop shell never puts the token there.
TOKEN_STDIN_ENV = "NUCLEI_KERNEL_TOKEN_STDIN"
INSECURE_ENV = "NUCLEI_KERNEL_INSECURE_DEV"
DEV_ENV = "NUCLEI_KERNEL_DEV"
STRICT_PORT_ENV = "NUCLEI_KERNEL_STRICT_PORT"
RUNTIME_DIR_ENV = "NUCLEI_RUNTIME_DIR"

RUNTIME_FILE_NAME = "kernel.json"
MIN_TOKEN_LENGTH = 32
MAX_TOKEN_LENGTH = 1_024
# A legitimate client sends `authenticate` as its first frame, immediately after
# the upgrade. Keep the window short so a local process cannot park the
# MAX_PRE_AUTH_CONNECTIONS slots for long.
AUTH_TIMEOUT_SECONDS = 3.0
# Until a connection authenticates it may only send the small authenticate
# frame; the normal message limit applies afterwards. The cap on unauthenticated
# connections stops a local process from parking thousands of idle sockets.
PRE_AUTH_MAX_SIZE = 8_192
MAX_PRE_AUTH_CONNECTIONS = 32
MIN_NONCE_LENGTH = 16
MAX_NONCE_LENGTH = 256

CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_BUSY = 4429

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


def read_token_from_stdin(stream: TextIO | None = None) -> str | None:
    """One line from ``stream`` (default stdin), stripped; None when empty."""
    source = sys.stdin if stream is None else stream
    try:
        line = source.readline()
    except (OSError, ValueError):
        return None
    return line.strip() or None


def config_from_env(
    env: Mapping[str, str] | None = None, stdin: TextIO | None = None
) -> KernelAuthConfig:
    """Read the auth setup from the environment (and stdin), failing closed."""
    env = os.environ if env is None else env
    if env.get(TOKEN_STDIN_ENV) == "1":
        token = read_token_from_stdin(stdin)
        if token is None:
            raise AuthConfigError(
                f"{TOKEN_STDIN_ENV}=1 but no token line arrived on stdin; "
                "refusing to start an unauthenticated kernel."
            )
    else:
        token = env.get(TOKEN_ENV) or None
    if env is os.environ:
        # Child processes (agent worker, user code) must not inherit the secret.
        os.environ.pop(TOKEN_ENV, None)
        os.environ.pop(TOKEN_STDIN_ENV, None)
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
    return {k: v for k, v in source.items() if k not in (TOKEN_ENV, TOKEN_STDIN_ENV, INSECURE_ENV)}


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


@dataclass(frozen=True)
class Authentication:
    """A successful authenticate frame; ``nonce`` is None for legacy clients."""

    nonce: str | None


def check_authentication(config: KernelAuthConfig, frame: object) -> Authentication | None:
    """Validate an authenticate frame; None means refuse the connection."""
    if config.token is None:
        return None
    try:
        value = json.loads(frame)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not isinstance(value, dict) or value.get("type") != "authenticate":
        return None
    supplied = value.get("token")
    if not isinstance(supplied, str) or not 1 <= len(supplied) <= MAX_TOKEN_LENGTH:
        return None
    if not hmac.compare_digest(supplied.encode(), config.token.encode()):
        return None
    if "nonce" not in value:
        return Authentication(nonce=None)
    nonce = value["nonce"]
    if not isinstance(nonce, str) or not MIN_NONCE_LENGTH <= len(nonce) <= MAX_NONCE_LENGTH:
        return None
    return Authentication(nonce=nonce)


def token_matches(config: KernelAuthConfig, frame: object) -> bool:
    return check_authentication(config, frame) is not None


def server_proof(token: str, nonce: str) -> str:
    """Hex HMAC-SHA256 keyed by the token over the client's nonce string."""
    return hmac.new(token.encode(), nonce.encode(), hashlib.sha256).hexdigest()


def authenticated_ack(config: KernelAuthConfig, authentication: Authentication) -> str:
    ack: dict[str, str] = {"type": "authenticated"}
    if authentication.nonce is not None and config.token is not None:
        ack["proof"] = server_proof(config.token, authentication.nonce)
    return json.dumps(ack)


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


def _raise_message_limit(websocket: Any, max_size: int | None) -> None:
    """Lift the pre-auth frame cap once the peer has authenticated.

    websockets reads the limit when its frame parser *starts* waiting for the
    next frame, so changing the attribute alone only affects the frame after
    next.  While the parser is idle (nothing buffered, no fragmented message in
    flight) it is therefore restarted so the very next frame gets the new
    limit.  The attribute is ``max_size`` up to websockets 15 and
    ``max_message_size`` from 16.
    """
    protocol = getattr(websocket, "protocol", None)
    if max_size is None or protocol is None:
        return
    updated = False
    for name in ("max_size", "max_message_size"):
        if hasattr(protocol, name):
            setattr(protocol, name, max_size)
            updated = True
    if not updated:
        return
    buffered = getattr(getattr(protocol, "reader", None), "buffer", None)
    idle = not buffered and not getattr(protocol, "cur_size", None) and not getattr(
        protocol, "current_size", None
    )
    if idle and callable(getattr(protocol, "parse", None)) and hasattr(protocol, "parser"):
        protocol.parser = protocol.parse()
        next(protocol.parser)


def secure_handler(
    inner: Handler,
    config: KernelAuthConfig,
    auth_timeout: float = AUTH_TIMEOUT_SECONDS,
    *,
    max_size_after_auth: int | None = None,
    max_pre_auth_connections: int = MAX_PRE_AUTH_CONNECTIONS,
) -> Handler:
    """Wrap ``inner`` so it only ever sees authenticated, allowed connections.

    The server is expected to be started with ``max_size=PRE_AUTH_MAX_SIZE``;
    ``max_size_after_auth`` is the limit applied once the peer authenticated.
    """
    pending = 0

    async def await_first_frame(websocket: Any) -> tuple[object | None, bool]:
        """Hold a pre-auth slot only while waiting for the first frame."""
        nonlocal pending
        pending += 1
        try:
            return await asyncio.wait_for(websocket.recv(), auth_timeout), True
        except Exception:  # noqa: BLE001 - timeout, close or protocol error
            return None, False
        finally:
            pending -= 1

    async def authenticate(websocket: Any) -> bool:
        if pending >= max_pre_auth_connections:
            await _reject(websocket, CLOSE_BUSY, "too many unauthenticated connections")
            return False
        first, received = await await_first_frame(websocket)
        # The slot is already free: closing a peer that never answers the close
        # handshake can take seconds and must not keep the slot occupied.
        if not received:
            await _reject(websocket, CLOSE_UNAUTHENTICATED, "authentication required")
            return False
        authentication = check_authentication(config, first)
        if authentication is None:
            await _reject(websocket, CLOSE_UNAUTHENTICATED, "authentication failed")
            return False
        await websocket.send(authenticated_ack(config, authentication))
        return True

    async def handler(websocket: Any) -> None:
        # Second line of defence: process_request already rejects these with
        # HTTP 403 on the real server.
        reason = handshake_violation(
            config, _request_headers(websocket), _local_port(websocket)
        )
        if reason is not None:
            await _reject(websocket, CLOSE_FORBIDDEN, reason)
            return
        if not config.insecure and not await authenticate(websocket):
            return
        _raise_message_limit(websocket, max_size_after_auth)
        await inner(websocket)

    return handler


# ── runtime file for local scripts ───────────────────────────────────────


def default_runtime_dir() -> Path:
    override = os.environ.get(RUNTIME_DIR_ENV)
    if override:
        return Path(override)
    return Path.home() / ".nuclei" / "runtime"


def per_port_file_name(port: int) -> str:
    return f"kernel-{_checked_port(port)}.json"


def _checked_port(port: object) -> int:
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65_535:
        raise ValueError(f"port must be an integer in 1-65535, got {port!r}")
    return port


def _write_private_atomic(directory: Path, name: str, payload: str) -> Path:
    """Write ``payload`` to ``directory/name`` as 0600 via temp file + rename."""
    path = directory / name
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
    return path


def write_runtime_file(
    config: KernelAuthConfig, port: int, runtime_dir: Path | None = None
) -> Path | None:
    """Publish connection details (including the token) to user-only files.

    Mirrors Jupyter's runtime files: local scripts read them to authenticate.
    Writes ``kernel-<port>.json`` (this kernel's own file, safe with several
    kernels running) and ``kernel.json`` (the "most recent kernel" pointer,
    last writer wins). Returns the pointer path, or None in insecure mode,
    where there is no token to publish.
    """
    port = _checked_port(port)
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
    # Cleanup first, so a failed second write never strands the per-port file (it holds the token).
    atexit.register(remove_runtime_files, directory, port, os.getpid())
    _install_cleanup_signal_handlers(directory, port, os.getpid())
    _write_private_atomic(directory, per_port_file_name(port), payload)
    return _write_private_atomic(directory, RUNTIME_FILE_NAME, payload)


def _install_cleanup_signal_handlers(directory: Path, port: int, pid: int) -> None:
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
            remove_runtime_files(directory, port, pid)
            if callable(_previous):
                _previous(received, frame)
                return
            signal.signal(_signum, signal.SIG_DFL)
            os.kill(os.getpid(), _signum)

        try:
            signal.signal(signum, handler)
        except (ValueError, OSError):
            continue


def _remove_if_owned(path: Path, pid: int) -> bool:
    """Delete ``path`` only when it records ``pid``; True if it was removed."""
    try:
        if json.loads(path.read_text()).get("pid") == pid:
            path.unlink()
            return True
    except (OSError, ValueError, AttributeError):
        pass
    return False


def remove_runtime_files(directory: Path, port: int, pid: int) -> None:
    """Clean shutdown: drop this kernel's files, never another kernel's.

    If the "latest kernel" pointer was ours, hand it to the newest kernel that
    is still running so port-less readers keep working.
    """
    directory = Path(directory)
    _remove_if_owned(directory / per_port_file_name(port), pid)
    if _remove_if_owned(directory / RUNTIME_FILE_NAME, pid):
        _repoint_to_live_kernel(directory)


PER_PORT_FILE_PATTERN = re.compile(r"^kernel-(\d{1,5})\.json$")


def _valid_per_port_record(name: str, text: str) -> bool:
    """A usable kernel record: right filename, matching port, token + url, live pid."""
    match = PER_PORT_FILE_PATTERN.match(name)
    if match is None:
        return False
    info = json.loads(text)
    return (
        isinstance(info, dict)
        and info.get("port") == int(match.group(1))
        and isinstance(info.get("token"), str)
        and isinstance(info.get("url"), str)
        and _pid_alive(info.get("pid"))
    )


def _repoint_to_live_kernel(directory: Path) -> None:
    live: list[tuple[float, str]] = []
    for candidate in directory.glob("kernel-*.json"):
        try:
            text = candidate.read_text()
            if _valid_per_port_record(candidate.name, text):
                live.append((candidate.stat().st_mtime, text))
        except (OSError, ValueError):
            continue
    if live:
        try:
            _write_private_atomic(directory, RUNTIME_FILE_NAME, max(live)[1])
        except OSError:
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


def read_runtime_file(runtime_dir: Path | None = None, port: int | None = None) -> dict:
    """Connection details of a running kernel.

    With ``port``, the kernel on that port (its per-port file, or the legacy
    pointer when that names the same port); never another kernel's token.
    Without it, the most recently started kernel.
    """
    directory = Path(runtime_dir) if runtime_dir is not None else default_runtime_dir()
    if port is None:
        info = json.loads((directory / RUNTIME_FILE_NAME).read_text())
    else:
        info = _read_for_port(directory, _checked_port(port))
    if not _pid_alive(info.get("pid")):
        raise StaleRuntimeFileError(
            f"runtime file names pid {info.get('pid')!r}, which is not running; "
            "start a kernel or supply the token another way"
        )
    return info


def _read_for_port(directory: Path, port: int) -> dict:
    try:
        info = json.loads((directory / per_port_file_name(port)).read_text())
    except FileNotFoundError:
        # Kernels from before per-port files only wrote the pointer.
        try:
            info = json.loads((directory / RUNTIME_FILE_NAME).read_text())
        except FileNotFoundError:
            info = None
        if not isinstance(info, dict) or info.get("port") != port:
            raise FileNotFoundError(f"no runtime file for a kernel on port {port} in {directory}") from None
        return info
    if not isinstance(info, dict) or info.get("port") != port:
        raise ValueError(f"runtime file for port {port} describes a different port")
    return info
