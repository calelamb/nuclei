# Illustrative-only examples (not replay-tested)

Everything under `illustrative/` is rendered in the docs but **excluded from
the replay suite** because it requires real provider credentials or network
access. Each is labeled "illustrative" where it appears in the docs.

| Fixture | Shown on | Why untested |
|---------|----------|--------------|
| `illustrative/hardware_connect_azure.request.json` / `.responses.json` | kernel-api/messages-hardware, hardware/azure-quantum | Requires a real Azure Quantum workspace; `connect` validates by listing targets over the network. |
| `illustrative/hardware_submit_azure_qsharp.request.json` / `.responses.json` | kernel-api/messages-hardware, hardware/azure-quantum | Requires a connected Azure workspace and QIR submission to a live target; job id/timestamp are invented. |

## Inline illustrative snippets on guide pages

These code blocks are written inline in MDX (they are guidance, not protocol
JSON) and are labeled illustrative where they appear:

| Snippet | Shown on | Why untested |
|---------|----------|--------------|
| Qiskit Bell circuit submitted to an Azure target | hardware/azure-quantum (Submitting Python) | Requires a connected Azure workspace and the `azure-quantum[qiskit]` plugin. |
| pandas/matplotlib sweep-analysis snippet | hardware/pipelines (Into analysis) | Plotting guidance only; depends on user-collected rows and optional deps. |

`clients/example_client.ts` is also documentation-only — it mirrors
`example_client.py`, which **is** executed by the test suite against a live
server. `clients/sweep_driver.py` **is** executed by the test suite
(`test_sweep_driver_against_live_server`).

Everything else in `docs-site/fixtures/` is replayed against the real
`kernel.server.handle_message` by `kernel/tests/test_docs_fixtures.py`.
