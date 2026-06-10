# Kernel protocol fixtures

Every request/response JSON example shown on the Kernel API docs pages
(`docs-site/src/content/docs/kernel-api/`) lives here as a fixture file and is
**replay-tested** against the real kernel handler by
`kernel/tests/test_docs_fixtures.py`. The docs pages import these files with
Vite `?raw` imports — protocol JSON is never pasted inline in MDX. If the
protocol changes, the test suite goes red before the docs can lie.

## File forms

| Form | Files | Meaning |
|------|-------|---------|
| Single exchange | `NAME.request.json` + `NAME.responses.json` | One request and the exact ordered list of response messages it produces. |
| Session | `NAME.session.json` | `[{"request": {...}, "responses": [...]}, ...]` — replayed in order over a single connection (one kernel `Executor`, shared hardware job state). Used for flows like connect → submit → results. |
| Clients | `clients/` | Runnable example clients. `example_client.py` is executed as a subprocess against a live in-process server by the test suite; `example_client.ts` mirrors it and is documentation-only. |
| Illustrative | `illustrative/` | Examples that need real credentials or hardware (Azure Quantum). Rendered in the docs, clearly labeled illustrative, **not** replayed. Inventory in [UNTESTED.md](./UNTESTED.md). |
| Worked examples | `examples/` | Complete Python examples embedded by the Extending guides (`toy_adapter.py`, `echo_provider.py`). Executed against the real `Executor` / `HardwareManager` by `kernel/tests/test_docs_examples.py`. |

## Matcher convention

Expected response values are **exact-match by default**. The protocol shape is
the thing under test, so objects must have **exactly the same key set** as the
actual response — extra keys fail. Markers handle nondeterminism:

| Marker | Matches |
|--------|---------|
| `"<any>"` | Any value (use for whole nondeterministic values: `measurements` counts, tracebacks, timestamps, `execution_time_ms`, large arrays). |
| `"<approx:X:TOL>"` | A number within `TOL` of `X` (floating-point amplitudes/probabilities). |
| `"<job-id>"` | The job id captured from the most recent `hardware_job_submitted` response in the same session. In later session **requests**, the harness substitutes the captured id for this placeholder. |

Arrays match element-wise at the same length (or use `"<any>"` for the whole
array). The matcher implementation (and its self-tests) is in
`kernel/tests/test_docs_fixtures.py` (`assert_matches`).

## Adding a fixture

1. Add `NAME.request.json` + `NAME.responses.json` (or a `.session.json`).
2. Run `python3 -m pytest kernel/tests/test_docs_fixtures.py -q` from the repo
   root — fixtures are auto-discovered, no test code changes needed.
3. Embed it in the relevant MDX page via a `?raw` import.

Fixtures whose `code` targets a Python framework (qiskit/cirq/cudaq) are
skipped when that framework is not installed (kernel CI installs none of
them). Q# fixtures always run — qdk is installed in CI.
