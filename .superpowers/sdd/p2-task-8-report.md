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

## TDD evidence

Initial Python RED failed collection because `kernel.qec_data.jobs` did not
exist. Initial Rust RED failed because `commands::qec_data` was absent/private.
The later protocol-contract RED tests demonstrated that `import_validate`,
source byte-size disclosure, preview validation refusal, and import completion
counters were missing before their implementation. A Rust RED compile test also
demonstrated that status previously exposed a token-bearing endpoint rather than
a token-free URL.

## Verification

- Ruff format and lint: clean.
- Focused Python server suite: 32 passed on the installed WebSocket runtime.
- Compatibility: 32 passed with `websockets==12.0`; 32 passed with
  `websockets==13.1`.
- Owned Python coverage: 83.95% (jobs 98%, protocol 89%, server 80%).
- Complete QEC data suite: 374 passed, 2 skipped.
- Rust 1.77.2 locked lifecycle suite: 8 passed.
- Rust formatting: clean.
- Targeted Rust 1.77.2 clippy: clean with unrelated pre-existing lint classes
  explicitly allowed.
- All owned files are below 800 lines and all owned Python functions are below
  50 lines.

`python -m black` and `python -m bandit` were unavailable in the environment.
Repository-wide strict Clippy remains blocked by pre-existing out-of-scope
findings, beginning with `KernelState::new_without_default` in
`src-tauri/src/commands/kernel.rs`; the Task 8 target itself is clean.

## Security review

No secrets are hardcoded. Tokens are compared without being included in error
messages or serialized status, source boundaries are canonicalized before use,
JSON duplicate keys/non-finite values are rejected, and a port conflict is
reported without touching the existing listener.
