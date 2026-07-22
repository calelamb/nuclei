"""Authenticated localhost WebSocket server for canonical QEC data."""

from __future__ import annotations

import asyncio
import errno
import heapq
import os
import uuid
import weakref
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from websockets.exceptions import ConnectionClosed, PayloadTooBig
from websockets.legacy.server import WebSocketServer, WebSocketServerProtocol, serve

from .adapters.base import ImportChunk, ImportMapping
from .adapters.registry import AdapterRegistry, core_offline_registry
from .catalog import QecCatalog
from .hashing import DatasetSemanticIdentity
from .import_operations import (
    batch_summary,
    probe_result,
    require_copied_hash,
    require_valid_preview,
    validation_issue,
)
from .jobs import JobRegistry
from .model_codecs import (
    loads_canonical_json,
    session_from_mapping,
    session_to_mapping,
)
from .model_validation import SessionKind, SessionStatus, utc_now
from .models import QualifiedText, ValueStatus
from .protocol import (
    MAX_FRAME_BYTES,
    ClientRequest,
    MessageType,
    OutboundFrameTooLarge,
    ProtocolError,
    encode_frame,
    error_frame,
    parse_authentication,
    parse_request,
    query_requires_refinement_frame,
)
from .queries import (
    CancellationToken,
    QecQueryEngine,
    QueryCancelled,
    QueryError,
)
from .storage import SessionStorage
from .storage_durability import DurableMover
from .storage_lineage import SegmentKey, payload_kind
from .storage_journal import journal_segments, validate_journal
from .storage_metadata import publish_json
from .source_security import (
    close_project_directory,
    copy_authorized_source,
    open_project_directory,
    release_copied_source,
    remove_copied_source,
    resolve_authorized_source,
    secure_canonical_directory,
    verify_copied_source,
)
from .tiles import QueryRequiresRefinement


HOST = "127.0.0.1"
PORT = 9743
AUTHENTICATION_TIMEOUT_SECONDS = 2.0
MAX_JOBS_PER_CONNECTION = 8


class PortInUseError(RuntimeError):
    """The fixed data-engine endpoint is already owned by another process."""


class _BoundedServerProtocol(WebSocketServerProtocol):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._received_messages = 0

    async def read_message(self) -> Any:
        try:
            message = await super().read_message()
        except PayloadTooBig:
            if self._received_messages == 0:
                self.fail_connection(4401, "authentication required")
                raise asyncio.CancelledError
            raise
        if message is not None:
            self._received_messages += 1
        return message


@dataclass(frozen=True, slots=True)
class _ImportWriteSummary:
    segment_keys: tuple[SegmentKey, ...]
    records_written: int


class _Connection:
    def __init__(self, websocket: WebSocketServerProtocol) -> None:
        self.owner = uuid.uuid4().hex
        self.websocket = websocket
        self.send_lock = asyncio.Lock()

    async def send(self, value: Mapping[str, object] | str) -> None:
        frame = value if type(value) is str else encode_frame(value)
        async with self.send_lock:
            await self.websocket.send(frame)


class QecDataServer:
    def __init__(
        self,
        project_root: Path,
        token: str,
        *,
        host: str = HOST,
        port: int = PORT,
        authentication_timeout: float = AUTHENTICATION_TIMEOUT_SECONDS,
        registry: AdapterRegistry | None = None,
        expected_project_identity: tuple[int, int] | None = None,
    ) -> None:
        if type(token) is not str or not token or len(token) > 1_024:
            raise ValueError("authentication token is invalid")
        if host != HOST:
            raise ValueError("QEC Data Engine must bind to 127.0.0.1")
        if type(port) is not int or not 0 <= port <= 65_535:
            raise ValueError("server port is invalid")
        if authentication_timeout <= 0:
            raise ValueError("authentication timeout must be positive")
        root, project_descriptor = open_project_directory(
            project_root, expected_project_identity
        )
        self._project_root = root
        self._project_descriptor = project_descriptor
        self._project_finalizer = weakref.finalize(
            self, close_project_directory, project_descriptor
        )
        self._token = token
        self._host = host
        self._port = port
        self._authentication_timeout = authentication_timeout
        self._registry = registry or core_offline_registry()
        self._jobs = JobRegistry(max_jobs_per_owner=MAX_JOBS_PER_CONNECTION)
        self._server: WebSocketServer | None = None

    @property
    def url(self) -> str:
        if self._server is None or not self._server.sockets:
            raise RuntimeError("QEC Data Engine is not running")
        port = self._server.sockets[0].getsockname()[1]
        return f"ws://{self._host}:{port}"

    async def start(self) -> None:
        if self._server is not None:
            return
        secure_canonical_directory(
            self._project_root, self._project_descriptor, ("qec-data",)
        )
        try:
            self._server = await serve(
                self._handle_connection,
                self._host,
                self._port,
                compression=None,
                max_size=MAX_FRAME_BYTES,
                max_queue=16,
                close_timeout=1.0,
                server_header=None,
                create_protocol=_BoundedServerProtocol,
            )
        except OSError as error:
            if error.errno in {errno.EADDRINUSE, 48, 98, 10048}:
                raise PortInUseError("port_in_use") from error
            raise

    async def stop(self) -> None:
        server, self._server = self._server, None
        if server is not None:
            server.close()
            await server.wait_closed()

    async def serve_forever(self) -> None:
        if self._server is None:
            raise RuntimeError("QEC Data Engine is not running")
        await self._server.serve_forever()

    async def _handle_connection(
        self, websocket: WebSocketServerProtocol, _path: str | None = None
    ) -> None:
        connection = _Connection(websocket)
        if not await self._authenticate(connection):
            return
        try:
            async for frame in websocket:
                await self._handle_frame(connection, frame)
        except (ConnectionClosed, PayloadTooBig):
            pass
        finally:
            self._jobs.cancel_owner(connection.owner)
            await self._jobs.wait_owner(connection.owner)

    async def _authenticate(self, connection: _Connection) -> bool:
        try:
            frame = await asyncio.wait_for(
                connection.websocket.recv(), timeout=self._authentication_timeout
            )
            parse_authentication(frame, self._token)
        except ConnectionClosed:
            return False
        except (asyncio.TimeoutError, PayloadTooBig, ProtocolError):
            await connection.websocket.close(
                code=4401, reason="authentication required"
            )
            return False
        await connection.send({"type": "authenticated"})
        return True

    async def _handle_frame(self, connection: _Connection, frame: object) -> None:
        request_id: str | None = None
        try:
            request = parse_request(frame)
            request_id = request.request_id
            await self._dispatch(connection, request)
        except OutboundFrameTooLarge:
            await connection.send(
                error_frame(request_id, "response_too_large", "Response exceeds 1 MiB.")
            )
        except ProtocolError as error:
            await connection.send(
                error_frame(error.request_id or request_id, error.code, error.message)
            )
        except Exception:
            await connection.send(
                error_frame(
                    request_id,
                    "internal_error",
                    "QEC Data Engine request failed.",
                )
            )

    async def _dispatch(self, connection: _Connection, request: ClientRequest) -> None:
        handlers = {
            MessageType.IMPORT_PROBE: self._import_probe,
            MessageType.IMPORT_VALIDATE: self._import_validate,
            MessageType.IMPORT_PREVIEW: self._import_preview,
            MessageType.IMPORT_START: self._import_start,
            MessageType.JOB_CANCEL: self._job_cancel,
            MessageType.QUERY_START: self._query_start,
            MessageType.QUERY_CANCEL: self._query_cancel,
            MessageType.SESSION_LIST: self._session_list,
        }
        await handlers[request.message_type](connection, request)

    async def _import_probe(
        self, connection: _Connection, request: ClientRequest
    ) -> None:
        snapshot = await asyncio.to_thread(
            self._snapshot_source, request.payload["source"]
        )
        try:
            results: list[dict[str, object]] = []
            for registration in self._registry.registrations:
                adapter = self._registry.get(*registration.key)
                result = await asyncio.to_thread(adapter.probe, snapshot.capability)
                await asyncio.to_thread(verify_copied_source, snapshot)
                results.append(probe_result(registration, result))
            await connection.send(
                {
                    "type": "import_probe_result",
                    "requestId": request.request_id,
                    "results": results,
                    "sourceByteSize": snapshot.byte_size,
                    "sourcePolicy": "copy",
                }
            )
        finally:
            remove_copied_source(snapshot)

    async def _import_validate(
        self, connection: _Connection, request: ClientRequest
    ) -> None:
        payload = request.payload
        snapshot = await asyncio.to_thread(self._snapshot_source, payload["source"])
        try:
            adapter = self._registry.get(str(payload["adapterId"]))
            mapping = _import_mapping(payload["mapping"])
            validation = await asyncio.to_thread(
                adapter.validate, snapshot.capability, mapping
            )
            await asyncio.to_thread(verify_copied_source, snapshot)
            issues = [validation_issue(issue) for issue in validation.issues]
            await connection.send(
                {
                    "type": "import_validation_result",
                    "requestId": request.request_id,
                    "valid": validation.valid,
                    "issues": issues,
                    "sourceSha256": validation.source_sha256,
                    "provenanceId": validation.provenance_id,
                    "sourceByteSize": snapshot.byte_size,
                    "sourcePolicy": "copy",
                }
            )
        finally:
            remove_copied_source(snapshot)

    async def _import_preview(
        self, connection: _Connection, request: ClientRequest
    ) -> None:
        payload = request.payload
        snapshot = await asyncio.to_thread(self._snapshot_source, payload["source"])
        try:
            adapter = self._registry.get(str(payload["adapterId"]))
            mapping = _import_mapping(payload["mapping"])
            validation = await asyncio.to_thread(
                adapter.validate, snapshot.capability, mapping
            )
            require_valid_preview(validation, request.request_id)
            await asyncio.to_thread(verify_copied_source, snapshot)
            result = await asyncio.to_thread(
                adapter.preview, snapshot.capability, mapping, int(payload["limit"])
            )
            await asyncio.to_thread(verify_copied_source, snapshot)
            batches = [batch_summary(batch) for batch in result.batches]
            await connection.send(
                {
                    "type": "import_preview_result",
                    "requestId": request.request_id,
                    "batches": batches,
                    "truncated": result.truncated,
                    "totalRecords": result.total_records,
                    "sourceSha256": result.source_sha256,
                    "provenanceId": result.provenance_id,
                }
            )
        finally:
            remove_copied_source(snapshot)

    async def _import_start(
        self, connection: _Connection, request: ClientRequest
    ) -> None:
        prepared = await asyncio.to_thread(self._prepare_import, request.payload)

        async def run() -> None:
            await self._run_import(connection, request.request_id, prepared)

        try:
            self._jobs.start(connection.owner, request.request_id, run)
        except Exception:
            finalize_session_manifest(prepared[0].session_root, SessionStatus.FAILED)
            remove_copied_source(prepared[4])
            raise
        await connection.send(
            {
                "type": "job_started",
                "requestId": request.request_id,
                "jobId": request.request_id,
                "jobKind": "import",
                "sourcePolicy": "copy",
            }
        )

    async def _job_cancel(
        self, connection: _Connection, request: ClientRequest
    ) -> None:
        job_id = str(request.payload["jobId"])
        cancelled = self._jobs.cancel(connection.owner, job_id)
        await connection.send(
            {
                "type": "job_cancelled",
                "requestId": request.request_id,
                "jobId": job_id,
                "success": cancelled,
            }
        )

    async def _query_start(
        self, connection: _Connection, request: ClientRequest
    ) -> None:
        query = request.payload["query"]
        if type(query) is not dict or query.get("requestId") != request.request_id:
            raise ProtocolError(
                "invalid_request", "Query request IDs must match.", request.request_id
            )
        token = CancellationToken()
        session_id = str(query.get("sessionId", ""))
        storage = await asyncio.to_thread(
            SessionStorage.open, self._sessions_root(), session_id
        )
        catalog = QecCatalog(storage)
        engine = QecQueryEngine(catalog)

        async def run() -> None:
            await self._run_query(
                connection, request.request_id, query, token, catalog, engine
            )

        def cancel() -> None:
            token.cancel()
            engine.cancel(request.request_id)

        self._jobs.start(
            connection.owner,
            request.request_id,
            run,
            cancel_callback=cancel,
        )
        await connection.send(
            {
                "type": "job_started",
                "requestId": request.request_id,
                "jobId": request.request_id,
                "jobKind": "query",
            }
        )

    async def _query_cancel(
        self, connection: _Connection, request: ClientRequest
    ) -> None:
        query_id = str(request.payload["queryRequestId"])
        cancelled = self._jobs.cancel(connection.owner, query_id)
        await connection.send(
            {
                "type": "query_cancelled",
                "requestId": request.request_id,
                "queryRequestId": query_id,
                "success": cancelled,
            }
        )

    async def _session_list(
        self, connection: _Connection, request: ClientRequest
    ) -> None:
        payload = request.payload
        sessions, next_cursor = await asyncio.to_thread(
            self._session_page, payload["cursor"], int(payload["limit"])
        )
        await connection.send(
            {
                "type": "session_list_result",
                "requestId": request.request_id,
                "sessions": sessions,
                "nextCursor": next_cursor,
            }
        )

    def _authorized_source(self, raw_source: object) -> Path:
        return resolve_authorized_source(self._project_root, raw_source)

    def _prepare_import(self, payload: Mapping[str, Any]) -> tuple[Any, ...]:
        session_id = str(payload["sessionId"])
        adapter = self._registry.get(str(payload["adapterId"]))
        mapping = _import_mapping(payload["mapping"], session_id=session_id)
        sources_root = secure_canonical_directory(
            self._project_root,
            self._project_descriptor,
            ("qec-data", "sources"),
        )
        copied = copy_authorized_source(
            self._project_root,
            self._project_descriptor,
            sources_root,
            payload["source"],
            session_id,
        )
        try:
            verify_copied_source(copied)
            validation = adapter.validate(copied.capability, mapping)
            verify_copied_source(copied)
            require_copied_hash(validation, copied.sha256)
            provenance_id = validation.provenance_id or copied.sha256
            session = _importing_session(
                session_id,
                SessionKind(str(payload["sessionKind"])),
                adapter.manifest.id,
                adapter.manifest.version,
                provenance_id,
            )
            identity = _semantic_identity(copied.sha256, adapter, mapping)
            storage = SessionStorage.create(self._sessions_root(), session, identity)
            return storage, adapter, copied.path, mapping, copied
        except Exception:
            remove_copied_source(copied)
            raise

    async def _run_import(
        self,
        connection: _Connection,
        request_id: str,
        prepared: tuple[Any, ...],
    ) -> None:
        storage, adapter, source, mapping, copied = prepared
        remove_source = False
        try:
            await asyncio.to_thread(verify_copied_source, copied)
            summary = await _consume_import(
                storage, adapter.import_batches(copied.capability, mapping)
            )
            await asyncio.to_thread(verify_copied_source, copied)
            partitions = await asyncio.to_thread(
                storage.commit_segments, summary.segment_keys
            )
            await asyncio.to_thread(
                _finalize_verified_import, storage.session_root, copied
            )
            await connection.send(
                {
                    "type": "job_complete",
                    "requestId": request_id,
                    "jobId": request_id,
                    "recordsWritten": summary.records_written,
                    "partitionsWritten": len(partitions),
                    "sourcePolicy": "copy",
                }
            )
        except asyncio.CancelledError:
            finalize_session_manifest(storage.session_root, SessionStatus.PARTIAL)
            raise
        except Exception as error:
            remove_source = (
                isinstance(error, ProtocolError) and error.code == "source_changed"
            )
            finalize_session_manifest(storage.session_root, SessionStatus.FAILED)
            await connection.send(
                error_frame(request_id, "import_failed", "QEC data import failed.")
            )
        finally:
            release_copied_source(copied, remove=remove_source)

    async def _run_query(
        self,
        connection: _Connection,
        request_id: str,
        query: Mapping[str, object],
        token: CancellationToken,
        catalog: QecCatalog,
        engine: QecQueryEngine,
    ) -> None:
        try:
            await asyncio.to_thread(catalog.synchronize)
            events = await asyncio.to_thread(
                lambda: tuple(engine.execute(query, token))
            )
            for event in events:
                await connection.send(event.to_wire())
        except (QueryRequiresRefinement, OutboundFrameTooLarge):
            await connection.send(query_requires_refinement_frame(request_id))
        except QueryCancelled:
            await connection.send(
                error_frame(request_id, "query_cancelled", "Query was cancelled.")
            )
        except QueryError:
            await connection.send(
                error_frame(request_id, "query_failed", "QEC query failed.")
            )
        except Exception:
            await connection.send(
                error_frame(request_id, "query_failed", "QEC query failed.")
            )

    def _session_page(
        self, cursor: object, limit: int
    ) -> tuple[list[dict[str, object]], str | None]:
        root = self._sessions_root()
        root.mkdir(parents=True, exist_ok=True)
        after = "" if cursor is None else str(cursor)
        names = heapq.nsmallest(
            limit + 1,
            (
                entry.name
                for entry in os.scandir(root)
                if entry.name > after and entry.is_dir(follow_symlinks=False)
            ),
        )
        selected = names[:limit]
        sessions = [
            session_to_mapping(SessionStorage.open(root, name)._session)
            for name in selected
        ]
        next_cursor = selected[-1] if len(names) > limit else None
        return sessions, next_cursor

    def _sessions_root(self) -> Path:
        return secure_canonical_directory(
            self._project_root,
            self._project_descriptor,
            ("qec-data", "sessions"),
        )

    def _snapshot_source(self, raw_source: object):
        snapshots = secure_canonical_directory(
            self._project_root,
            self._project_descriptor,
            ("qec-data", "snapshots"),
        )
        return copy_authorized_source(
            self._project_root,
            self._project_descriptor,
            snapshots,
            raw_source,
            uuid.uuid4().hex,
        )


def _import_mapping(value: object, *, session_id: str | None = None) -> ImportMapping:
    if type(value) is not dict:
        raise ProtocolError("invalid_request", "Import mapping must be an object.")
    allowed = frozenset({"fields", "options", "expectedProvenanceId"})
    if not frozenset(value) <= allowed:
        raise ProtocolError("invalid_request", "Import mapping fields are invalid.")
    fields = value.get("fields", {})
    options = value.get("options", {})
    if type(fields) is not dict or type(options) is not dict:
        raise ProtocolError(
            "invalid_request", "Import mapping entries must be objects."
        )
    if not all(type(key) is str and type(item) is str for key, item in fields.items()):
        raise ProtocolError("invalid_request", "Import field mapping is invalid.")
    frozen_options = {key: _freeze_scalar(item) for key, item in options.items()}
    if session_id is not None:
        frozen_options = {
            **frozen_options,
            "session_id": session_id,
            "segment_id": "segment-0001",
        }
    expected = value.get("expectedProvenanceId")
    return ImportMapping(
        fields=tuple(sorted(fields.items())),
        options=tuple(sorted(frozen_options.items())),
        expected_provenance_id=expected,
    )


def _freeze_scalar(value: object) -> Any:
    if type(value) is list:
        return tuple(_freeze_scalar(item) for item in value)
    if value is None or type(value) in {str, bool, int, float}:
        return value
    raise ProtocolError("invalid_request", "Import option is not scalar JSON.")


def _importing_session(
    session_id: str,
    kind: SessionKind,
    adapter_id: str,
    adapter_version: str,
    provenance_id: str,
):
    from .models import SessionRecord

    created = SessionRecord.minimal(
        session_id, kind, adapter_id, adapter_version, provenance_id
    )
    return replace(
        created,
        status=SessionStatus.IMPORTING,
        started_at=QualifiedText(utc_now(), ValueStatus.MEASURED),
    )


def _semantic_identity(
    source_hash: str, adapter: Any, mapping: ImportMapping
) -> DatasetSemanticIdentity:
    options = dict(mapping.options)
    field_aliases = {
        "detector_events": "detectors",
        "observable_events": "observables",
    }
    fields = tuple(
        (field_aliases.get(name, name), source_name)
        for name, source_name in mapping.fields
    )
    if not fields:
        output = adapter.manifest.output_kinds[0]
        fields = (
            (("shots", "shots"),)
            if output == "campaign_points"
            else (("detectors", "detector_events"),)
        )
    bit_widths = tuple(
        (name, int(options[key]))
        for name, key in (
            ("detectors", "detector_count"),
            ("observables", "observable_count"),
        )
        if type(options.get(key)) is int and int(options[key]) > 0
    )
    if not bit_widths and any(name == "detectors" for name, _ in fields):
        raise ProtocolError(
            "invalid_request", "Detector width is required for import identity."
        )
    units = (
        (("timestamp", str(options["timestamp_unit"])),)
        if options.get("timestamp_unit")
        else ()
    )
    if not units and bit_widths:
        units = (("round", "index"),)
    return DatasetSemanticIdentity(
        source_sha256=(source_hash,),
        adapter_id=adapter.manifest.id,
        adapter_version=adapter.manifest.version,
        mapping=fields,
        bit_widths=bit_widths,
        units=units,
        time_domain="timestamp" if options.get("timestamp_unit") else "custom",
    )


async def _consume_import(
    storage: SessionStorage, batches: Iterator[ImportChunk]
) -> _ImportWriteSummary:
    keys: set[SegmentKey] = set()
    records_written = 0
    iterator = iter(batches)
    while True:
        chunk = await asyncio.to_thread(_next_chunk, iterator)
        if chunk is None:
            break
        await asyncio.to_thread(storage.append_chunk, chunk)
        keys.add(SegmentKey(payload_kind(chunk.payload), chunk.payload.segment_id))
        records_written += chunk.record_count
    if not keys:
        raise ValueError("import produced no canonical records")
    segment_keys = tuple(
        sorted(keys, key=lambda item: (item.record_kind, item.segment_id))
    )
    return _ImportWriteSummary(segment_keys, records_written)


def _next_chunk(iterator: Iterator[ImportChunk]) -> ImportChunk | None:
    try:
        return next(iterator)
    except StopIteration:
        return None


def finalize_session_manifest(session_root: Path, status: SessionStatus) -> None:
    if status not in {
        SessionStatus.COMPLETE,
        SessionStatus.PARTIAL,
        SessionStatus.FAILED,
    }:
        raise ValueError("session finalization requires a terminal status")
    manifest_path = session_root / "manifest.json"
    current = session_from_mapping(
        loads_canonical_json(manifest_path.read_text(encoding="utf-8"))
    )
    journal = validate_journal(
        loads_canonical_json(
            (session_root / "journal.json").read_text(encoding="utf-8")
        ),
        current.session_id,
    )
    committed_segments = tuple(
        sorted({str(item["segment_id"]) for item in journal_segments(journal)})
    )
    finalized = replace(
        current,
        status=status,
        completed_at=QualifiedText(utc_now(), ValueStatus.MEASURED),
        segments=committed_segments,
    )
    publish_json(
        manifest_path,
        session_to_mapping(finalized),
        DurableMover(),
        replace_existing=True,
    )


def _finalize_verified_import(session_root: Path, copied: Any) -> None:
    verify_copied_source(copied)
    finalize_session_manifest(session_root, SessionStatus.COMPLETE)


def main(argv: list[str] | None = None) -> int:
    from .server_entrypoint import main as run

    return run(argv)


if __name__ == "__main__":
    raise SystemExit(main())
