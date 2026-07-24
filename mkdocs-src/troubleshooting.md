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

**Not importable: requires SQLTools SSH tunnelling** means the source has `ssh: "Enabled"`. KX supports direct q IPC only and will not copy `sshOptions`, SSH credentials, or silently create a connection that bypasses the tunnel. Establish a separately managed secure tunnel and create an appropriate direct KX endpoint only if that matches your security policy.

## An imported connection was skipped or renamed

An existing KX profile with the same case-insensitive name or equivalent host/port/namespace/username is never overwritten. Choose **Skip (recommended)** to preserve it, or **Import as new name** to create a separate validated profile. There is no Replace action. KX checks again before writing and counts a newly conflicting candidate as skipped.

The final message reports imported, skipped, unsupported, and failed counts. Choose **Review Imported Connection** to inspect/test the saved direct profile. The SQLTools source remains unchanged and is not synchronized.

## An imported connection has no password or a different query timeout

When selected source profiles contain plaintext passwords, KX asks whether to copy them once into SecretStorage, import explicitly without passwords, or cancel. Choosing **Import Without Passwords** is intentional; edit the new KX profile to enter a password later. If the exact indexed source candidate is absent, no longer matches, or has an unavailable/invalid password during the confirmed re-read, that candidate fails safely.

Legacy `connectionTimeout` seconds map only to the imported profile's connect/handshake timeout. `0` remains disabled and an omitted value uses the old 30-second schema default. The per-profile query timeout remains blank and inherits the resolved global KX query default; it does not inherit the newly imported per-profile connect timeout. Edit the KX profile if it needs a separate query override.

## Sidebar says disconnected after failure

That is expected after a failed open, transport error, remote close, or explicit disconnect. Partial clients and stale opening promises are dropped, and the tree refreshes to the disconnected state. A subsequent run can connect again on demand.

## Query timed out

`vscode-kdb.queryTimeoutMs` controls the global query response deadline and defaults to `1800000` milliseconds (30 minutes). It is independent of the 30-second `vscode-kdb.connectionTimeoutMs` TCP connect/q IPC handshake default. The connection form's **Advanced direct q IPC** section can override either timeout for one profile; blank means use the corresponding global default, including for existing profiles whose query override is omitted.

The query timer begins only when this connection makes the queued query active and sends it. Time waiting behind an earlier query is not included. A query timeout drops the failed client so later work does not reuse an uncertain socket. Increase it only when the expected q workload justifies it, and inspect q-side performance first.

Every timeout must be an integer from `0` through `2147483647` milliseconds. Setting `queryTimeoutMs` to `0` disables only query response timing; setting `connectionTimeoutMs` to `0` disables only TCP connect and q IPC handshake timing. Diagnostics identify the phase, effective timeout/disabled state, and direct endpoint but omit query contents and credentials.

## Edited connection is disconnected

If a connected profile's host, port, username, password, or timeout changes, this is intentional lifecycle behavior. Save commits the safe profile and requested SecretStorage change first, then disconnects and reconnects using the saved values. If reconnect fails, the profile remains saved and KX warns that it is disconnected; it never keeps using the stale client.

Name and namespace-only changes do not recycle a healthy client. Validation errors, Cancel, or closing the form without saving do not change storage or the current session.

## A saved connection does not appear

Version 0.2.7 verifies the complete profile list after VS Code reports a settings write. A successful save immediately refreshes **KX Connections** and shows a confirmation; a failed or silent/no-op write keeps the form open, refreshes the tree, and shows both inline and VS Code errors. Distinct valid profiles all appear. The active row is marked `ACTIVE`; removing it leaves no active profile instead of silently choosing the first remaining row.

The Connections title toolbar intentionally contains Add and Refresh, not SQLTools import. Use **KX: Import SQLTools KDB Connections** from the Command Palette for one-time migration.

## q error appears in the result panel

Genuine q error payloads are decoded as errors and preserved. The panel shows endpoint context plus the q error instead of presenting it as a successful result row.

A genuine q evaluation error does not by itself discard an otherwise healthy IPC client. Transport/protocol failures do drop the uncertain client.

Reduce the expression in a q console when possible. Do not include sensitive production query text in a public report.

## Complete script fails on a q process

Version 0.2.7 does not require `.Q.ld` and does not reject a process by q release date. Whole documents, selections containing line breaks, and direct notebook cells are grouped on the client and sent as ordinary q `value` expressions. Normal q indentation, quotes/newlines within a group, comments, system commands, and the bare-`\` trailing script comment still determine what q accepts and executes.

Check the failing source in the configured namespace and inspect the genuine q error shown in KX Results. Direct notebook cells always use complete-cell script semantics; **Run Selection / Current Line** remains raw for a single physical line. KX does not replace q source semantics with a SQL parser.

The compatibility fixture proves the generated full direct-cell request has no `.Q.ld` dependency when that capability is absent. The available live test uses the installed modern q runtime, not an historical binary. Report the q version/build and exact source shape when filing an older-process issue; this release states no exact minimum q version and does not claim a live old-q run.

## Namespace behavior looks wrong

Open the connection and confirm **Database / Namespace** is `.` or a dot-qualified namespace such as `.analytics`. Editor paths temporarily switch to that namespace and restore the prior value. Errors are rethrown after restoration.

Script and complete-cell paths save the process's namespace, enter the configured namespace, evaluate each client-produced group, then restore the saved namespace after success or error. If a q system command deliberately changes namespace midway through a script, that change affects later groups during the same run; the outer wrapper still restores the pre-run namespace. Make such behavior explicit rather than relying on hidden editor state.

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

## KX q is missing from the notebook kernel/controller selector

Open an ordinary Jupyter `.ipynb`, then use its top-right kernel selector or **Notebook: Select Notebook Kernel**. The native entry is **KX q (Direct IPC)**. It is a controller/kernel choice, not an entry in the Python controller's per-cell language picker.

Confirm KX for VS Code 0.2.7 is enabled and VS Code is 1.96 or newer. The extension activates through `onNotebook:jupyter-notebook` and registers the controller dynamically through the public NotebookController API.

## Run q Cell (KX) is missing

The mixed-notebook action appears only for an actual q-language code cell while **KX q (Direct IPC)** is not selected. Keep Python selected and click **Make q Cell (KX)**; **Run q Cell (KX)** should replace it immediately. Do not switch the top-right kernel merely to mark the cell q.

The q status must show `KX: <profile> · Ctrl+Enter` (`Cmd+Enter` on macOS). If it shows **Select connection**, click the notebook `q default` target and choose a saved profile. A removed target is never replaced from list order. With **KX q (Direct IPC)** selected, the mixed actions/status deliberately disappear and normal Run owns q execution.

After a successful mixed run the notebook becomes dirty because KX commits the finished output as one supported, undoable notebook edit while Python remains selected. This replaces that q cell's internal handle but preserves its source, q language, metadata, and sibling cells. If the q cell or its output changes while the query is running, KX leaves the newer state alone and reports that it did not overwrite it.

If `Ctrl+Enter` / `Cmd+Enter` runs a customized action instead, use the visible **Run q Cell (KX)** toolbar/context command. User and keymap-extension bindings can override extension defaults. **Developer: Toggle Keyboard Shortcuts Troubleshooting** shows which rule VS Code selected.

The KX `Ctrl+Enter` / `Cmd+Enter` binding applies only while the q cell editor itself has text focus. With focus on the cell container or output, use the visible play/context action. Python and Markdown cells deliberately retain normal Jupyter shortcuts.

## Normal Run did not execute q through KX

That is expected while a Python controller is selected. Public notebook APIs select one controller for normal Run, so KX does not reroute Jupyter's action. Use **Run q Cell (KX)** for a q-language cell, or select **KX q (Direct IPC)** for a q-only notebook where normal Run should belong to KX.

## An existing cell is not q

Use **Make q Cell (KX)** while Python is selected, or run that command from the Command Palette before selecting **KX q (Direct IPC)**. Mixed-mode toolbar actions are suppressed once the native KX controller is selected. The controller supports q only; it does not silently rewrite or dispatch Python code.

The KX action uses VS Code's supported document-language API. Successful code cells have actual `TextDocument.languageId === "q"`; when saved as a non-default language, the built-in serializer records raw `metadata.vscode.languageId: "q"`. Markdown is skipped. A controller can still normalize that field when its kernel is selected.

## Tagging a q cell did not execute it

That is expected. **KX: Tag Notebook Cell as q** sets actual q language mode, inserts or preserves the durable `%%q --max-rows ... --max-bytes ...` marker, and merges `vscode-kdb` namespaced cell metadata. It does not execute.

The normal Python Jupyter controller does not advertise q and will not Run a q-language cell. Keep the marker, use **KX: Restore Notebook Cell Language** to return selected code cells to the notebook default/Python language, then use the notebook's normal Run action. IPython invokes the registered `%%q` helper. Kernel selection may perform the language normalization automatically.

If a q-language cell has no marker, use its **Prepare for Python kernel** status action first. This action is for a selected Python controller and is hidden under **KX q (Direct IPC)**. The direct controller rejects a leading `%%q`; remove it and run the complete ordinary q cell, or select the Python controller.

## Notebook KX output is invalid or shows the static fallback

The renderer accepts only `application/vnd.kx.result+json` version 1 within its strict schema and safety limits. Rerun with KX for VS Code 0.2.7 or the matching `kx_notebook` 0.2.7 helper. Unknown fields, invalid typed cells, inconsistent row/truncation counts, unsafe chart references, malformed JSON, and oversized payloads are rejected rather than partially trusted.

Direct-controller output includes `text/plain`, not `text/html`. The Python helper includes escaped `text/html` and `text/plain` fallbacks for viewers without the KX renderer. A static fallback is not evidence that arbitrary notebook interaction will survive export.

## Notebook preview is truncated

`vscode-kdb.notebook.maxOutputRows` defaults to `20` and accepts `1` through `10000`. Tables with 20 rows or fewer persist fully; larger tables keep headers/schema, a 20-row preview, total row count, and an explicit truncation notice. `vscode-kdb.notebook.maxOutputBytes` defaults to `1000000` and accepts `16384` through `10000000`. The portable contract additionally caps schema at 256 columns and cell text at 32,768 characters. The tag command writes the configurable values into the cell marker; either route may retain fewer rows/columns/cell characters and reports the truncation reason.

These settings bound persisted output only. They do not change the q expression or add a server-side limit. Apply a q-side limit or aggregation when necessary. A current direct result can retain omitted rows only in its transient live record; the notebook and hidden metadata contain no recoverable full value.

## Open in KX Results has only the preview

For a newly run direct q cell, **Open in KX Results** can use the full decoded value while its bound live record exists. If only the preview opens, the record is absent: rerunning replaces it, removing the cell removes it, notebook close removes it, deactivation clears it, the 512-record cap evicts oldest entries, and reopening starts with snapshot output only.

**KX: Open Saved Notebook Preview in Results Panel** transfers only the validated rows stored in the cell. The opaque ID is not an IPC handle and omitted rows cannot be recovered from a reopened notebook.

## Notebook chart changes did not persist

Chart configuration and zoom made only in the VS Code renderer are session state. Direct output does not persist a chart specification or HTML fallback. Configuration changes intentionally leave the previous rendered chart visible until **Render** is pressed. On the separate Python-helper route, persist a compatible `kx_notebook.Chart` specification when emitting the output, then rerun the cell; its static HTML/PDF fallback uses that specification to draw a network-free SVG. Neither route preserves interactive uPlot state.

## Notebook q used a different session than the `.q` editor

Check the selected notebook controller.

- **KX q (Direct IPC)** uses the active profile's existing extension client and namespace. Mixed-mode **Run q Cell (KX)** uses the notebook's explicit q target. Neither creates a connection per cell, and q assignments persist across cells that resolve to the same profile.
- A Python controller plus `%%q` uses only its configured Python-kernel evaluator or explicitly enabled PyKX object. It does not borrow the extension client, and helper output never receives a Direct IPC live-result identity. A user callback may independently target the same server, but that is not extension-managed state sharing.

Choose the intended route explicitly. KX never intercepts Python-controller Run; the q-cell action is a separate visible gesture.

## Query History is missing or incomplete

`vscode-kdb.features.queryHistory` defaults to `false`. Enable it for the current window/workspace to show the view. Only editor line, selection, and script executions actually issued while the feature is enabled are recorded; rejected pre-issue runs and result payloads are not.

Disabling the feature stops future writes and hides history commands, but does not silently erase sensitive retained text. Re-enable it and run **KX: Clear Query History** to confirm deletion. Storage is local workspace extension `Memento`, not Settings or Settings Sync. Lowering `vscode-kdb.queryHistory.maxEntries` prunes oldest entries beyond the new limit.

Rerun deliberately targets the current active connection through the normal configured-namespace pipeline. If its stable connection ID differs from the recorded entry, confirm the mismatch prompt or cancel. A renamed/removed recorded profile is labelled safely and never exposes a password.

## Live q check

Maintainers can run the direct live smoke path when a local q executable is available:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

Use `VSCODE_KDB_Q_BIN=/absolute/path/to/q` to select a non-default executable. The normal test harness includes deterministic notebook cell selection/language/default/marker/metadata and renderer-message contracts, connection-test, migration parser/fake configuration-provider/SecretStorage, qText, chart-reset, tree/history, grammar, source, and manifest guards. `npm run test:extension-host` adds scoped non-visual activation, isolated multi-profile configuration/active selection, and real notebook language conversion/restoration. It does not automate the connection webview, notebook toolbar/status/kernel selector, target QuickPick, or q execution. The Python helper has a separate isolated `uv`/`unittest` suite; no standalone visual UI E2E is claimed.

## Generated docs drift

Edit files under `mkdocs-src/`, then run the exact gate in `mkdocs-src/README.md`. Generated `docs/` is committed. The workflow builds and uploads an artifact but intentionally does not deploy or alter Pages settings.
