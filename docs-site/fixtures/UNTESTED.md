# Illustrative-only examples (not replay-tested)

Everything under `illustrative/` is rendered in the docs but **excluded from
the replay suite** because it requires real provider credentials or network
access. Each is labeled "illustrative" where it appears in the docs.

| Fixture | Shown on | Why untested |
|---------|----------|--------------|
| `illustrative/hardware_connect_azure.request.json` / `.responses.json` | kernel-api/messages-hardware | Requires a real Azure Quantum workspace; `connect` validates by listing targets over the network. |
| `illustrative/hardware_submit_azure_qsharp.request.json` / `.responses.json` | kernel-api/messages-hardware | Requires a connected Azure workspace and QIR submission to a live target; job id/timestamp are invented. |

`clients/example_client.ts` is also documentation-only — it mirrors
`example_client.py`, which **is** executed by the test suite against a live
server.

Everything else in `docs-site/fixtures/` is replayed against the real
`kernel.server.handle_message` by `kernel/tests/test_docs_fixtures.py`.
