"""Persistent provider-credential storage backed by the OS keyring.

Credentials never live in the frontend's localStorage. The kernel receives
them via `hardware_set_credentials` / `hardware_connect`, saves them here,
and re-reads them on startup to auto-reconnect. The frontend only ever
tracks whether each provider is connected.

Backends (via the `keyring` package):
- macOS   : Keychain (login.keychain)
- Windows : Windows Credential Manager
- Linux   : Secret Service (gnome-keyring / KWallet)

If no keyring backend is available (some Linux VMs / headless CI), we
degrade to an in-memory map so the kernel continues to function; the
trade-off is that credentials won't survive a restart, but the user
still gets a working session.

Set `NUCLEI_DISABLE_CRED_STORE=1` in the environment to make save/load
no-ops — useful on shared dev machines.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

_LOG = logging.getLogger(__name__)

SERVICE_NAME = "nuclei"
# Tag entries so we can enumerate which providers have saved credentials
# without a per-provider guess. keyring itself doesn't expose a "list all
# entries for a service" API cross-platform, so we maintain a small index
# ourselves as a separate entry.
_INDEX_KEY = "__providers_index__"

# In-memory fallback when no keyring backend is available (headless CI,
# Docker without secret service, etc).
_memory_store: dict[str, str] = {}


def _disabled() -> bool:
    return os.environ.get("NUCLEI_DISABLE_CRED_STORE", "") == "1"


def _keyring_available() -> bool:
    try:
        import keyring
        _ = keyring.get_keyring()
        return True
    except Exception as exc:
        _LOG.warning("Keyring unavailable, using in-memory fallback: %s", exc)
        return False


def _set_raw(key: str, value: str) -> None:
    if _keyring_available():
        import keyring
        keyring.set_password(SERVICE_NAME, key, value)
    else:
        _memory_store[key] = value


def _get_raw(key: str) -> str | None:
    if _keyring_available():
        import keyring
        try:
            return keyring.get_password(SERVICE_NAME, key)
        except Exception as exc:
            _LOG.warning("Keyring read failed for %s: %s", key, exc)
            return None
    return _memory_store.get(key)


def _delete_raw(key: str) -> None:
    if _keyring_available():
        import keyring
        try:
            keyring.delete_password(SERVICE_NAME, key)
        except Exception:
            # Deleting a non-existent entry is fine — some backends raise;
            # treat as idempotent.
            pass
    else:
        _memory_store.pop(key, None)


def _load_index() -> list[str]:
    raw = _get_raw(_INDEX_KEY)
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return list(data) if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _save_index(providers: list[str]) -> None:
    # De-dupe while preserving order.
    seen: set[str] = set()
    unique: list[str] = []
    for p in providers:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    _set_raw(_INDEX_KEY, json.dumps(unique))


def save(provider: str, credentials: dict[str, Any]) -> None:
    """Persist credentials for a provider. Overwrites any existing entry."""
    if _disabled():
        return
    _set_raw(provider, json.dumps(credentials))
    index = _load_index()
    if provider not in index:
        index.append(provider)
        _save_index(index)


def load(provider: str) -> dict | None:
    """Read credentials for a provider, or None if none are stored."""
    if _disabled():
        return None
    raw = _get_raw(provider)
    if raw is None:
        return None
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else None
    except (json.JSONDecodeError, TypeError):
        return None


def clear(provider: str) -> None:
    """Remove stored credentials for a provider. Idempotent."""
    if _disabled():
        return
    _delete_raw(provider)
    index = _load_index()
    if provider in index:
        index.remove(provider)
        _save_index(index)


def list_providers() -> list[str]:
    """Providers with persisted credentials — used for auto-reconnect."""
    if _disabled():
        return []
    return _load_index()


def reset_memory_fallback_for_tests() -> None:
    """Clear the in-memory fallback store. Tests only."""
    _memory_store.clear()
