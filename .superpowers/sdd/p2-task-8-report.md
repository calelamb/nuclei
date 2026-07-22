# P2 Task 8 — Authenticated Local QEC Data Engine

## Outcome

Implemented a localhost-only QEC data WebSocket engine and an owned Tauri
lifecycle manager. The Tauri process generates a fresh 256-bit token for every
start, passes it only through the child environment, waits for bounded readiness,
and kills/reaps only the child it owns. Status serialization exposes the URL but
never the token.

The Python server requires authentication as the first frame, applies a 1 MiB
frame cap and exact request schemas, scopes/cancels jobs per connection, and
authorizes copy-only import sources relative to the project root. Traversal,
absolute paths, canonical QEC data paths, and symlinks are rejected.

## Protocol delivered

- `authenticate` / `authenticated`
- `import_probe` with `sourceByteSize`, source SHA-256, and `sourcePolicy: copy`
- `import_validate` / `import_validation_result` with `valid`, typed issues
  (`code`, `message`, `severity`, `field`), `sourceSha256`, `provenanceId`,
  `sourceByteSize`, and the copy policy
- `import_preview`, which refuses invalid mappings with the stable
  `import_validation_failed` error
- `import_start`, progress, and completion with records/partitions-written
  counters and copy-policy disclosure
- paginated `session_list`, bounded `query_start`, and owner-scoped `job_cancel`

Imports dispatch through the registered adapters, copy source bytes into the
canonical source area, write through the existing storage/catalog layer, and
atomically finalize manifests to a terminal status.

## Review corrections

The post-implementation security review produced one Critical and five
Important findings; all now have focused regressions and fixes:

- `qec_data_start` authorizes the canonical project and its QEC data paths
  against the invoking `WebviewWindow.fs_scope`. A running manager is bound to
  that canonical project and returns `project_mismatch` without leaking the
  existing endpoint token when another project asks to start it.
- Query cancellation calls both the cooperative token and
  `QecQueryEngine.cancel`, which interrupts the active DuckDB connection even
  though execution is inside `asyncio.to_thread`. Disconnect cleanup uses the
  same callback.
- Imports open the source relative to a project directory capability without
  following path components, copy and SHA-256 hash that one descriptor, validate
  the immutable copy, compare the adapter hash, and remove the copy on mismatch.
- The server accepts the first frame at the transport layer so an oversized
  unauthenticated frame is consistently closed as `4401`; later oversized
  frames remain capped and close as `1009`.
- Dispatch failures and non-query oversized responses retain the parsed
  `requestId`.
- Session IDs reject Windows separators/invalid path characters on every
  platform, and the canonical `qec-data` source component is rejected
  case-insensitively.

The Minor lifecycle concern was also fixed: dependency probing has a bounded
timeout and kills/reaps its owned probe process on expiry.

### Second review corrections

A second adversarial review identified four remaining namespace and lifetime
races. Each is now covered by a failing-before/fixed-after regression:

- Canonical import copies keep anchored directory and file descriptors for the
  job lifetime. The engine fingerprints the held descriptor and pathname before
  import, after adapter consumption, and through segment commit. A mutation can
  only produce a failed session; it cannot reach `COMPLETE`, even if an adapter
  returns cached batches with the original provenance.
- The WebSocket transport enforces the 1 MiB limit again. A bounded legacy
  protocol maps only a first-message `PayloadTooBig` to close code `4401` without
  reading the payload; post-authentication overflow remains the transport's
  `1009`. The inbound queue remains bounded at 16 messages.
- Probe, validation, and preview now run against anchored, descriptor-held
  snapshots (made read-only where the platform supports it). Results are
  released only after the held descriptor and visible pathname are reverified.
  Canonical source/snapshot directories and destination files are created
  through directory-relative operations, so ancestor swaps cannot redirect
  writes.
- Tauri packages the canonical path plus platform file identity into an
  `AuthorizedProjectRoot`. The manager verifies that identity without
  canonicalizing the renderer path again and fails with
  `project_identity_changed` if the authorized namespace entry was replaced.

### Final review corrections

- Every adapter operation now receives a path-compatible, read-only capability
  backed by a genuinely `O_RDONLY` descriptor, never the mutable canonical
  pathname. Unix populates a mode-0700 private temporary file, closes its writer,
  reopens it read-only with `O_NOFOLLOW`, and unlinks it. Windows duplicates the
  private writer handle with read-only access and marks it for handle-relative
  deletion. Tests verify the access mode and that `os.write` fails.
  The final source verification and manifest finalization execute as one
  synchronous operation. A regression temporarily replaces and restores the
  visible copy while a cached/lying adapter reads; the completed dataset still
  contains only the bytes held by the immutable capability.
- Canonical destination traversal begins at the retained project-root
  capability. Unix opens every component with `dir_fd` and `O_NOFOLLOW`.
  Windows uses `CreateFileW` handles with `FILE_FLAG_OPEN_REPARSE_POINT`, rejects
  reparse points, and omits delete sharing while every component is in use.
- Tauri retains the authorized project capability for the complete child
  lifetime. It passes Unix device/inode or Windows volume/file-index identity to
  the child. Python independently opens and verifies that identity at actual
  startup and retains its own root lock. A during-spawn namespace replacement
  returns `project_identity_changed` on Unix; Windows-only tests assert that the
  retained handles prevent namespace rename.

### Windows compatibility rereview

- Rust Windows identity no longer calls the post-1.77 `MetadataExt` identity
  methods. A stable `AsRawHandle` plus `GetFileInformationByHandle` FFI reads
  volume serial and file index from the retained handle itself.
- Arrow IPC file/stream and Parquet decoders recognize capability sources and
  pass a seekable `pa.PythonFile(source.open("rb"))` to PyArrow. Encoded-size,
  schema, batch-count, row-group, and decoded-size checks remain in place, and
  no mutable or synthetic pathname is exposed.
- Every Windows private-copy failure after named-file creation now marks the
  writer for deletion (with a pathname cleanup fallback) before propagating the
  copy or handle-duplication error.

## TDD evidence

Initial Python RED failed collection because `kernel.qec_data.jobs` did not
exist. Initial Rust RED failed because `commands::qec_data` was absent/private.
The later protocol-contract RED tests demonstrated that `import_validate`,
source byte-size disclosure, preview validation refusal, and import completion
counters were missing before their implementation. A Rust RED compile test also
demonstrated that status previously exposed a token-bearing endpoint rather than
a token-free URL.
The final descriptor RED failed because `CapabilitySource` exposed no verifiable
read-only descriptor; the fixed regression now checks both `F_GETFL` and a
failed direct write while retaining the lying-adapter ABA scenario.
Pathless Arrow/Parquet RED tests failed on PyArrow pathname conversion, and
copy/duplicate-failure RED tests left a named temporary behind; both paths are
covered by fixed-after regressions.

## Verification

- Ruff format and lint: clean.
- Focused Python server and review suites: 49 passed, 1 Windows-only skipped on
  the installed WebSocket runtime.
- Compatibility: 45 passed with `websockets==12.0`; 45 passed with
  `websockets==13.1`.
- Owned Python coverage: 85% (import operations 95%, jobs 98%, protocol 90%,
  server 89%, source security 76%).
- Complete QEC data suite: 394 passed, 3 skipped.
- Rust lifecycle suite: 13 passed.
- Complete Rust suite: 164 unit tests passed; the 13 lifecycle tests also pass
  serially (parallel lifecycle execution has a pre-existing fixed-port race).
- Rust formatting: clean.
- Targeted Rust 1.77.2 clippy: clean with unrelated pre-existing lint classes
  explicitly allowed.
- Windows evidence: the Win32 helper passes Ruff and `py_compile`; Python and
  Rust include Windows-targeted retained-handle tests. The Windows MSVC target
  was installed for Rust 1.77.2. Full Cargo check stops before project code
  because locked `zip 4.6.1` requires Rust 1.82; a harness including the actual
  `qec_data_project.rs` compiled successfully with `rustc +1.77.2 --target
  x86_64-pc-windows-msvc`. Current-stable Cargo progressed further but stopped
  in `ring` because this macOS host has no Windows SDK C headers.
- All owned files are below 800 lines (`server.py`: 776) and all owned Python
  functions are below 50 lines.

`python -m black` and `python -m bandit` were unavailable in the environment.
Repository-wide strict Clippy remains blocked by pre-existing out-of-scope
findings, beginning with `KernelState::new_without_default` in
`src-tauri/src/commands/kernel.rs`; the Task 8 target itself is clean.

## Security review

No secrets are hardcoded. Tokens are compared without being included in error
messages or serialized status, source boundaries are canonicalized before use,
JSON duplicate keys/non-finite values are rejected, and a port conflict is
reported without touching the existing listener.
