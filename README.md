# KX for VS Code

KX for VS Code is a standalone extension for working with kdb+/q directly in Visual Studio Code. It provides q language support, extension-owned direct q IPC connections, exact editor execution, Python-first mixed notebook actions, portable notebook snapshots, optional first-party server exploration and local query history, and a high-performance native result viewer.

Version 0.2.8 repairs multi-profile add/edit/remove and active-selection persistence when VS Code delays configuration snapshots. Resolved VS Code settings and Memento writes are accepted, immediate extension state remains coherent, and later configuration propagation or external edits are reconciled. Mixed notebooks now keep Python selected by default: make a cell q, choose an explicit saved KX target, and run it through Direct IPC without switching kernels. The optional legacy q-only controller is disabled by default, while 0.2.7's client-grouped, `.Q.ld`-independent complete-source behavior remains unchanged.

Documentation: [standalone user guide](mkdocs-src/index.md), [source-backed parity matrix](PARITY.md), [checked pre-0.2.0 cross-extension evidence](PARITY_RUN.md), and [parity rerun instructions](test/parity/README.md). The generated site is tracked under `docs/`; no Pages deployment is implied.

## Quick start

1. Start a local q process that listens for IPC connections:

   ```sh
   q -p 127.0.0.1:5000
   ```

   The common `q -p 5000` form listens on all network interfaces. Use it only on a trusted, firewalled machine; the loopback form above avoids exposing an unauthenticated local development process to the network.

2. Install KX for VS Code and open the **KX** activity-bar icon.
3. In **KX Connections**, choose **Add Connection**. The **KX Connection** form shows the direct host, port, namespace, optional authentication, and timeout overrides together. Enter a unique name, `localhost`, port `5000`, and `.` for the root namespace.
4. Choose **Test Connection** to test those unsaved values, then **Save Connection**, set it active, and connect. Opening a saved connection is also handled automatically when a query first needs it.
5. Open a `.q` file and run the current line, a selection, or the complete script.
6. If wanted, enable the disabled-by-default Server Explorer or Query History feature in VS Code Settings.

For notebooks, leave the Python Jupyter kernel selected. Click the leading **Make q Cell (KX)** action, choose one saved profile with **KX: Choose Notebook q Target**, then use **Run q Cell (KX)** or the focused q-cell shortcuts: `Ctrl+Enter` / `Cmd+Enter` runs and stays, `Shift+Enter` runs and moves to the next cell, and `Alt+Enter` (`Option+Enter` on macOS) runs and inserts a code cell below. Python cells keep normal Jupyter behavior for all three shortcuts. KX does not appear in the kernel picker by default; VS Code's top-right Jupyter kernel selector itself remains. See [Jupyter/IPython notebooks](#jupyteripython-notebooks).

The value shown as **Database / Namespace** is a q namespace, such as `.` or `.app`. Non-root editor wrappers and all Server Explorer requests temporarily apply that namespace and restore the connection's previous namespace; root editor queries retain transparent raw-q behavior.

## Connections

Connections belong to this extension and appear in the **KX Connections** sidebar. The sidebar and Command Palette provide these commands:

- **KX: Add Connection**
- **KX: Edit Connection**
- **KX: Remove Connection**
- **KX: Set Active Connection**
- **KX: Connect**
- **KX: Disconnect**
- **KX: Test Connection**
- **KX: Import SQLTools KDB Connections**

The sidebar title keeps the routine actions to **Add** and **Refresh**; SQLTools import remains Command Palette only. Every valid saved profile appears immediately. The active row has a star and uppercase `ACTIVE`; click a connection row, use its **Set Active Connection** action, or run the same command from the Command Palette to select it. No list-first profile is silently substituted when the active profile is removed.

Connection errors identify the failed `connect`, `handshake`, or `query` phase and direct host/port so endpoint, network, authentication, and q-listener problems can be distinguished. They do not include credentials or query contents.

### One-time SQLTools KDB migration

Run **KX: Import SQLTools KDB Connections** from the Command Palette to review legacy KDB profiles already saved in VS Code's `sqltools.connections` setting. It is intentionally absent from the routine Connections title toolbar. This is a one-shot import into KX-owned direct IPC profiles, not a SQLTools integration. SQLTools does not need to be installed or activated, the source setting is never changed, and there is no automatic or permanent synchronization.

Discovery inspects user, workspace, and workspace-folder configuration values as untrusted input. Equivalent candidates are deduplicated while every contributing source scope remains visible. Only these normalized legacy driver aliases are candidates: `KDB`, `kdb+`, `kdb`, `kdb-sqltools`, and `DanielAlonso.kdb-sqltools`. Connections for every other SQLTools driver are ignored before their endpoint, username, password, or other fields are inspected.

The KX-owned multi-select review shows the sanitized source name, direct `host:port`, namespace, source scope, whether a password is present, and timeout mapping. It never shows a password value. Malformed legacy KDB profiles remain visible with a safe non-importable reason. A profile whose `ssh` value is `Enabled` is shown as **Not importable: requires SQLTools SSH tunnelling**; KX does not copy `sshOptions`, SSH credentials, or create a direct profile that would bypass the required tunnel.

Import maps the SQLTools connection name to the KX name, `server` to host, `port` to port, `database` to the validated q namespace (default `.`), and `username` to username. The legacy `connectionTimeout` is seconds and maps only to KX `connectTimeoutMs` after checked multiplication by 1,000; `0` remains `0`, and an omitted value uses the old 30-second schema default. It never sets the profile's `queryTimeoutMs`: query timeout continues to inherit the global KX query default until the user explicitly edits it.

Existing KX profiles are safe by default. A conflict by name or equivalent direct endpoint offers only **Skip (recommended)** or **Import as new name**. The importer never replaces or overwrites a saved KX profile. The final name is validated again, and conflicts that appear before commit are skipped.

If a selected profile contains a plaintext password in VS Code settings, a modal prompt explains that KX can re-read it once and write it under the new connection's key in VS Code SecretStorage while leaving the SQLTools setting unchanged. Choose **Copy Passwords and Import**, explicitly choose **Import Without Passwords**, or cancel the entire import. KX never silently copies a password. Password values are not included in review labels, logs, diagnostics, telemetry, Query History, errors, result messages, snapshots, or `vscode-kdb.connections`, and temporary references are discarded after each attempt.

The completion message reports imported, skipped, unsupported, and failed counts, repeats that no ongoing sync exists, and offers **Review Imported Connection** to open the KX editor for review and testing.

### KX Connection form

**Add Connection** and **Edit Connection** open the same responsive, theme-aware **KX Connection** form instead of a sequence of VS Code prompts. Name, host, port, namespace/database, username, and password are visible together. Name and host are required, names are unique, port is an integer from `1` through `65535`, and namespace defaults to `.`. The help text explains that the endpoint is direct q IPC and that the database value is the q namespace used for editor runs.

The collapsible **Advanced direct q IPC** section provides optional per-connection **Connect / handshake timeout (ms)** and **Query response timeout (ms)** overrides. Leave a value blank to use its corresponding global default. Only whole numbers from `0` through `2147483647` are accepted; `0` disables only that deadline. No SSH, TLS, gateway, broker, keep-alive, or reconnect-policy controls are presented.

**Save Connection** is enabled only when the browser-level form checks pass, and every submitted message is validated again by the extension host before storage. Enter submits a valid form. Escape and **Cancel** close it without changing storage or the current connection. Labels, descriptions, an announced error region, invalid-field focus, and initial name-field focus support keyboard and screen-reader use. **Delete Connection** appears when editing and opens an explicit modal VS Code confirmation; the webview does not use browser `confirm`.

When editing a connection with a saved password, the password input is always empty and says to leave it blank to keep the existing secret. Enter a value to replace the secret, or select **Clear saved password** to delete it. The saved value itself is never sent back to the webview.

The visible **Test Connection** button validates and tests the current unsaved name, endpoint, namespace, username, password choice, and effective timeout overrides/defaults without saving the profile or touching its active client. It opens a separate temporary direct IPC socket, proves the handshake, validates a non-root namespace with a read-only expression while confirming the temporary session namespace is unchanged, performs a minimal response check, and closes the socket. Starting another test, saving, canceling, or closing the form cancels the older test; generation checks prevent late results from replacing current status. Status identifies validation, connect, handshake, namespace, query, or cancel without showing credentials or request text.

On Edit, a blank password may use the saved SecretStorage value for this test only; status says that a saved secret was used but never reflects it. Entered passwords remain in memory, and **Clear saved password** means test without that stored value. Testing never writes settings, SecretStorage, Query History, or diagnostics containing a credential.

### Timeout behavior

`vscode-kdb.connectionTimeoutMs` is the global connect/handshake default and remains `30000` milliseconds. The same complete budget applies separately to the TCP connect phase and then to the q IPC handshake phase. `vscode-kdb.queryTimeoutMs` is an independent query-response deadline and defaults to `1800000` milliseconds (30 minutes). A blank per-connection override—including an existing profile with no `queryTimeoutMs` field—inherits the corresponding global value; a per-connection `queryTimeoutMs` wins over the global query value.

The query timer starts when a queued query becomes active and is sent; time spent waiting behind an earlier query on the same connection is not included. A query timeout drops the uncertain socket. Every timeout accepts `0` to disable that timeout and is bounded at `2147483647` milliseconds. Setting the global query timeout to `0` does not disable the connect or handshake deadlines.

### Update lifecycle

Validation failures and Cancel leave both persisted data and any connected client unchanged. Safe profile writes are serialized to the application-scoped user setting. A resolved `WorkspaceConfiguration.update` or `Memento.update` is treated as success instead of requiring a same-turn `inspect()`/`get()` snapshot to change. The store keeps immediate in-extension state coherent while VS Code propagates the update, then reconciles with the effective setting; a rejected settings or SecretStorage write still triggers rollback.

An external value that is causally newer than the extension's observed target, or outside its outstanding acknowledgement ledger, supersedes optimistic state immediately. A value reported before the target is observed—or identical to an outstanding write—is causally ambiguous. After five seconds reads yield to the effective VS Code value, while the ordered ledger prevents add/edit/remove from erasing a newer resolved write. If that effective value differs from the last saved value, profile mutations pause until the last value appears; use **Developer: Reload Window** if it does not. Reload always starts from persisted VS Code configuration.

If a connected profile's host, port, username, password, or timeout changes, the old client is disconnected and a reconnect is attempted with the saved settings. A reconnect failure leaves the new profile saved, the client disconnected, and shows a warning; it does not restore or silently reuse the stale client. Name and namespace-only edits do not recycle an otherwise valid client. Deleting a connection removes its stored password and disconnects its client.

### Security model

Safe connection metadata is kept in the application-scoped global user setting `vscode-kdb.connections`: connection ID, name, host, port, database/namespace, username, and optional `connectTimeoutMs` / `queryTimeoutMs` overrides. Reads use VS Code's effective application configuration, while writes remain at the global user target. Passwords are never written to settings. Each password is stored under a connection-specific key in VS Code `SecretStorage`, using the credential protection provided by VS Code and the operating system at rest. Removing a connection removes its stored secret. Passwords are not included in extension logs, documentation samples, packaged files, connection errors, or saved-profile messages sent to the webview.

Direct q IPC is plaintext in transit, including authentication and query traffic. The standalone product does not add TLS, SSH tunnelling, or a gateway. Use loopback or a trusted private network, or establish a separately managed secure tunnel before connecting to a remote q process.

## Feature controls

The two optional sidebar features are independent and disabled by default:

```json
{
  "vscode-kdb.features.serverExplorer": false,
  "vscode-kdb.features.queryHistory": false
}
```

This keeps remote metadata queries, sidebar weight, and query-text persistence opt-in. Disabling a feature stops its provider and hides its view and commands. Disabling Query History also stops future writes, but does not silently erase existing workspace-local entries; re-enable it and run **KX: Clear Query History** to remove retained entries.

## Server Explorer

When `vscode-kdb.features.serverExplorer` is enabled and an active direct q IPC profile exists, **KX Server Explorer** appears separately from **KX Connections**. A disconnected profile remains visible with a clear reconnect status; metadata requests require it to be connected. The explorer is manual-refresh only: **KX: Refresh Server Explorer** queries the configured connection namespace, uses q-native `tables[]` for tables, and obtains variable/function names and safe type-category metadata without fetching their values. A name is shown as a function only when q's type metadata safely identifies it as one; other objects remain accurately labelled as variables.

Expanding a table explicitly runs `meta` in the same configured namespace and shows its column metadata. Permission failures, missing objects, disconnects, timeouts, cancellation, and connection or namespace changes replace or invalidate stale tree data and can be retried with Refresh. Cancel is local to the wait and does not interrupt q work already sent. The explorer does not auto-refresh, install server scripts, change persistent server state, or expose SSH, TLS, gateway, Insights, or namespace-browsing controls.

Preview is a separate confirmed action for a selected table or variable. Functions and projections are metadata-only because captured arguments can exceed any honest cell limit. Only standard q identifiers matching a letter followed by letters, digits, or underscores, up to 255 characters, are accepted; tree labels are never executed as arbitrary q text. `vscode-kdb.serverExplorer.previewCellLimit` defaults to `10000` and accepts `1` through `1000000`. Tables are capped server-side to approximately that many cells, while lists and dictionaries are capped to that many outer items. Scalars and nested values can still be large, so every preview displays a warning before opening the normal KX Results panel.

## Running q

The extension contributes minimal q language support for `.q` files and these editor commands:

| Command | Windows/Linux | macOS | Behavior |
| --- | --- | --- | --- |
| **KX: Run Selection / Current Line** | `Ctrl+Enter` | `Cmd+Enter` | Runs the selection exactly; without a selection, runs the complete current physical line exactly. |
| **KX: Run q Script** | `Ctrl+Alt+Enter` | `Cmd+Alt+Enter` | Runs the complete active `.q` document. |
| **KX: Run Selection in New Result** | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` | Runs the exact selection, or the exact current physical line when there is no selection, in a new result panel. |

Multiline selections are preserved as selected and use a small client-side q script-line grouper. There is no SQL parser, current-block inference, or hidden session-file behavior.

The extension owns its `.q` language contribution and TextMate grammar. Since 0.2.2 it recognizes a leading `%%q` line as a notebook directive while retaining normal q highlighting below it; ordinary `.q` token rules remain unchanged. `.k` is not associated with q: broadening that file association without a demonstrated, testable need could conflict with other VS Code language support. This basic language support is not a claim of a q language server, lint engine, source-document formatter, or full editor parity.

Whole-document runs, multiline selections, and direct notebook cells normalize line endings and group physical source lines on the client. An unindented source line starts a group and indented lines continue it; blank lines, line comments, `/` ... `\` block comments, top-level q system-command lines, and a bare `\` that begins q's trailing script comment retain their script meaning. The resulting groups execute in order through ordinary q `value`, and the final group supplies the result. Normal q indentation and source validity still belong to q. Single-line selections and current-line execution remain raw q queries.

For a script or complete cell, KX saves the process's current namespace, enters the configured namespace, evaluates the groups in the existing session, restores the saved namespace after success or q error, and rethrows genuine q errors. A system command inside the source still has normal q semantics and can affect later groups in that same run; the outer wrapper restores the pre-run namespace afterward. The generated request has no `.Q.ld` dependency and does not reject a process by q release date. Deterministic compatibility coverage simulates a process without `.Q.ld`, but the available live-q release check uses the installed modern q runtime. Version 0.2.8 therefore states no exact minimum q version and does not claim a live run against an historical q binary.

Queries use the active connection. A normal run replaces the active result panel; **Run Selection in New Result** keeps the existing panel and opens another.

Canceling a result wait is local and best-effort: the panel stops waiting immediately, but q computation or side effects already sent to the server can continue. It does not cancel other queued result panels on the same connection. Use **Disconnect** when you intentionally need to close that connection and fail its outstanding work.

## Jupyter/IPython notebooks

VS Code selects one execution controller for a notebook. Version 0.2.8 is Python-first by default: KX does not register its optional q-only controller, so it is absent from VS Code's kernel candidates unless explicitly enabled. The notebook's top-right Jupyter kernel selector still exists and remains owned by VS Code/Jupyter.

| Selected notebook kernel + cell | Use |
| --- | --- |
| Python selected + Python cell | normal Run |
| Python selected + q cell | **Run q Cell (KX)** / `Ctrl` or `Cmd`+`Enter` / `Shift+Enter` / `Alt+Enter` |
| Optional KX q selected + q cell | normal Run, only after enabling `vscode-kdb.notebook.enableDirectController` |

### Default: mixed Python and q

Keep the normal Python Jupyter controller selected. Python cells continue to use normal Jupyter Run and are never rewritten, intercepted, or sent to q. A non-q code cell shows the leading **Make q Cell (KX)** action; it changes that complete cell's language through the public VS Code API without changing the selected Python kernel. **KX: Restore Notebook Cell Language** returns it to the notebook default.

An actual q cell shows the leading **Run q Cell (KX)** play action and two compact status items. `KX: <profile> · Ctrl+Enter` (`Cmd+Enter` on macOS) runs the complete cell and stays. `Shift+Enter` runs it and moves to the next cell; `Alt+Enter` (`Option+Enter` on macOS) runs it and inserts a code cell below. `q default: <profile>` chooses the notebook-level direct KX target without switching kernels. The target picker lists saved profiles and labels the globally active profile as a convenience, but selection is explicit.

The `.ipynb` stores only the target's stable profile ID and safe display name—never host, port, namespace, username, password, credentials, or a connection object. Every run resolves that ID against current `ConnectionStore` data. Editing the same profile from port `5005` to `5000` therefore routes its next run to `5000`; the connection manager drops a stale endpoint client and reconnects when needed. Renames continue to resolve by ID. Active-profile changes do not override the saved notebook target, and a missing/removed target prompts for an explicit replacement instead of using the first or active profile.

Because Python still owns native notebook execution, the mixed KX action cannot create a native KX cell execution. It keeps the old output visible while q runs, then commits the finished KX output as one normal undoable notebook edit. That edit makes the notebook dirty until saved and gives the q cell a new internal VS Code cell handle; it preserves the q source, q language, cell metadata, and every sibling Python/Markdown cell. If the q cell source, language, output, or execution state changes while KX is waiting, the action refuses to overwrite the newer state. Mixed KX output deliberately has no native kernel execution order or timing badge.

While the q cell editor itself has text focus, KX preserves the normal notebook shortcut meanings: `Ctrl+Enter` / `Cmd+Enter` runs and stays, `Shift+Enter` runs successfully and moves to the next cell, and `Alt+Enter` / `Option+Enter` runs successfully and inserts a code cell below. Navigation or insertion occurs only after KX reports an executed result; canceled, busy, stale, or failed runs leave the cell position unchanged. Every binding requires a focused `vscode-notebook-cell` code editor whose language is exactly `q`, and the bindings stand down if the optional KX controller is selected. They cannot match Python, Markdown, ordinary files, cell-container focus, or output focus. In those other focus states, VS Code's normal notebook shortcuts remain in charge. A user or keymap-extension rule can override any default shortcut; the toolbar/context/Command Palette action remains the reliable fallback.

Mixed q cells use the notebook's explicit q target and the profile-keyed `ConnectionManager` session, so assignments and namespace state continue across q cells on the same target. The mixed status shows only the safe profile display name; endpoint and credentials are never notebook status or target metadata.

Connection, timeout, q, and decode failures are sanitized. Cancel before dispatch prevents the request. Cancel after synchronous IPC dispatch ends the local wait and reports that server work or side effects may continue; 0.2.8 does not claim server-side interruption. Direct notebook runs use the same client-side complete-source grouping, configured-namespace restoration, and ordinary q `value` execution as **Run q Script**, preserving 0.2.7 legacy-q compatibility.

Normal Run with a Python controller selected remains owned by Jupyter—even on a q-language cell—and is not a second KX trigger. Use the clearly labelled KX action for direct IPC. This avoids duplicate hidden routing and preserves normal Python-controller behavior.

### Optional q-only controller

Set `vscode-kdb.notebook.enableDirectController` to `true` only when a q-only native-controller workflow is wanted. KX then registers **KX q (Direct IPC)** through the public `vscode.notebooks.createNotebookController` API with ID `vscode-kdb.q-notebook-controller`, notebook type `jupyter-notebook`, and `supportedLanguages = ["q"]`. It appears in the normal kernel picker; ordinary **Run Cell**, **Run All**, and notebook shortcuts send complete q cells through the active KX profile. A leading `%%q` is rejected, Markdown is ignored, and non-q code is not sent to q.

Turning the setting off disposes the controller. A notebook that previously saved KX as its controller cannot keep forcing or restore that selection while the controller is unregistered. This controls only whether KX is a candidate; it does not remove or modify VS Code's top-right Jupyter kernel selector. No private Jupyter API, runtime import, or hidden command interception is used.

### q language and editing aids

q-language cells receive the extension's TextMate grammar. In the default workflow, the leading **Make q Cell (KX)** action performs that change without switching the Python kernel; actual q language is the hard scope for **Run q Cell (KX)** and its focused-editor shortcut. The optional direct controller also advertises q if enabled.

When an `.ipynb` is saved, VS Code's built-in Jupyter serializer represents a non-default cell language in raw cell metadata as `metadata.vscode.languageId: "q"`. This is serializer-owned persistence, not the `vscode-kdb` tag metadata. A selected Jupyter controller can still constrain or normalize cell languages; if a Python controller changes a cell back to Python, reapply q language before using the KX action.

There is no static notebook-controller contribution in `package.json`: `onNotebook:jupyter-notebook` activates the mixed runner when an ordinary Jupyter notebook opens, and the optional controller is created dynamically only when its setting is enabled. **KX: Restore Notebook Cell Language** changes selected code cells to the notebook default derived safely from `language_info.name` or `kernelspec.language`; for an ordinary IPython notebook that is Python. It refuses to guess when no registered default can be resolved and never changes Markdown.

### Live direct result and saved snapshot

A successful first-party Direct IPC notebook result—from the default mixed runner or optional controller—is available inline through the same result model used by normal editor results while its in-memory live record exists. q general null/no-value responses from assignments, declarations, and calls such as `hopen`, plus generic empty values, render as compact qText; a genuine zero-row q table retains its schema and table view.

The inline renderer and full panel now consume one KX Results UI contract for toolbar labels, output formats, chart families, settings definitions, state summaries, focus behavior, and theme tokens. A live table shows the same Output workflow—CSV, XLSX, TSV, JSON, NDJSON, HTML, and Markdown; Headers; Row #; Copy; Export; Chart; Columns; and Settings—with responsive wrapping/overflow for notebook width. XLSX remains export-only. With no selected rectangle, Copy or Export uses the full visible column set in its current order; otherwise it uses the selected range. Drag, Shift-range, keyboard navigation, three-state sort, bounded Search with Prev/Next, sticky headers/row numbers, vertical resizing, and stable two-axis virtualization remain available. Inline clipboard work is capped at 20,000 cells and 2,000,000 realized text characters, while copy/export uses the shared cell and estimated-byte confirmation guard and file export runs in the extension host.

Columns can be shown, hidden, reset, and moved with keyboard-accessible controls. Search, copy, export, charts, and live slice requests honor that visible order. The full panel additionally has the editor-width interactions that do not fit a cell output well: pointer column resizing/auto-fit, its draggable chart/table splitter, running-query controls, and the local data server.

Notebook Chart uses the same ordered capability contract: line, scatter, step, bar, box, and candlestick; X; one or more Y series; Group By only where supported; and distinct Open/High/Low/Close selectors for candlestick. Changing configuration leaves the previous chart visible until **Render**. Multi-series charts keep a visible legend whose swatches match the plotted lines and Y-series selector. Each legend button supports pointer and **Enter**/**Space** toggling, reports its pressed state, visibly marks hidden series, and preserves that state through compatible rerenders and settings changes. Axis labels/ticks and restrained grids use VS Code theme tokens instead of fixed light/dark colors, while the selector stays contained and scrollable at narrow widths. Drag zoom, live-handle zoom refinement, Reset zoom, PNG export through the extension save dialog, and stable legend-hidden series are supported; the chart stays below the grid so it never replaces useful table state. A saved preview can chart and reset only the bounded rows stored in the notebook—it cannot refine into omitted data.

The state badge is explicit. **Live full result** includes the live row/column count and **Open in KX Results** hands the same decoded in-memory result to the established full panel without rerunning q. **Saved preview** reports stored versus total rows. If the session-bound handle is absent, the renderer says that only the bounded preview remains and offers **Open saved preview** and **Rerun cell**. Opening or exporting that preview never implies ownership of omitted rows.

`vscode-kdb.results.*` is the common settings source for notebook output and the KX Results panel. Density/sizing, copy/export threshold, array formatting, qText and list/dictionary/object/function strategies, elapsed-time display, and chart source/precision/sampling settings use a validated renderer message contract. A supported setting changed inline writes the same global VS Code configuration and is broadcast to other KX notebook outputs and open panels. The durable numeric font-size value `0` remains unchanged in settings storage and messages, but the notebook UI presents it as **Auto** (use the VS Code font size). The Settings overlay is constrained and scrollable inside the output, has a visible **Close** action, closes with **Escape**, and returns focus to its summary control. Per-output selection, visible-column order, sort, search, height, chart selection, legend visibility, and zoom remain transient UI state.

The `.ipynb` never stores the full live q object. Direct output contains a bounded `application/vnd.kx.result+json` snapshot and `text/plain` fallback, constrained by `vscode-kdb.notebook.maxOutputRows` (20 by default) and `maxOutputBytes`, the portable contract's 256-column ceiling, and its 32,768-character cell-value ceiling. Tables with 20 rows or fewer persist every row. Larger tables persist schema/headers, exactly the bounded preview rows, total row count, and an honest truncation notice—never tens of thousands of hidden rows. qText, scalars, and other small values remain fully visible within the byte bound. Direct output does not add `text/html` or a persisted chart specification. Its opaque live-result identifier is not an IPC handle and cannot recreate data. Output metadata also carries an opaque binding identifier so extension-host actions target the exact cell output; direct output may reuse the live identifier as that targeting value. The binding contains no result data, connection data, credentials, or reopened live capability. Each live record is bound to its notebook URI and current cell URI for the extension-host session; mixed mode rebinds it after the output edit replaces the q cell handle. Rerunning or removing that cell replaces/removes its record, closing the notebook removes its records, and deactivation clears the store; a 512-record cap evicts the oldest record. Reopening or any expired association renders only the portable snapshot. Omitted rows cannot be recovered from notebook persistence.

The saved-result renderer keeps the same table hierarchy, shared output formats, visible-column controls, range behavior, and capability-checked chart workflow, but every action is limited to persisted rows. Its UI state does not write a chart specification or hidden full data back to the `.ipynb`. First-party Direct IPC results always remain inline beneath the cell, including after the live record expires. The `vscode-kdb.notebook.presentation` `inline`/`panel`/`both` automatic behavior applies only to Python-helper output.

### Separate Python `%%q` route

Install the released companion into the same Python 3.9-3.13 environment as the selected IPython/Jupyter kernel:

```sh
uv venv /tmp/vscode-kdb-kx-notebook
uv pip install --python /tmp/vscode-kdb-kx-notebook/bin/python 'kx-notebook==0.1.0'
```

The distribution name is `kx-notebook` and the import name is `kx_notebook`. The package is not bundled in the VSIX and the extension does not install or modify a kernel environment automatically.

Direct q IPC is built in. Start q separately, then load the package and connect from a Python cell:

```python
%load_ext kx_notebook
%kx connect localhost:5000
```

Keep the helper cell's language as Python and run it with the selected Python kernel:

```q
%%q --max-rows 20 --max-bytes 1000000
select from trade where date=.z.D
```

`%%q` is IPython syntax, so this is a Python-language cell even though its body is q. Do not turn a durable Direct IPC q-language cell into a `%%q` cell and back; choose one route per cell. Direct IPC q cells stay q and use **Run q Cell (KX)**, while companion cells stay Python and use normal Jupyter Run.

The package validates options and publishes `application/vnd.kx.result+json` version 1 together with escaped `text/html` and `text/plain` fallbacks. The saved bundle contains a typed bounded table preview, schema, total and preview row counts, safe label/elapsed metadata, explicit truncation reasons, and an optional chart specification. It never stores credentials, access tokens, passwords, IPC handles, or an unbounded full result.

The helper's MIME output uses the same compact renderer controls described above. An emitted chart specification persists in the notebook; renderer-only control changes and zoom remain local session state and do not rewrite the `.ipynb`. Re-emit the result with the desired chart specification to persist it. The HTML fallback contains the schema, row count, bounded saved rows, truncation notice, and a network-free static SVG for a supported persisted chart. Notebook HTML/PDF export is static and does not preserve arbitrary uPlot interaction.

`vscode-kdb.notebook.presentation` accepts `inline`, `panel`, or `both` and defaults to `inline` for Python-helper output. Direct IPC output always remains inline and offers a concise KX Results handoff. Reopened Python-helper output and any direct result whose live record has expired can hand off only the bounded rows stored in the notebook; that path cannot recover omitted rows.

The package's direct IPC connection, profiles, optional callback, optional PyKX adapter, and optional loopback broker adapter are all Python-process-owned alternatives. They never borrow the extension-managed connection or share its variables, namespace, session identity, live-result record, or output-binding metadata. Companion output is therefore a portable bounded preview, not a live-full extension result. No q runtime or PyKX binary is bundled.

The routes are explicit. By default, **Run q Cell (KX)** uses the notebook's chosen extension-managed Direct IPC target without changing the selected Python controller, while normal Run remains Python/Jupyter. If the q-only controller is explicitly enabled and selected, normal q-cell Run uses the active profile. The optional `%%q` companion is a separate Python-kernel-owned route and does not share either extension Direct IPC session by implication. See the complete [notebook guide](mkdocs-src/notebooks.md).

## Query History

When `vscode-kdb.features.queryHistory` is enabled, issued editor executions are stored newest first in **KX Query History**. Recording starts only after a line, selection, or script is actually sent. Each local entry contains the exact query text, stable connection ID and recorded label, timestamp, execution kind, status (`succeeded`, `failed`, or `canceled` after an issued run's local wait is canceled), and duration; result payloads and passwords are never stored. Runs that never reach q are not recorded.

History uses VS Code workspace `Memento` storage on the local machine. It is not written to user or workspace settings, registered for Settings Sync, transmitted as telemetry, or sent anywhere except when the user explicitly reruns that q text. `vscode-kdb.queryHistory.maxEntries` defaults to `100` and accepts `1` through `1000`; lowering it prunes the oldest retained entries.

Entry actions rerun, copy, insert into the active editor, or delete one entry. **KX: Clear Query History** requires confirmation. Rerun uses the same exact q execution, active-connection, configured-namespace, timeout, cancellation, error, diagnostic, and result pipeline as editor execution. After normal connection selection resolves the target, KX confirms every mismatch with the recorded stable ID—even when no profile was active or the recorded profile was removed—before issuing text. Renamed or removed profiles remain safely identified without exposing credentials.

## Result panel

Normal `.q` editor results open in the KX-owned viewer; there is no alternate SQLTools result target. A live Direct IPC notebook result from the mixed runner or optional controller can open the same full in-memory model in the viewer while its record exists. A saved/reopened notebook can hand off only its bounded preview, which does not restore omitted data. The viewer includes:

- columnar result storage and row virtualization for responsive large-table browsing;
- native q scalar, vector, dictionary, keyed-table, table, and text/function presentation, with configurable grid or q-text display where appropriate;
- cell/range selection, keyboard navigation, search, sorting, column visibility and sizing, and compact-to-comfortable density controls;
- copy and export for selections or full results, including CSV, XLSX, TSV, JSON, NDJSON, HTML, Markdown, and plain text as applicable;
- line, scatter, step, bar, box, and candlestick charts, grouped series, zoom/refinement, and PNG export; and
- an opt-in, tokenized local data endpoint bound only to `127.0.0.1` for controlled CSV/JSON/NDJSON access to the current result.

Large copy, export, rendering, and chart operations have configurable safety limits. The viewer exposes only implemented actions; it does not contain placeholder explorer or gateway controls.

qText result readability has two independent settings, both disabled by default: `vscode-kdb.results.qText.syntaxHighlighting` and `vscode-kdb.results.qText.displayFormatting`. Highlighting is limited to qText result output, uses VS Code theme colors, and creates text nodes/spans rather than interpolating result text into HTML. Display formatting is a conservative, non-mutating view transform for supported balanced lambda/block structures; strings and comments are preserved, and ambiguous or malformed input falls back to the exact raw text. Settings changes update open and reused result panels. Neither setting changes q source editors, executes q, or mutates copy/export source data.

Chart **Reset zoom** retains an immutable baseline for the original complete numeric or temporal X domain. Manual zoom and automatic/explicit refinement can replace the displayed sample without replacing that baseline; Reset restores the original sample/domain, returns Y to automatic scale, and clears selection, tooltip, and pending refinement state. Series hidden from the legend remain hidden across that lifecycle, ordinary rerenders, panel resize, and settings refresh.

## Diagnostics

Open **View > Output** and select **KX** for connection, handshake, query, cancellation, disconnect, and close lifecycle diagnostics. Records include the phase and direct host/port where useful, but omit query text and result values. Authentication credentials, SecretStorage values, and local-data-server tokens are redacted or omitted.

For additional safe operation timings, enable this setting explicitly:

```json
"vscode-kdb.performance.trace": true
```

The setting is opt-in and is never changed automatically. Performance tracing adds operation durations, sizes/counts, and memory details to the KX output without logging query values or credentials.

## Focused standalone scope

Version 0.2.8 keeps extension-owned execution direct-q-IPC-only and makes the explicit mixed q-cell runner the default notebook path. The q-only `NotebookController` is an application-scoped opt-in, disabled by default. Public VS Code APIs still select one controller for the notebook; KX does not make built-in Python Run dispatch to a second controller. Standalone owns its TextMate q grammar, live in-memory notebook result adapter, bounded NotebookRenderer output, focused Server Explorer, local Query History, and KX Results panel. These are bounded first-party features, not full LSP, lint, source-formatter, Jupyter-kernel, KDB-X, or q Professional parity. SSH setup, TLS termination, gateway or broker configuration, broad namespace browsing, remote orchestration, Python-kernel interception, persisted full-result recovery, and server-side interruption remain outside this release. The SQLTools settings reader is an intentional migration ingress only, not a runtime/session dependency.

## Development and verification

Requirements: a current Node.js/npm installation and a supported VS Code installation for local extension development. Notebook-helper development also uses `uv`; do not install its test dependencies into system Python.

```sh
npm ci
npm run compile
npm test
npm run test:parity:self
npm run test:parity
npm run test:notebook-python
npm run test:notebook-cross
npm run test:extension-host
npm run test:notebook-results-visual
VSCODE_KDB_LIVE_REQUIRED=1 \
  VSCODE_KDB_Q_BIN=/absolute/path/to/q \
  npm run test:live-q
```

`npm test` is the focused harness for q IPC serialization/deserialization/cancellation, q-text selection/current-line extraction, delayed-configuration connection transactions, optional-controller lifecycle, mixed q-cell current-target routing, full-cell/session/error/cancellation behavior, live notebook result slicing/search/sort/copy/chart/settings contracts, chart capability and hidden-series state, cell language/default/marker behavior, notebook MIME validation/bounds/fallbacks, independent timeout defaults, connection lifecycle, migration, SecretStorage, namespace wrapping, Server Explorer, Query History, diagnostics/redaction, and grammar/manifest/source/webview guards. The isolated repository-local Python suite verifies serializer, MIME fallback, static-chart, escaping, callback-magic, and optional-PyKX compatibility fixtures; `npm run test:notebook-cross` separately installs exactly `kx-notebook==0.1.0`, imports `kx_notebook`, and validates its emitted version-1 contract against the TypeScript validator. The scoped real Extension Host smoke uses isolated VS Code user data to exercise the actual store: add two application/global profiles, select one, edit the same targeted ID from port `5005` to `5000`, resolve that notebook target to the current endpoint, verify default controller non-registration, and clean up test settings, secrets, and global state. It also verifies actual q-language and KX metadata persistence across save, close, and reopen, then restores the notebook default. That standard smoke remains non-visual and does not automate the connection form, selector, toolbar/status, or QuickPick. The separate notebook-results visual harness starts real q under VS Code + Xvfb, executes the deterministic gallery, and keeps the existing set of 12 validated screenshots. They cover light/dark tables and charts, visible and hidden color-keyed legends, readable dark axes, selector swatches/narrow containment, **Auto** font-size and scrollable Settings, opt-in qText readability, tracked-file save/reopen preview behavior, live-full state, and all six chart families. Its interactions also drive range/search, column/settings menus, chart render, pointer and keyboard legend toggling, drag zoom, settings rerender, Close/Escape focus return, and Reset zoom. This acceptance is local Linux VS Code Extension Host/Xvfb with the installed q binary reached over loopback. Remote and devcontainer acceptance were not run; the Docker daemon is unavailable on this host, a hard blocker for Docker-backed acceptance.

For the 0.2.8 release, run both `npm run test:parity:self` and the full `npm run test:parity` gate. When the reference checkout must remain byte-for-byte untouched, clone it to a disposable directory, reuse or install that clone's dependencies, and set `KDB_SQLTOOLS_PARITY_ROOT` plus `KDB_SQLTOOLS_PARITY_REVISION` explicitly; do not point the compiling gate at the protected checkout. The checked report predates 0.2.0 and contains 63 classified cases and 381 assertions: 49 `PASS`, 5 `DIFFERENT_BY_DESIGN`, 3 `GAP`, and 6 `NOT_TESTABLE_HERE`, split into 38 deterministic, 14 live-q, and 11 boundary cases. It remains historical evidence, is not legacy-q, mixed-notebook, or visual evidence, and does not establish complete functional or visual parity. See [the evidence report](PARITY_RUN.md) and [parity runner documentation](test/parity/README.md).

If a local q executable is available at `~/.kx/bin/q`, run the optional live IPC test:

```sh
npm run test:live-q
```

The live runner detects that location automatically and skips cleanly when q is unavailable. Set `VSCODE_KDB_Q_BIN=/path/to/q` to select another executable, or `VSCODE_KDB_LIVE_REQUIRED=1` to make an unavailable q executable fail the run.

The MkDocs sources are under `mkdocs-src/`, and generated `docs/` is committed. Run the same strict build and drift gate as the Pages workflow:

```sh
python3 -m venv /tmp/vscode-kdb-docs-venv
. /tmp/vscode-kdb-docs-venv/bin/activate
python -m pip install --requirement mkdocs-src/requirements.txt
mkdocs build --strict
python .github/scripts/clean-mkdocs-output.py docs
git diff --exit-code -- docs
test -z "$(git status --porcelain -- docs)"
```

The workflow uploads generated docs as an artifact but intentionally does not deploy or change repository Pages configuration. See `mkdocs-src/README.md` for the exact documentation and extension contributor checks.

Package the extension with either the project script or an explicit artifact path:

```sh
npm run package
npx @vscode/vsce package --out vscode-kdb-0.2.9.vsix
python - <<'PY'
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

source = Path("vscode-kdb-0.2.9.vsix")
with ZipFile("vscode-kdb-0.2.9-vsix.zip", "w", ZIP_DEFLATED, compresslevel=9) as archive:
    archive.write(source, arcname=source.name)
PY
python scripts/audit-release.py vscode-kdb-0.2.9.vsix vscode-kdb-0.2.9-vsix.zip
```

The wrapper contains exactly one file: the byte-identical VSIX. The release auditor checks both archives' paths, duplicates, encryption flags, symlinks, CRCs, manifest/assets, compiled/runtime inventory, nested archives, credential indicators, forbidden sources, raw embedded bytes, names, versions, and SHA-256 hashes. The VSIX is assembled through `.vscodeignore`; development dependencies, tests, caches, source maps, prompt files, archives, and local secrets are excluded from the release artifact.

## Competitive references and reuse

[q Professional / `jshinonome/vscode-k-pro` at `fc9afacaeaf5e90eb013eb34426488841cc24f2a`](https://github.com/jshinonome/vscode-k-pro/tree/fc9afacaeaf5e90eb013eb34426488841cc24f2a) documents a formatter and informed product-level readability research only. Its public repository license is all-rights-reserved, so no source code, logic, or assets were copied.

[KX's `KxSystems/kx-vscode` at `1c745bf0221dd3cca85dce925c4d432d80bb5ef5`](https://github.com/KxSystems/kx-vscode/tree/1c745bf0221dd3cca85dce925c4d432d80bb5ef5) was inspected as an Apache-2.0 reference. Its `kdb.ls.q.lint` command is qlint integration—linting, not a general qText result pretty-printer. Version 0.2.8 adapts no source code, logic, or assets from it or q Professional, so `THIRD_PARTY_NOTICES.md` needs no new entry. SQLTools remains absent as a runtime or UI dependency; the one-time configuration importer is KX-owned and remains Command Palette only. See [PARITY.md](PARITY.md) for the bounded competitive audit; these references do not imply full KDB-X or q Professional parity.

## License

KX for VS Code is released under the [MIT License](LICENSE). Bundled third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

KX and the KX logo are trademarks of KX. They are used here solely to identify KX/kdb+ integration. This independent project is not affiliated with or endorsed by KX.

kdb+ and q are products of KX. This project is not a SQLTools extension and does not require SQLTools to be installed.
