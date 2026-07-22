# Troubleshooting

## Start with KX Output

Open **View > Output** and select **KX**. The channel records standalone connect, handshake, query, cancellation, and close phases, including explicit disconnect transitions. Endpoint context uses `host:port`; credentials and query text are omitted.

If **KX** is not yet in the Output picker, activate the extension by opening the KX sidebar or a `.q` file, then open Output again.

For operation timings, temporarily enable:

```json
"vscode-kdb.performance.trace": true
```

Reproduce the problem, copy only the relevant records, review them for environment-sensitive metadata, and turn tracing off. The extension does not toggle the setting itself.

## Cannot connect

Confirm q is listening on the configured endpoint. For a loopback test:

```sh
q -p 127.0.0.1:5000
```

Then verify the standalone connection uses host `localhost` (or `127.0.0.1`) and port `5000`. Check that another process is not using the port and that firewalls permit the intended route.

A `connect`-phase error generally indicates endpoint, routing, refusal, or timeout. A `handshake`-phase error means TCP connected but q IPC negotiation/authentication did not complete. Common causes include a non-q service on that port, rejected q credentials, a reset listener, or an incompatible intermediary.

Use **KX: Test Connection** to open a temporary client and verify `1+1`. If authentication changed, use **Edit Connection** and explicitly replace or remove the SecretStorage value.

## Sidebar says disconnected after failure

That is expected after a failed open, transport error, remote close, or explicit disconnect. Partial clients and stale opening promises are dropped, and the tree refreshes to the disconnected state. A subsequent run can connect again on demand.

## Query timed out

The default `vscode-kdb.connectionTimeoutMs` is 30 seconds. A query timeout drops the failed client so later work does not reuse an uncertain socket. Increase the timeout only when the expected q workload justifies it, and inspect q-side performance first.

Setting the timeout to `0` disables it.

## q error appears in the result panel

Genuine q error payloads are decoded as errors and preserved. The panel shows endpoint context plus the q error instead of presenting it as a successful result row.

A genuine q evaluation error does not by itself discard an otherwise healthy IPC client. Transport/protocol failures do drop the uncertain client.

Reduce the expression in a q console when possible. Do not include sensitive production query text in a public report.

## Script requires newer q

Whole documents and selections containing line breaks use `.Q.ld` grouping and require q 4.0 dated 2023-03-28 or newer, or q 4.1t dated 2022-11-01 or newer.

Upgrade q, or execute a valid single-line expression using **Run Selection / Current Line**. The extension does not replace q script grouping with a SQL parser.

## Namespace behavior looks wrong

Open the connection and confirm **Database / Namespace** is `.` or a dot-qualified namespace such as `.analytics`. Editor paths temporarily switch to that namespace and restore the prior value. Errors are rethrown after restoration.

If code depends on a different namespace midway through a script, make that q behavior explicit in the script rather than relying on hidden editor state.

## Cancel did not stop server work

Panel/progress cancellation is local to the result wait. q computation or side effects already sent can continue, and other queued panel work is not canceled. Use **KX: Disconnect** to close that client's transport and fail its outstanding queue, while remembering that server-side interruption is still best-effort.

## Huge result is slow

Virtualization limits webview cells, but the complete IPC payload is decoded and retained. Apply q-side limits or aggregation. Search, sort, charting, copy/export, and local endpoints have separate safeguards documented in [Performance & Large Results](performance.md).

## Local data URL fails

- Confirm the panel still exists and its Data server badge says running.
- Copy a fresh URL after stop/restart; the token changes.
- Use `GET`, not another HTTP method.
- Use a slice when a full export exceeds its cell limit.
- Make a panel selection before calling a `selection.*` endpoint.

## Missing explorer, SSH, or SQLTools behavior

These are not hidden settings. Phase 1 has no object explorer, built-in SSH/TLS UI, SQLTools result target, SQLTools connection storage, or `.session.sql` workflow. Review [Parity Roadmap & Architecture](parity-roadmap.md) before filing a compatibility report.

## Live q check

Maintainers can run the direct live smoke path when a local q executable is available:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

Use `VSCODE_KDB_Q_BIN=/absolute/path/to/q` to select a non-default executable. The normal test harness is deterministic and does not claim visual/manual VS Code end-to-end coverage.

## Generated docs drift

Edit files under `mkdocs-src/`, then run the exact gate in `mkdocs-src/README.md`. Generated `docs/` is committed. The workflow builds and uploads an artifact but intentionally does not deploy or alter Pages settings.
