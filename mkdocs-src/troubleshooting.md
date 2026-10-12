# Troubleshooting

## Start with KX Output

Open **View > Output** and select **KX**. The channel records standalone connect, handshake, query, cancellation, and close phases, including explicit disconnect transitions. Endpoint context uses `host:port`; credentials and query text are omitted.

If **KX** is not yet in the Output picker, activate the extension by opening the KX sidebar or a `.q` file, then open Output again.

## q completion, diagnostics, or formatting is missing

Version 0.2.40 requires VS Code 1.101 or newer. Check `vscode-kdb.languageServer.enabled`, open **Output > KX**, and run **Developer: Reload Window** after upgrading from an older extension. TextMate syntax colors should remain even when server startup fails; server-backed completion, diagnostics, and formatting will not.

If definitions and reads of the same ordinary q data name still use different colors, verify that the installed KX extension is version 0.2.40 and reload the window. The extension now emits the same complete `variable` selector for those occurrences, but `editor.semanticTokenColorCustomizations` or a theme may intentionally style genuinely different roles such as functions, parameters, and qSQL columns differently.

Disable another q extension while diagnosing because overlapping completion, formatting, semantic-token, grammar, and `*.qnb` providers can conflict. To use this extension as the formatter, set `"[q]": { "editor.defaultFormatter": "DanielAlonso.vscode-kdb" }`.

For a file above `vscode-kdb.languageServer.maxFileSizeBytes`, the server deliberately skips expensive providers and publishes one bounded explanation. Increase the setting only when the workspace can afford the parse/index cost.

## qnb opens with the wrong extension or as text

Disable any other extension that also claims `*.qnb`, reload VS Code, then use **Reopen Editor With… > q Notebook** if necessary. This extension expects a top-level JSON cell array. Malformed, oversized, or unsupported shapes fail visibly and are never replaced with an empty notebook.

If a large result stops scrolling when autosave starts, verify version 0.2.40 in the extension installation that owns the current window (including the Dev Container). Earlier releases could repeatedly parse complete MIME output for every live scroll request and exhaust the remote Extension Host; the save then reports **Canceled**. Version 0.2.40 caches validation of identical bytes while keeping current ownership checks. Save completion still depends on host load and storage; `serialized` in **Output > KX** precedes the actual file write.

A plain zero-byte, BOM-only, or whitespace-only `.qnb` is the one exception: it opens with one empty q cell and is marked unsaved, but its bytes are not changed until Save. If this does not happen after installing 0.2.40, open Extensions in the same VS Code window, check the **Local - Installed** or remote **Installed** section that owns that window's Extension Host, and verify the KX details page reports version 0.2.40. From a command line attached to that same host/profile, `code --list-extensions --show-versions` should include `DanielAlonso.vscode-kdb@0.2.40`. Reload the window after replacing an older local or remote installation.

Distinct `.q` and `.qnb` artwork is available only as VS Code's contributed language-icon fallback. The selected file-icon theme has precedence and may show its own icon or suppress the fallback; this extension does not install or override a complete file-icon theme.

The `.qnb` controller uses the globally active direct-q profile and does not use Python or Jupyter. Remove a leading `%%q`; it belongs only to a Python-language mixed-notebook cell. Legacy `x-application/q-notebook` output remains saved unchanged and receives a visible fallback when no renderer can safely infer its q type.

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

`vscode-kdb.queryTimeoutMs` controls the global query response deadline and defaults to `3600000` milliseconds (60 minutes). It is independent of the 30-second `vscode-kdb.connectionTimeoutMs` TCP connect/q IPC handshake default. The connection form's **Advanced direct q IPC** section can override either timeout for one profile; blank means use the corresponding global default, including for existing profiles whose query override is omitted. Mixed q-cell execution and **KX q (Direct IPC)** both use the active profile's resolved value; neither adds an independent 30-second notebook query ceiling.

The query timer begins only when this connection makes the queued query active and sends it. Time waiting behind an earlier query is not included. A query timeout drops the failed client so later work does not reuse an uncertain socket. Increase it only when the expected q workload justifies it, and inspect q-side performance first.

Every timeout must be an integer from `0` through `2147483647` milliseconds. Setting `queryTimeoutMs` to `0` disables only query response timing; setting `connectionTimeoutMs` to `0` disables only TCP connect and q IPC handshake timing. Diagnostics identify the phase, effective timeout/disabled state, and direct endpoint but omit query contents and credentials.

## Edited connection is disconnected

If a connected profile's host, port, username, password, or timeout changes, this is intentional lifecycle behavior. Save commits the safe profile and requested SecretStorage change first, then disconnects and reconnects using the saved values. If reconnect fails, the profile remains saved and KX warns that it is disconnected; it never keeps using the stale client.

Name and namespace-only changes do not recycle a healthy client. Validation errors, Cancel, or closing the form without saving do not change storage or the current session.

## A saved connection does not appear

KX reads explicit User, Workspace, and Workspace Folder `vscode-kdb.connections` arrays. For the same stable ID, Folder overrides Workspace, which overrides User; inspect the profile's scope label before editing. Same-name/different-ID profiles remain distinct. If two sibling folders define the same ID differently, KX shows a conflict and chooses neither endpoint until the settings are corrected.

A resolved scoped VS Code settings or Memento update is success; KX does not reject a real save merely because an immediate read snapshot is stale. The tree uses coherent immediate state while delayed propagation catches up, then reconciles the merged scoped configuration. Causally newer or otherwise identifiable external values win immediately; pre-target or same-as-pending values use the bounded ambiguity policy below. A rejected settings or secret write keeps the form open, refreshes the tree, and shows both inline and VS Code errors while transactional rollback protects the previous state. The active row is marked `ACTIVE`; removing it leaves no active profile instead of silently choosing the first remaining row.

If KX says connection settings are still reconciling, VS Code exposed an old value that is indistinguishable from an outstanding saved occurrence. Wait for the last saved profile list to appear. If it does not, run **Developer: Reload Window** before adding, editing, or removing profiles. This conservative pause prevents an old snapshot from overwriting a resolved save; reload discards the in-memory ledger and reads persisted VS Code configuration.

The Connections title toolbar intentionally contains Add and Refresh, not SQLTools import. Use **KX: Import SQLTools KDB Connections** from the Command Palette for one-time migration.

## q error appears in the result panel

Genuine q error payloads are decoded as errors and preserved. The panel shows endpoint context plus the q error instead of presenting it as a successful result row.

A genuine q evaluation error does not by itself discard an otherwise healthy IPC client. Transport/protocol failures do drop the uncertain client.

Reduce the expression in a q console when possible. Do not include sensitive production query text in a public report.

## Complete script fails on a q process

Version 0.2.20 does not require `.Q.ld` and does not reject a process by q release date. Whole documents, selections containing line breaks, and direct notebook cells are grouped on the client and sent as ordinary q `value` expressions. Normal q indentation, quotes/newlines within a group, comments, system commands, and the bare-`\` trailing script comment still determine what q accepts and executes.

Check the failing source in the configured namespace and inspect the genuine q error shown in KX Results. Direct notebook cells always use complete-cell script semantics; **Run Selection / Current Line** remains raw for a single physical line. KX does not replace q source semantics with a SQL parser.

Generated full direct-cell requests do not depend on `.Q.ld`. Report the q version, build, and exact source shape when filing an older-process issue; the extension does not enforce an exact minimum q version.

## Namespace behavior looks wrong

Open the connection and confirm **Database / Namespace** is `.` or a dot-qualified namespace such as `.analytics`. Editor paths temporarily switch to that namespace and restore the prior value. Errors are rethrown after restoration.

Script and complete-cell paths save the process's namespace, enter the configured namespace, evaluate each client-produced group, then restore the saved namespace after success or error. If a q system command deliberately changes namespace midway through a script, that change affects later groups during the same run; the outer wrapper still restores the pre-run namespace. Make such behavior explicit rather than relying on hidden editor state.

## Form Test Connection failed

The form tests current unsaved values and reports the failing `validation`, `connect`, `handshake`, `namespace`, `query`, or `cancel` phase. Confirm the displayed safe host/port, q listener, credentials, namespace, and timeout values. A non-root namespace must already resolve to a q namespace; the test does not create one or install a server helper.

Starting a new test, saving, canceling, or closing the form cancels the previous temporary socket. An edit with a blank password reports when it used the saved SecretStorage value, without displaying that value. **Clear saved password** deliberately tests without it. Testing never saves the form or changes an active saved connection.

## Cancel did not stop server work

Panel/progress cancellation is local to the result wait. q computation or side effects already sent can continue, and other queued panel work is not canceled. Use **KX: Deactivate Connection** to clear the star, close that client's transport, and fail its outstanding queue, while remembering that server-side interruption is still best-effort.

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

The focused explorer is not a namespace browser or remote-administration surface. It has no built-in SSH/TLS, gateway, Insights, SQLTools, or `.session.sql` controls. See [Connections & SecretStorage](connections.md#focused-server-explorer) and [Architecture](architecture.md).

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

Install the exact released distribution into the Python 3.9-3.13 environment selected as the notebook kernel:

```sh
python -m pip install 'kx-notebook==0.1.0'
```

The distribution name is `kx-notebook`; the import/IPython extension name is `kx_notebook`. Load it and use its built-in direct q IPC:

```python
%load_ext kx_notebook
%kx connect localhost:5000
```

If `ModuleNotFoundError` persists, inspect `sys.executable` in the notebook and install into that interpreter. The companion connection is separate from extension-managed Direct IPC. Named profiles, a synchronous callback, separately installed/licensed PyKX, and a runtime-configured loopback broker are explicit alternatives; none discovers or borrows the extension connection.

## KX q is missing from the notebook kernel/controller selector

That is the expected default. Keep Python selected and use **Make q Cell (KX)**, activate one globally starred KX connection, then use **Run q Cell (KX)**. KX is intentionally absent from kernel candidates, but VS Code's top-right Jupyter selector itself remains.

For an explicit pure-q workflow, set the application-scoped `vscode-kdb.notebook.enableDirectController` setting to `true`. KX then registers the first-class optional **KX q (Direct IPC)** controller dynamically through the public NotebookController API. Turning the setting off disposes it; a previously saved KX selection cannot be restored while the controller is unregistered.

## Run q Cell (KX) is missing

In `.qnb`, this is intentional: use normal **Run Cell** or `Ctrl+Enter` (`Cmd+Enter` on macOS) through the dedicated preferred KX controller. The mixed action appears only for an actual q-language code cell in `.ipynb` while the optional **KX q (Direct IPC)** Jupyter controller is not selected. Keep Python selected and click the leading **Make q Cell (KX)** action; **Run q Cell (KX)** should replace it immediately. Do not switch the top-right kernel merely to mark the cell q.

The q status must show `KX: <profile> · Ctrl+Enter` (`Cmd+Enter` on macOS). If it shows **Activate connection**, click the notebook **Active** item and star a saved profile. Every run uses only that globally active profile; legacy notebook target metadata, list order, and connected non-active profiles cannot override it. Editing the active profile from port `5005` to `5000` routes the next run to `5000` and reconnects a stale client as needed. With the optional **KX q (Direct IPC)** controller selected, the mixed actions/status deliberately disappear and normal Run owns q execution.

After a successful mixed run the notebook becomes dirty because KX commits the finished output as one supported, undoable notebook edit while Python remains selected. This replaces that q cell's internal handle but preserves its source, q language, metadata, and sibling cells. If the q cell or its output changes while the query is running, KX leaves the newer state alone and reports that it did not overwrite it.

If KX reports that q already ran but the local output could not be applied or verified, inspect the current notebook output and the target q process before doing anything else. Do not blindly rerun a stateful query: the extension never reissues q during its bounded local output retry, but the original request may already have changed server state.

If `Ctrl+Enter` / `Cmd+Enter`, `Shift+Enter`, or `Alt+Enter` / `Option+Enter` runs a customized action instead, use the visible **Run q Cell (KX)** toolbar/context command. User and keymap-extension bindings can override extension defaults. **Developer: Toggle Keyboard Shortcuts Troubleshooting** shows which rule VS Code selected.

The three KX Enter bindings apply while the tracked q cell is selected in notebook command mode or its editor has text focus. `Ctrl`/`Cmd` runs and stays, `Shift` runs and moves next, and `Alt`/`Option` runs and inserts below; canceled or failed q runs do not move or insert. A no-argument command prefers the selected cell over a stale active text editor, and follow-up movement is relative to the cell that actually ran. Output focus does not match the bindings. Python and Markdown cells deliberately retain normal Jupyter shortcuts.

## Normal Run did not execute q through KX

For `.qnb`, confirm an active KX profile exists, then use normal Run again; the dedicated KX controller is always registered and preferred without enabling the optional Jupyter setting. For mixed `.ipynb`, this is expected while a Python controller is selected. Public notebook APIs select one controller for normal Run, so KX does not reroute Jupyter's action. Use **Run q Cell (KX)** for a q-language cell. If a pure-q Jupyter notebook should give normal Run to KX, explicitly enable `vscode-kdb.notebook.enableDirectController` and select **KX q (Direct IPC)**.

## An existing cell is not q

Use the leading **Make q Cell (KX)** action while Python is selected, or run that command from the Command Palette. Mixed-mode toolbar actions are suppressed only if the optional pure-q KX controller is enabled and selected. It accepts q code cells and does not silently rewrite or dispatch Python code.

The KX action uses VS Code's supported document-language API. Successful code cells have actual `TextDocument.languageId === "q"`; when saved as a non-default language, the built-in serializer records raw `metadata.vscode.languageId: "q"`. Markdown is skipped. A controller can still normalize that field when its kernel is selected.

## Tagging a q cell did not execute it

That is expected. **KX: Tag Notebook Cell as q** sets actual q language mode, inserts or preserves the durable `%%q --max-rows ... --max-bytes ...` marker, and merges `vscode-kdb` namespaced cell metadata. It does not execute.

Choose one route per cell. For extension-managed Direct IPC, keep the durable cell q-language, remove `%%q`, activate the intended KX profile, and use **Run q Cell (KX)**. For the released `kx-notebook==0.1.0` companion, create or keep a Python-language cell, type `%%q` as its first line, and use normal Jupyter Run. Do not repeatedly switch one Direct IPC cell between q and Python. The Tag/Prepare actions are editing aids and are not required by the released companion.

## Notebook KX output is invalid or shows the static fallback

The renderer accepts `application/vnd.kx.result+json` versions 1, 2, 3, and 4 within strict, backward-compatible schemas. Rerun with the current KX for VS Code or released `kx-notebook==0.1.0` (`import kx_notebook`). Unknown fields, invalid typed cells, inconsistent row/truncation counts, unsafe chart references, malformed JSON, and historical/Python-helper preview payloads outside their declared safety limits are rejected rather than partially trusted. Automatically persisted first-party v2/v3/v4 output may exceed helper-preview limits, but must contain every declared row/column and every cell must validate exactly.

Direct IPC output from the mixed runner or optional controller includes `text/plain`, not `text/html`. The Python helper includes escaped `text/html` and `text/plain` fallbacks for viewers without the KX renderer. Static fallbacks do not preserve interactive notebook behavior.

## Direct IPC reports an exact-encoding error

The portable v2 contract stores supported table rows and typed q cells exactly. Keyed tables are supported through validated structural key-column source ordinals, which also restore their visual cue after reopen. It deliberately rejects metadata that this contract cannot reconstruct: currently top-level dictionary container identity. Supported column-vector attributes persist exactly in v2/v3/v4. The error identifies the q type and a bounded value description. Return a supported row/cell shape from q; KX does not flatten, stringify, or silently save a bounded preview and call it complete.

## Historical or Python-helper notebook preview is truncated

`vscode-kdb.notebook.maxOutputRows` defaults to `20` and accepts `0` through `10000`; `vscode-kdb.notebook.maxOutputBytes` defaults to `1000000` and accepts `16384` through `10000000`. First-party Direct IPC rich v2/v3/v4 output remains complete at every row setting. Set rows to `0` to avoid retaining a duplicate decoded result in the session live cache; Tag/Prepare then writes a bounded `20`-row Python-helper fallback. Positive row settings retain the live cache and are written into the helper marker. The helper's bounded output keeps schema, total count, saved rows, and explicit truncation reasons. Preview transport additionally caps schema at 256 columns and cell text at 32,768 characters. Existing v1/v2 previews saved by older KX versions remain valid and are clearly identified as historical saved previews.

These settings do not change the q expression or add a server-side limit. They bound tagged Python-helper previews and static fallback material where applicable; they do not truncate authoritative rich output from a new first-party Direct IPC run. `maxOutputBytes` may bound `text/plain` or another static fallback, but the exact rich v2/v3/v4 payload remains complete or fails explicitly. Apply a q-side limit or aggregation when the full value should not materialize or be stored. A preview's omitted rows have no recovery handle in the notebook.

## Open in KX Results has only a historical saved preview

For a newly run direct q cell, **Open in KX Results** can use the full decoded value while its bound live record exists and can use the complete exact v2/v3/v4 payload after that live record is gone. Older v1/v2 preview bytes remain previews even when every declared preview row is present. **Rerun cell** executes the current cell source again through q, makes a new IPC call, and replaces the historical output with a new complete result; it never executes source copied from the preview.

**KX: Open Saved Notebook Result in Results Panel** transfers only the validated rows stored in the cell: bounded rows from a historical/Python-helper preview or every row of current first-party complete v2/v3/v4 output. The opaque ID is not an IPC handle, and rows omitted from a preview cannot be recovered from a reopened notebook. Rerun/replacement removes the previous live owner; native **Clear Cell Output** and **Clear All Outputs** remove output ownership too, so a cleared result cannot resurrect stale live data.

## Notebook chart changes did not persist

Chart configuration, navigator range, and zoom made only in the VS Code renderer are session state. Direct output does not persist a chart specification or HTML fallback. Configuration changes intentionally leave the previous rendered chart visible until **Render** is pressed. On the separate Python-helper route, persist a compatible `kx_notebook.Chart` specification when emitting the output, then rerun the cell; its static HTML/PDF fallback uses that specification to draw a network-free SVG. Neither route preserves interactive uPlot state.

## Notebook q used a different session than the `.q` editor

Check the selected notebook controller.

- **KX q (Direct IPC)** and mixed-mode **Run q Cell (KX)** both use the active profile's existing extension client, namespace, and effective query timeout. Neither creates a connection per cell, and q assignments persist across cells while that profile remains active.
- A Python controller plus `%%q` uses the companion's Python-process-owned direct IPC connection or an explicitly selected profile, callback, PyKX evaluator, or loopback broker. It does not borrow the extension client, and companion output never receives an extension live-result identity or output binding. An independent evaluator may target the same server, but that is not extension-managed state sharing.

Choose the intended route explicitly. KX never intercepts Python-controller Run; the q-cell action is a separate visible gesture.

## Query History is disabled or incomplete

The Query History view remains visible, and `vscode-kdb.features.queryHistory` defaults to `true`. Set it to `false` to opt out; its disabled status deliberately does not read or display retained entries. Editor line/selection/script and first-party Direct IPC `.qnb` or mixed-Jupyter q-cell commands actually issued while enabled are recorded; rejected pre-issue runs, metadata/preview work, renderer actions, Python-owned `%%q`, zero-mode notebook MIME, and all other result payloads are not.

Disabling capture stops future writes and disables history actions, but does not silently erase sensitive retained text. Re-enable it and run **KX: Clear Query History** to confirm deletion. Storage is local workspace extension `Memento`, not Settings or Settings Sync. Lowering `vscode-kdb.queryHistory.maxEntries` prunes oldest entries beyond the new limit.

Rerun deliberately targets the current active connection through the normal configured-namespace pipeline. If its stable connection ID differs from the recorded entry, confirm the mismatch prompt or cancel. A renamed/removed recorded profile is labelled safely and never exposes a password.

## Live q check

Maintainers can run the direct live smoke path when a local q executable is available:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

Use `VSCODE_KDB_Q_BIN=/absolute/path/to/q` to select a non-default executable. The normal test harness includes deterministic notebook cell selection/language/default/marker/metadata and renderer-message contracts, connection-test, migration parser/fake configuration-provider/SecretStorage, qText, chart-reset, tree/history, grammar, source, and manifest guards. `npm run test:notebook-cross` installs exactly `kx-notebook==0.1.0`, imports `kx_notebook`, and validates its emitted version-1 contract. `npm run test:extension-host` adds scoped non-visual activation, isolated multi-profile configuration/active selection, and real q-language/KX metadata persistence through save, close, and reopen. It does not automate the connection webview, notebook toolbar/status/kernel selector, or target QuickPick. `npm run test:notebook-results-visual` separately starts real q in an isolated VS Code + Xvfb session and keeps 11 validated screenshots covering light/dark row-striped tables and charts, trusted navigator window/edge dragging, navigator keyboard input, absence of Pan/Refine buttons, visible/hidden legends, readable dark axes, selector containment, absence of notebook per-cell result Settings controls, tracked-file reopen, live-full state, and all chart families. This visual acceptance is local Linux Extension Host/Xvfb plus loopback q only. Remote and devcontainer acceptance were not run; the Docker daemon is unavailable, so Docker-backed acceptance is blocked. The repository-local Python compatibility fixtures retain a separate isolated `uv`/`unittest` suite.

## Generated docs drift

Edit files under `mkdocs-src/`, then run the exact gate in `mkdocs-src/README.md`. Generated `docs/` is committed. The workflow verifies that generated output is current, uploads it as a GitHub Pages artifact, and deploys that artifact through the repository's `github-pages` environment on non-pull-request runs.

## Large table could not serialize the complete result

Older versions expanded every q table cell into repeated typed JSON wrappers. At 600,000 × 14 cells this can exceed Node’s single-string limit. Install version 0.2.42 or later in the environment running KX (for a Dev Container, install there and reload). Native tables with typed columns now use complete v4 packed columns at every size. Existing v1/v2/v3 files remain readable; v4 rich output needs reader 0.2.40 or later. Genuine memory/string exhaustion can still fail with an explicit resource error; `maxOutputRows = 0` avoids the duplicate raw live cache.

### Large notebook output is still large after upgrading

Version 0.2.42 removes the former one-million-cell cutoff: all supported native q tables with typed columns use lossless packed v4 output. A 60k × 14 result previously used verbose v2 typed cells while a 600k result used packed v4, which could make the smaller result larger. This was a storage-format difference, not persisted cache accumulation. Existing saved v2/v3 results remain in their original format until rerun. Check the extension version in the window's owning Dev Container/remote installation, reload, then rerun the intended cell to produce packed output. Nested vector cells can contain many more scalar values than rows × columns suggests. No fixed whole-file size cap is imposed, and values are not rounded or truncated to meet a target size.

## Configure GlitchTip or Sentry

Create or select a Node.js/JavaScript project in your existing GlitchTip/Sentry instance and copy its **project DSN**, including any reverse-proxy prefix. Configure the actual DSN in the User or Remote User setting for the KX extension host:

```json
{
  "vscode-kdb.diagnostics.sentryDsn": "https://PUBLIC_KEY@glitchtip.example.test/PROJECT_ID",
  "vscode-kdb.diagnostics.reportServerUrl": ""
}
```

The placeholder above must be replaced by the DSN issued by your project. KX uses an isolated Sentry SDK client for sanitized exception envelopes. Global process/console/network instrumentation, sessions, performance tracing, replay, profiling and usage/log telemetry stay disabled. KX reports handled failures from its own operations; it does not collect VS Code application errors or unrelated extension failures. Available KX generated artifact locations and line/column coordinates are tagged with the extension release. Server-side q source tracebacks, Python/Jupyter kernel traces and fatal extension-host crashes are outside this collector's coverage.

Network requests originate from the host running KX, which may be a remote SSH, Dev Container, WSL or Codespaces environment. That host must reach your server over normal verified HTTP(S). The GlitchTip web UI URL is not a project DSN. Do not embed administrative/API tokens in the extension configuration. Clear the DSN to stop delivery and collection for that destination. A failed delivery drops pending events and pauses that destination for one hour. Only a new eligible failure after the cooldown triggers another attempt; there are no timed retries or connectivity probes. Reporting connection failures are never reported as incidents. `vscode-kdb.diagnostics.failSilently` defaults to `true`; set it to `false` temporarily to inspect bounded reporting notices in Output > KX. Neither mode adds reporting popups. No destinations are shipped in the extension and environment variables such as `SENTRY_DSN` do not enable it.

Maintainers can run `npm run test:failure-reporting` for deterministic privacy/transport/SDK isolation fixtures and `npm run test:failure-reporting-host` for actual extension ingestion into loopback receivers in an isolated temporary VS Code profile. The host runner needs a compatible VS Code executable (`VSCODE_KDB_E2E_CODE`), a display (`VSCODE_KDB_E2E_DISPLAY`) or Xvfb, and any required runtime libraries (`VSCODE_KDB_E2E_LIBS`). It does not require a q server. The synthetic exception API exists only in ExtensionMode.Test with the explicit fixture flag; no production bug-report command is added.

For a separately authorized live project smoke, set `VSCODE_KDB_GLITCHTIP_SMOKE_DSN` to that project's HTTPS DSN and run `VSCODE_KDB_E2E_TESTS_PATH="$PWD/test/extension-host/failure-reporting-live.js" node scripts/run-extension-host-test.js --reporting-only` after compilation. This test alone reads that variable, configures the temporary profile, emits one handled KX exception, prints its event ID and restores the setting. Confirm that ID in the intended GlitchTip project before claiming live ingestion; capture/queue completion alone does not prove server receipt. Normal extension activation never reads the smoke variable.

The synthetic smoke now emits connect/start, handshake/success and query/start/failure breadcrumbs with one ephemeral operation ID and a sanitized nested network cause. Inspect the retained event's `kx.operation`, `kx.failureDetails`, `kx.resourceUsage`, `kx.heapStatistics`, `kx.versions`, `kx.libraries`, settings and breadcrumbs, plus standard runtime/OS contexts and build/surface/category tags. Query/source fixture strings must be absent. Missing facts are marked; q/Python versions are not probed. Clearing the temporary DSN is asserted before the isolated profile is removed.

### Matching a packaged build

`out/failure-build.json` is generated after compilation. It records SHA-256 hashes of the three exact first-party bundles, their combined reproducible `buildId`, release and resolved dependency versions. Compare the event's build tag with the metadata inside the tested VSIX before interpreting line/column coordinates. Recompiling modified code at the same release produces a different build ID. No repository/workspace content is attached to events.

The distributed build currently has no source maps. Do not manufacture maps or upload unrelated artifacts. If matching first-party maps are produced later, verify their exact bundle hashes/build ID, inspect the installed GlitchTip version's supported release-artifact workflow and use separately authorized project-scoped access. Maps are supplementary, never automatically uploaded by the extension; administrative credentials and user source must stay outside it.

## Diagnostic JSON receiver

`vscode-kdb.diagnostics.reportServerUrl` accepts a complete HTTP(S) URL without embedded userinfo. KX automatically posts `Content-Type: application/json`; any 2xx response counts as success. Redirects and non-2xx responses are dropped without retry. Provision the receiver separately; GlitchTip's envelope endpoint is not this JSON API. This first receiver contract has no bearer-auth setting; use appropriately controlled ingress.

A v1 request has this shape (values below are synthetic):

```json
{
  "schemaVersion": 1,
  "eventId": "0123456789abcdef0123456789abcdef",
  "sessionId": "fedcba9876543210fedcba9876543210",
  "timestamp": "2026-10-07T00:00:00.000Z",
  "component": "notebook",
  "operationName": "encode",
  "failure": {
    "exceptions": [{
      "type": "RangeError",
      "value": "Unstructured error message omitted",
      "frames": [{ "filename": "out/extension.js", "lineno": 10, "colno": 20 }]
    }]
  },
  "environment": { "kxVersion": "0.2.43", "vscodeVersion": "1.101.0" },
  "operation": { "operationId": "kx-12-1", "surface": "live-notebook",
    "phase": "encode", "status": "failed", "issued": true, "canceled": false },
  "breadcrumbs": [{ "component": "notebook", "operation": "query",
    "timestamp": "2026-10-07T00:00:00.000Z",
    "details": { "operationId": "kx-12-1", "status": "success", "durationMs": 12 } }],
  "omissions": ["electronVersion-unavailable"]
}
```

Environment fields, allowlisted numeric/boolean/enum settings and safe operation counts vary with availability. Extension inventory omission counts and missing-field markers make bounds explicit. Event IDs correlate with Sentry events when both sinks are configured; session IDs are ephemeral and do not survive extension activation. Reporter-status messages in **Output > KX** contain bounded status categories rather than destination credentials or server response bodies.
