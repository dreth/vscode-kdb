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

A `connect`-phase error generally indicates endpoint, routing, refusal, or timeout. A `handshake`-phase error means TCP connected but q IPC negotiation/authentication did not complete. Common causes include a non-q service on that port, rejected q credentials, a reset listener, or an incompatible intermediary. TCP connect and handshake each receive a separate full connect-timeout budget, so one does not consume the other's allowance.

Use **KX: Test Connection** to open a temporary client and perform the minimal safe response check. If authentication changed, use **Edit Connection**: leave the empty password input blank to keep its existing SecretStorage value, enter a replacement, or select **Clear saved password**. KX never sends the saved password back into the form.

## No SQLTools KDB import candidates were found

This is a normal low-noise result when no eligible legacy value exists. SQLTools does not need to be installed, but its old KDB profiles must still be present in VS Code's `sqltools.connections` setting at user, workspace, workspace-folder, or effective scope.

The importer recognizes only normalized `KDB`, `kdb+`, `kdb`, `kdb-sqltools`, and `DanielAlonso.kdb-sqltools` driver aliases. It deliberately ignores other SQLTools drivers before reading their endpoint or password fields. It also does not search `.session.sql`, SQLTools storage internals, extension APIs, or another machine. Settings Sync and source-setting lifecycle remain outside KX; there is no automatic discovery/import at startup.

## A SQLTools KDB profile is not importable

The review keeps recognized but unsupported candidates visible with a safe reason. Correct malformed source fields or create a KX profile manually when the legacy name, server, port, namespace, username, password type, or timeout cannot pass standalone validation.

**Not importable: requires SQLTools SSH tunnelling** means the source has `ssh: "Enabled"`. KX 0.2.2 supports direct q IPC only and will not copy `sshOptions`, SSH credentials, or silently create a connection that bypasses the tunnel. Establish a separately managed secure tunnel and create an appropriate direct KX endpoint only if that matches your security policy.

## An imported connection was skipped or renamed

An existing KX profile with the same case-insensitive name or equivalent host/port/namespace/username is never overwritten. Choose **Skip (recommended)** to preserve it, or **Import as new name** to create a separate validated profile. There is no Replace action in 0.2.2. KX checks again before writing and counts a newly conflicting candidate as skipped.

The final message reports imported, skipped, unsupported, and failed counts. Choose **Review Imported Connection** to inspect/test the saved direct profile. The SQLTools source remains unchanged and is not synchronized.

## An imported connection has no password or a different query timeout

When selected source profiles contain plaintext passwords, KX asks whether to copy them once into SecretStorage, import explicitly without passwords, or cancel. Choosing **Import Without Passwords** is intentional; edit the new KX profile to enter a password later. If the exact indexed source candidate is absent, no longer matches, or has an unavailable/invalid password during the confirmed re-read, that candidate fails safely.

Legacy `connectionTimeout` seconds map only to the imported profile's connect/handshake timeout. `0` remains disabled and an omitted value uses the old 30-second schema default. The per-profile query timeout remains blank and inherits the resolved global KX query default; it does not inherit the newly imported per-profile connect timeout. Edit the KX profile if it needs a separate query override.

## Sidebar says disconnected after failure

That is expected after a failed open, transport error, remote close, or explicit disconnect. Partial clients and stale opening promises are dropped, and the tree refreshes to the disconnected state. A subsequent run can connect again on demand.

## Query timed out

`vscode-kdb.queryTimeoutMs` controls the global query deadline. Its default is `null`, which inherits the 30-second `vscode-kdb.connectionTimeoutMs` value for compatibility. The connection form's **Advanced direct q IPC** section can override either timeout for one profile; blank means use the corresponding global default.

The query timer begins only when this connection makes the queued query active and sends it. Time waiting behind an earlier query is not included. A query timeout drops the failed client so later work does not reuse an uncertain socket. Increase it only when the expected q workload justifies it, and inspect q-side performance first.

Every timeout must be an integer from `0` through `2147483647` milliseconds. Setting one to `0` disables that deadline. Errors identify the `query` phase and direct endpoint but omit query contents and credentials.

## Edited connection is disconnected

If a connected profile's host, port, username, password, or timeout changes, this is intentional lifecycle behavior. Save commits the safe profile and requested SecretStorage change first, then disconnects and reconnects using the saved values. If reconnect fails, the profile remains saved and KX warns that it is disconnected; it never keeps using the stale client.

Name and namespace-only changes do not recycle a healthy client. Validation errors, Cancel, or closing the form without saving do not change storage or the current session.

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

## Form Test Connection failed

The form tests current unsaved values and reports the failing `validation`, `connect`, `handshake`, `namespace`, `query`, or `cancel` phase. Confirm the displayed safe host/port, q listener, credentials, namespace, and timeout values. A non-root namespace must already resolve to a q namespace; the test does not create one or install a server helper.

Starting a new test, saving, canceling, or closing the form cancels the previous temporary socket. An edit with a blank password reports when it used the saved SecretStorage value, without displaying that value. **Clear saved password** deliberately tests without it. Testing never saves the form or changes an active saved connection.

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

## Server Explorer is missing

Confirm `vscode-kdb.features.serverExplorer` is enabled and an active direct q IPC profile exists. The view and its commands are intentionally absent when the feature is off or there is no active profile. A disconnected active profile remains visible with reconnect guidance, but the explorer does not connect automatically merely to display metadata.

The focused explorer is not a namespace browser or remote-administration surface. Built-in SSH/TLS, gateway, Insights, SQLTools, and `.session.sql` controls are intentionally absent. Review [Connections & SecretStorage](connections.md#focused-server-explorer) and [Parity Roadmap & Architecture](parity-roadmap.md) before filing a compatibility report.

## Server Explorer refresh or table expansion failed

- Verify the active connection and configured namespace have not changed, then select **KX: Refresh Server Explorer**.
- Confirm the q user may run `tables[]`, inspect safe name/type metadata, and invoke `meta` for the selected table. A q permission error remains an error; the extension does not install a helper script or bypass server permissions.
- A missing object may have been dropped after refresh. Refresh instead of trusting stale tree data.
- Query timeouts and transport failures use the normal active profile rules and invalidate uncertain or stale data. Inspect **Output > KX** for the safe phase/namespace diagnostic.
- Cancel is local to the metadata wait. q work already issued may complete, and Refresh is required to retry.

Only standard q table and variable identifiers are shown as previewable objects. Functions/projections remain metadata-only because captured arguments are not honestly bounded by the preview setting. Non-standard names are omitted instead of being interpolated into executable q text.

## Preview may be large

Every Preview asks for confirmation. `vscode-kdb.serverExplorer.previewCellLimit` defaults to approximately `10000` table cells or `10000` outer list/dictionary items and accepts `1` through `1000000`. Nested values and scalars may still be large. Functions/projections are not previewed. Canceling the local wait does not interrupt work already sent to q.

## `%%q` is not registered

Install `python/kx_notebook` into the exact Python environment selected as the notebook kernel, then configure an evaluator and load the IPython extension:

```python
from kx_notebook import configure_evaluator

configure_evaluator(lambda source: my_existing_q_session(source))
%load_ext kx_notebook
```

The helper deliberately has no implicit q connection. If no callback is configured, it raises an actionable error instead of borrowing the extension's active connection. If using the optional PyKX adapter, install/configure/license PyKX separately and explicitly call `kx_notebook.pykx.configure_pykx()`.

## q is missing from the standard cell-language picker

The standard Jupyter cell-language picker is filtered by the selected controller/kernel. VS Code exposes no supported manifest field for advertising q specifically into that list. Use the q action in the code-cell toolbar, the notebook cell context menu, or **KX: Set Notebook Cell Language to q** in the Command Palette.

The KX action uses VS Code's supported document-language API. Successful code cells have actual `TextDocument.languageId === "q"`; when saved as a non-default language, the built-in serializer records raw `metadata.vscode.languageId: "q"`. Markdown is skipped. A controller can still normalize that field when its kernel is selected.

## Tagging a q cell did not execute it

That is expected. **KX: Tag Notebook Cell as q** sets actual q language mode, inserts or preserves the durable `%%q --max-rows ... --max-bytes ...` marker, and merges `vscode-kdb` namespaced cell metadata. It does not execute.

The normal Python Jupyter controller does not advertise q and will not Run a q-language cell. Keep the marker, use **KX: Restore Notebook Cell Language** to return selected code cells to the notebook default/Python language, then use the notebook's normal Run action. IPython invokes the registered `%%q` helper. Kernel selection may perform the language normalization automatically.

If a q-language cell has no marker, use its **Prepare for Python kernel** status action first. KX does not contribute a controller, intercept Jupyter keybindings/Run, or send the notebook cell through its direct q IPC connection.

## Notebook KX output is invalid or shows the static fallback

The renderer accepts only `application/vnd.kx.result+json` version 1 within its strict schema and safety limits. Rerun the cell with the matching 0.2.2 `kx_notebook` helper. Unknown fields, invalid typed cells, inconsistent row/truncation counts, unsafe chart references, malformed JSON, and oversized payloads are rejected rather than partially trusted.

The escaped `text/html` and `text/plain` fallbacks remain useful in viewers without the KX renderer. A static fallback is not evidence that arbitrary notebook interaction will survive export.

## Notebook preview is truncated

`vscode-kdb.notebook.maxOutputRows` defaults to `1000` and accepts `1` through `10000`. `vscode-kdb.notebook.maxOutputBytes` defaults to `1000000` and accepts `16384` through `10000000`. The tag command writes those values into the cell marker; the helper may retain fewer rows to honor the complete byte budget.

These settings bound persisted output only. They do not change the q expression or add a server-side limit. Apply a q-side limit or aggregation in the evaluator when necessary. Omitted rows are not in the notebook, hidden metadata, or an extension cache.

## Open in KX Results has only the preview

This is the intended 0.2.0 contract. **KX: Open Saved Notebook Preview in Results Panel** transfers only the validated rows already stored in the selected cell. It does not rerun q, locate a live result, share an IPC handle, or recover omitted rows. A reopened notebook can still hand off its saved preview precisely because that bounded data is portable.

Full large data remains only in the originating evaluator/session while it is available. Use normal `.q` editor execution when the extension's direct q session and live full-result panel are required.

## Notebook chart changes did not persist

Chart type/column/point-cap changes and zoom made only in the VS Code renderer are session state. Persist a `kx_notebook.Chart` specification when emitting the output, then rerun the cell. The static HTML/PDF fallback uses that emitted specification to draw a network-free SVG; it cannot preserve interactive uPlot state.

## Notebook q used a different session than the `.q` editor

Notebook execution and `.q` editor execution remain deliberately separate in 0.2.2. Changing a notebook cell to q affects its document language/highlighting, not its evaluator. The helper calls only its configured Python-kernel evaluator or explicitly enabled PyKX object. It does not share the extension's direct IPC session, and the extension does not open a second connection for notebook cells.

Extension-driven same-session routing would require supported execution ownership that the normal Jupyter controller does not expose here. It remains disabled rather than being approximated through unsupported interception. A future persistent q evaluator must bridge the active Python kernel's q session, not create a hidden separate q connection.

## Query History is missing or incomplete

`vscode-kdb.features.queryHistory` defaults to `false`. Enable it for the current window/workspace to show the view. Only editor line, selection, and script executions actually issued while the feature is enabled are recorded; rejected pre-issue runs and result payloads are not.

Disabling the feature stops future writes and hides history commands, but does not silently erase sensitive retained text. Re-enable it and run **KX: Clear Query History** to confirm deletion. Storage is local workspace extension `Memento`, not Settings or Settings Sync. Lowering `vscode-kdb.queryHistory.maxEntries` prunes oldest entries beyond the new limit.

Rerun deliberately targets the current active connection through the normal configured-namespace pipeline. If its stable connection ID differs from the recorded entry, confirm the mismatch prompt or cancel. A renamed/removed recorded profile is labelled safely and never exposes a password.

## Live q check

Maintainers can run the direct live smoke path when a local q executable is available:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

Use `VSCODE_KDB_Q_BIN=/absolute/path/to/q` to select a non-default executable. The normal test harness includes deterministic notebook cell selection/language/default/marker/metadata and renderer-message contracts, connection-test, migration parser/fake configuration-provider/SecretStorage, qText, chart-reset, tree/history, grammar, source, and manifest guards. Configuration and document-language behavior are tested with pure models and faithful fakes without launching a VS Code Extension Host. The Python helper has a separate isolated `uv`/`unittest` suite; neither suite claims visual or real Extension Host end-to-end evidence.

## Generated docs drift

Edit files under `mkdocs-src/`, then run the exact gate in `mkdocs-src/README.md`. Generated `docs/` is committed. The workflow builds and uploads an artifact but intentionally does not deploy or alter Pages settings.
