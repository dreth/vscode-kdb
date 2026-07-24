# KX for VS Code

KX for VS Code is a standalone extension for working with kdb+/q directly in Visual Studio Code. It provides q language support, extension-owned direct q IPC connections, exact editor execution, a native q controller for ordinary Jupyter notebooks, portable notebook snapshots, optional first-party server exploration and local query history, and a high-performance native result viewer.

Version 0.2.6 makes mixed Python/q execution visible where notebook users already work. With Python still selected, non-q code cells show **Make q Cell (KX)**, q cells show a leading **Run q Cell (KX)** play action, and q-cell status shows `KX: <notebook target> · Ctrl+Enter` (`Cmd+Enter` on macOS). Each notebook has an explicit saved q target backed by a KX profile; only its stable ID and display name enter the `.ipynb`. Connection saves now verify persistence and show every profile with an unambiguous `ACTIVE` marker. Persisted table previews default to 20 rows while the current live result remains full and virtualized.

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

For a q-only notebook, open an ordinary `.ipynb`, choose **KX q (Direct IPC)** from the notebook's normal kernel/controller picker, make the intended code cells q, and use normal **Run Cell** or `Ctrl+Enter`. For a mixed notebook, leave Python selected and click **Make q Cell (KX)** on the intended code cell. Choose its visible notebook q target, then use **Run q Cell (KX)** or focused-cell `Ctrl+Enter` / `Cmd+Enter`. Python, Markdown, cell-container, and output focus keep normal Jupyter behavior. See [Jupyter/IPython notebooks](#jupyteripython-notebooks).

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

The sidebar title keeps the routine actions to **Add** and **Refresh**. Every valid saved profile appears immediately. The active row has a star and uppercase `ACTIVE`; click a connection row, use its **Set Active Connection** action, or run the same command from the Command Palette to select it. No list-first profile is silently substituted when the active profile is removed.

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

Validation failures and Cancel leave both persisted data and any connected client unchanged. Save writes the safe profile and requested SecretStorage change first. If a connected profile's host, port, username, password, or timeout changes, the old client is then disconnected and a reconnect is attempted with the saved settings. A reconnect failure leaves the new profile saved, the client disconnected, and shows a warning; it does not restore or silently reuse the stale client. Name and namespace-only edits do not recycle an otherwise valid client. Deleting a connection removes its stored password and disconnects its client.

### Security model

Safe connection metadata is kept in the global user setting `vscode-kdb.connections`: connection ID, name, host, port, database/namespace, username, and optional `connectTimeoutMs` / `queryTimeoutMs` overrides. Passwords are never written to settings. Each password is stored under a connection-specific key in VS Code `SecretStorage`, using the credential protection provided by VS Code and the operating system at rest. Removing a connection removes its stored secret. Passwords are not included in extension logs, documentation samples, packaged files, connection errors, or saved-profile messages sent to the webview.

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

Multiline selections are preserved as selected and evaluated using q's own script-line grouping. There is no SQL parser, extension-owned statement splitter, current-block inference, or hidden session-file behavior.

The extension owns its `.q` language contribution and TextMate grammar. Since 0.2.2 it recognizes a leading `%%q` line as a notebook directive while retaining normal q highlighting below it; ordinary `.q` token rules remain unchanged. `.k` is not associated with q: broadening that file association without a demonstrated, testable need could conflict with other VS Code language support. This basic language support is not a claim of a q language server, lint engine, source-document formatter, or full editor parity.

Whole-document runs and multiline selections use [q's own documented script-line grouping](https://code.kx.com/q/ref/dotq/#ld-load-and-group), including q indentation and script termination rules; they require q 4.0 dated 2023-03-28 or newer (or q 4.1t dated 2022-11-01 or newer). Single-line selections and current-line execution remain raw q queries and do not use this grouping helper.

Queries use the active connection. A normal run replaces the active result panel; **Run Selection in New Result** keeps the existing panel and opens another.

Canceling a result wait is local and best-effort: the panel stops waiting immediately, but q computation or side effects already sent to the server can continue. It does not cancel other queued result panels on the same connection. Use **Disconnect** when you intentionally need to close that connection and fail its outstanding work.

## Jupyter/IPython notebooks

VS Code selects one execution controller for a notebook. KX for VS Code therefore exposes two explicit first-party modes instead of pretending normal Run can dispatch different cells to different controllers.

| Selected notebook kernel + cell | Use |
| --- | --- |
| Python selected + Python cell | normal Run |
| Python selected + q cell | **Run q Cell (KX)** / `Ctrl+Enter` |
| KX q selected + q cell | normal Run |

### Mode 1: q-only notebook

Select **KX q (Direct IPC)** from the notebook's kernel/controller picker. The supported controller has ID `vscode-kdb.q-notebook-controller`, notebook type `jupyter-notebook`, and `supportedLanguages = ["q"]`. Ordinary **Run Cell**, **Run All**, and `Ctrl+Enter` / `Cmd+Enter` remain native controller actions and send each complete q cell through the active KX profile. A leading `%%q` is rejected; Markdown is ignored; a non-q code cell receives a clear q-only error.

### Mode 2: mixed Python and q notebook

Keep the normal Python Jupyter controller selected. Python cells continue to use normal Jupyter Run and are never rewritten, intercepted, or sent to q. A non-q code cell shows the leading **Make q Cell (KX)** action; it changes that complete cell's language through the public VS Code API without changing the selected Python kernel. **KX: Restore Notebook Cell Language** returns it to the notebook default.

An actual q cell shows the leading **Run q Cell (KX)** play action and two compact status items. `KX: <profile> · Ctrl+Enter` (`Cmd+Enter` on macOS) runs the complete cell. `q default: <profile>` chooses the notebook-level direct KX target without switching kernels. The target picker lists saved profiles and labels the globally active profile as a convenience, but selection is explicit. The `.ipynb` stores only the selected profile's stable ID and display name. Rename resolves by ID; removal produces **Select connection** and requires a replacement instead of routing elsewhere.

Because Python still owns native notebook execution, the mixed KX action cannot create a native KX cell execution. It keeps the old output visible while q runs, then commits the finished KX output as one normal undoable notebook edit. That edit makes the notebook dirty until saved and gives the q cell a new internal VS Code cell handle; it preserves the q source, q language, cell metadata, and every sibling Python/Markdown cell. If the q cell source, language, output, or execution state changes while KX is waiting, the action refuses to overwrite the newer state. Mixed KX output deliberately has no native kernel execution order or timing badge.

While the q cell editor itself has text focus, the contributed default `Ctrl+Enter` on Windows/Linux or `Cmd+Enter` on macOS invokes **Run q Cell (KX)**. Its manifest guard requires a focused `vscode-notebook-cell` code editor whose language is exactly `q`, and it is disabled when **KX q (Direct IPC)** is selected. It cannot match Python, Markdown, ordinary files, cell-container focus, or output focus. In those other focus states, VS Code's normal notebook shortcut remains in charge. A user or keymap-extension rule can override any default shortcut; the toolbar/context/Command Palette action remains the reliable fallback.

The q-only controller uses the active profile in **KX Connections**. Mixed q cells use the notebook's explicit q target. Both paths share the same full-cell query/error/snapshot core and profile-keyed `ConnectionManager` sessions, so assignments and namespace state continue across q cells on the same target. The mixed status shows only the safe profile display name; host, username, password, and other credentials are never notebook status or target metadata.

Connection, timeout, q, and decode failures are sanitized. Cancel before dispatch prevents the request. Cancel after synchronous IPC dispatch ends the local wait and reports that server work or side effects may continue; 0.2.6 does not claim server-side interruption. The shared script wrapper requires q 4.0 dated 2023-03-28 or newer (or q 4.1t dated 2022-11-01 or newer).

Normal Run with a Python controller selected remains owned by Jupyter—even on a q-language cell—and is not a second KX trigger. Use the clearly labelled KX action for direct IPC. This avoids duplicate hidden routing and preserves normal Python-controller behavior.

### q language and the secondary editing aid

The selected direct controller advertises q as its supported language. q-language cells receive the extension's TextMate grammar automatically. If a cell remains another language while **KX q (Direct IPC)** is selected, use VS Code's normal cell-language picker to choose q. In mixed mode, the leading **Make q Cell (KX)** action performs that change without switching the Python kernel; actual q language is the hard scope for **Run q Cell (KX)** and its focused-editor shortcut.

When an `.ipynb` is saved, VS Code's built-in Jupyter serializer represents a non-default cell language in raw cell metadata as `metadata.vscode.languageId: "q"`. This is serializer-owned persistence, not the `vscode-kdb` tag metadata. A selected Jupyter controller can still constrain or normalize cell languages; if a Python controller changes a cell back to Python, reapply q language before using the KX action.

There is no static notebook-controller contribution in `package.json`: VS Code controllers are registered through `vscode.notebooks.createNotebookController`, and `onNotebook:jupyter-notebook` activates the extension when an ordinary Jupyter notebook opens. **KX: Restore Notebook Cell Language** remains available to change selected code cells to the notebook default derived safely from `language_info.name` or `kernelspec.language`; for an ordinary IPython notebook that is Python. It refuses to guess when no registered default can be resolved and never changes Markdown.

### Live direct result and saved snapshot

A successful result from either first-party KX notebook mode is available inline through the same result model used by normal editor results while its in-memory live record exists. q general null/no-value responses from assignments, declarations, and calls such as `hopen`, plus generic empty values, render as compact qText; a genuine zero-row q table retains its schema and table view.

The notebook renderer is a compact adaptation of the KX Results interaction model, not a second divergent toolbar. Its header exposes **KX Results** and shared **Settings**. A table row contains Search, match status, and a Chart toggle; `Enter` / `Shift+Enter` in Search move to the next/previous match. The selection-only **Tools** menu appears only after cells are selected and provides one format selector plus one working Copy action. There are no inert Reset Size, default previous/next, or duplicate Copy TSV/CSV buttons. Live tables retain natural/bounded height, deliberate vertical resizing, stable two-axis virtualization, sticky headers/row numbers, three-state sort, and drag/Shift/keyboard selection. Copy is bounded at 20,000 cells and can include selected live rows outside the loaded slice.

Notebook Chart controls use the panel vocabulary and capability rules: line, scatter, step, bar, box, and candlestick; X; one or more Y series; Group By only where supported; and distinct Open/High/Low/Close selectors for candlestick. The visible notebook-only Point cap control is gone. Shared chart source/sampling settings and compact status text retain the guardrails. Changing configuration leaves the old chart visible until **Render** is pressed. Legend-hidden series stay hidden through zoom, Reset zoom, rerender, resize, renderer settings changes, and compatible configuration updates. Zoom refinement remains a full KX Results panel feature rather than an unimplemented notebook control.

Inline search stops after 1,000 matches, 2,000,000 cells, or about 1.5 seconds; inline sorting declines tables with 250,000 or more rows. Column hide/reorder and full export remain panel features. The compact **KX Results** action opens the same live value in the full panel.

`vscode-kdb.results.*` is the common settings source for notebook live results and the KX Results panel. Density/sizing, array formatting, qText and list/dictionary/object/function strategies, elapsed-time display, and chart settings are sent through a validated renderer messaging contract. A supported setting changed from a live notebook result is written to the same global VS Code configuration and broadcast to other live q cells and open KX panels.

The `.ipynb` never stores the full live q object. Direct output contains a bounded `application/vnd.kx.result+json` snapshot and `text/plain` fallback, constrained by `vscode-kdb.notebook.maxOutputRows` (20 by default) and `maxOutputBytes`, the portable contract's 256-column ceiling, and its 32,768-character cell-value ceiling. Tables with 20 rows or fewer persist every row. Larger tables persist schema/headers, exactly the bounded preview rows, total row count, and an honest truncation notice—never tens of thousands of hidden rows. qText, scalars, and other small values remain fully visible within the byte bound. Direct output does not add `text/html` or a persisted chart specification. Its opaque live-result identifier is not an IPC handle and cannot recreate data. Each live record is bound to its notebook URI and current cell URI for the extension-host session; mixed mode rebinds it after the output edit replaces the q cell handle. Rerunning or removing that cell replaces/removes its record, closing the notebook removes its records, and deactivation clears the store; a 512-record cap evicts the oldest record. Reopening or any expired association renders only the portable snapshot. Omitted rows cannot be recovered from notebook persistence.

The saved-result renderer keeps the same compact/resizable table, selection-only Tools copy path, and transient capability-checked chart controls; those controls do not write a chart specification back to the `.ipynb`. First-party direct results always remain inline beneath the cell, including after the live record expires. Use the concise **KX Results** action for panel handoff. The `vscode-kdb.notebook.presentation` `inline`/`panel`/`both` automatic behavior applies only to Python-helper output.

### Separate Python `%%q` route

Install the helper into the same environment as the selected IPython kernel. From a source checkout, an isolated `uv` installation looks like:

```sh
uv venv /tmp/vscode-kdb-kx-notebook
uv pip install --python /tmp/vscode-kdb-kx-notebook/bin/python --editable ./python/kx_notebook
```

The VSIX also ships this same installable source package under `python/kx_notebook`; the extension does not modify a kernel environment automatically.

Configure the one evaluator owned by that Python kernel, then load the magic:

```python
from kx_notebook import configure_evaluator

def evaluate_in_my_existing_session(source: str):
    return my_existing_q_session(source)  # return a bounded table-like result

configure_evaluator(evaluate_in_my_existing_session, label="kernel q session")
%load_ext kx_notebook
```

The helper never opens or borrows the extension's direct q connection. Optional PyKX use is explicit through `kx_notebook.pykx.configure_pykx()` and requires PyKX to be installed, configured, and licensed separately in the kernel. No q or PyKX binary is bundled. No extension-managed variables, namespace state, session identity, or live-result identity are shared with **KX q (Direct IPC)**. A user callback may independently target the same external process, but helper output never receives a Direct IPC live-result record.

**KX: Tag Notebook Cell as q** first sets the selected code-cell documents to q, then inserts a marker using the configured defaults:

```q
%%q --max-rows 20 --max-bytes 1000000
select from trade where date=.z.D
```

It preserves an existing leading marker, never deletes cell code, and merges versioned `vscode-kdb` marker/limit metadata without wiping other cell metadata. The q language mode selects highlighting; `%%q` is the portable IPython execution convention. The helper validates options before calling the evaluator and publishes `application/vnd.kx.result+json` version 1 together with escaped `text/html` and `text/plain` fallbacks. The saved bundle contains a typed bounded table preview, schema, total and preview row counts, safe label/elapsed metadata, explicit truncation reasons, and an optional chart specification. It never stores credentials, access tokens, passwords, IPC handles, or an unbounded full result.

A q-language cell without `%%q` shows the contextual **Prepare for Python kernel** lightbulb only when the direct controller is not selected. It safely adds the marker and nested KX metadata. For the normal Python Jupyter controller, then use **KX: Restore Notebook Cell Language** while keeping `%%q`, and use the notebook's normal Run action. IPython receives the cell as Python-controller input and invokes the registered `%%q` magic. Selecting a Python kernel may perform the language normalization automatically; the durable marker remains. Reapply q mode when q highlighting is wanted again.

The helper's MIME output uses the same compact renderer controls described above. An emitted chart specification persists in the notebook; renderer-only control changes and zoom remain local session state and do not rewrite the `.ipynb`. Re-emit the result with the desired chart specification to persist it. The HTML fallback contains the schema, row count, bounded saved rows, truncation notice, and a network-free static SVG for a supported persisted chart. Notebook HTML/PDF export is static and does not preserve arbitrary uPlot interaction.

`vscode-kdb.notebook.presentation` accepts `inline`, `panel`, or `both` and defaults to `inline` for Python-helper output. Direct-controller output always remains inline and offers a concise KX Results handoff. Reopened Python-helper output and any direct result whose live record has expired can hand off only the bounded rows stored in the notebook; that path cannot recover omitted rows.

The routes are explicit. With **KX q (Direct IPC)** selected, VS Code delegates normal q-cell Run to the extension-owned controller and active profile. With a Python controller selected, **Run q Cell (KX)** uses the notebook's chosen direct KX target without changing the controller, while normal Run remains Python/Jupyter. The optional `%%q` helper is a third, Python-kernel-owned evaluator path and does not share either direct KX session by implication. See the complete [notebook guide](mkdocs-src/notebooks.md).

## Query History

When `vscode-kdb.features.queryHistory` is enabled, issued editor executions are stored newest first in **KX Query History**. Recording starts only after a line, selection, or script is actually sent. Each local entry contains the exact query text, stable connection ID and recorded label, timestamp, execution kind, status (`succeeded`, `failed`, or `canceled` after an issued run's local wait is canceled), and duration; result payloads and passwords are never stored. Runs that never reach q are not recorded.

History uses VS Code workspace `Memento` storage on the local machine. It is not written to user or workspace settings, registered for Settings Sync, transmitted as telemetry, or sent anywhere except when the user explicitly reruns that q text. `vscode-kdb.queryHistory.maxEntries` defaults to `100` and accepts `1` through `1000`; lowering it prunes the oldest retained entries.

Entry actions rerun, copy, insert into the active editor, or delete one entry. **KX: Clear Query History** requires confirmation. Rerun uses the same exact q execution, active-connection, configured-namespace, timeout, cancellation, error, diagnostic, and result pipeline as editor execution. After normal connection selection resolves the target, KX confirms every mismatch with the recorded stable ID—even when no profile was active or the recorded profile was removed—before issuing text. Renamed or removed profiles remain safely identified without exposing credentials.

## Result panel

Normal `.q` editor results open in the KX-owned viewer; there is no alternate SQLTools result target. A live direct-controller result can open the same full in-memory model in the viewer while its record exists. A saved/reopened notebook can hand off only its bounded preview, which does not restore omitted data. The viewer includes:

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

Version 0.2.6 keeps extension-owned execution direct-q-IPC-only and includes both the selected q `NotebookController` and an explicit q-cell command for mixed notebooks. Public VS Code APIs still select one controller for the notebook; KX does not make built-in Python Run dispatch to a second controller. Standalone owns its TextMate q grammar, live in-memory notebook result adapter, bounded NotebookRenderer output, focused Server Explorer, local Query History, and KX Results panel. These are bounded first-party features, not full LSP, lint, source-formatter, Jupyter-kernel, KDB-X, or q Professional parity. SSH setup, TLS termination, gateway or broker configuration, broad namespace browsing, remote orchestration, Python-kernel interception, persisted full-result recovery, and server-side interruption remain outside this release. The SQLTools settings reader is an intentional migration ingress only, not a runtime/session dependency.

## Development and verification

Requirements: a current Node.js/npm installation and a supported VS Code installation for local extension development. Notebook-helper development also uses `uv`; do not install its test dependencies into system Python.

```sh
npm ci
npm run compile
npm test
npm run test:parity:self
npm run test:notebook-python
npm run test:notebook-cross
npm run test:extension-host
VSCODE_KDB_LIVE_REQUIRED=1 \
  VSCODE_KDB_Q_BIN=/absolute/path/to/q \
  npm run test:live-q
```

`npm test` is the focused harness for q IPC serialization/deserialization/cancellation, q-text selection/current-line extraction, native-controller and mixed q-cell routing through their shared query/result core, full-cell/session/error/cancellation behavior, live notebook result slicing/search/sort/copy/chart/settings contracts, chart capability and hidden-series state, cell language/default/marker behavior, notebook MIME validation/bounds/fallbacks, independent timeout defaults, connection lifecycle, migration, SecretStorage, namespace wrapping, Server Explorer, Query History, diagnostics/redaction, and grammar/manifest/source/webview guards. The isolated Python suite verifies the companion serializer, MIME fallbacks, static chart, escaping, callback magic, and optional PyKX boundary. The scoped Extension Host smoke verifies activation, commands, isolated two-profile configuration/active selection, and actual notebook language conversion/restoration. It does not automate the connection webview, kernel selector, toolbar/status layout, target QuickPick, or q execution; no standalone visual UI E2E is claimed.

For the 0.2.6 release, run `npm run test:parity:self`; do not run the full cross-repository gate when the pinned reference checkout must remain untouched. The checked report predates 0.2.0 and contains 63 classified cases and 381 assertions: 49 `PASS`, 5 `DIFFERENT_BY_DESIGN`, 3 `GAP`, and 6 `NOT_TESTABLE_HERE`, split into 38 deterministic, 14 live-q, and 11 boundary cases. It remains historical evidence, is not mixed-notebook or visual evidence, and does not establish complete functional or visual parity. See [the evidence report](PARITY_RUN.md) and [parity runner documentation](test/parity/README.md).

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
npx @vscode/vsce package --out vscode-kdb-0.2.6.vsix
python - <<'PY'
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

source = Path("vscode-kdb-0.2.6.vsix")
with ZipFile("vscode-kdb-0.2.6-vsix.zip", "w", ZIP_DEFLATED, compresslevel=9) as archive:
    archive.write(source, arcname=source.name)
PY
python scripts/audit-release.py vscode-kdb-0.2.6.vsix vscode-kdb-0.2.6-vsix.zip
```

The wrapper contains exactly one file: the byte-identical VSIX. The release auditor checks both archives' paths, duplicates, encryption flags, symlinks, CRCs, manifest/assets, compiled/runtime inventory, nested archives, credential indicators, forbidden sources, raw embedded bytes, names, versions, and SHA-256 hashes. The VSIX is assembled through `.vscodeignore`; development dependencies, tests, caches, source maps, prompt files, archives, and local secrets are excluded from the release artifact.

## Competitive references and reuse

[q Professional / `jshinonome/vscode-k-pro` at `fc9afacaeaf5e90eb013eb34426488841cc24f2a`](https://github.com/jshinonome/vscode-k-pro/tree/fc9afacaeaf5e90eb013eb34426488841cc24f2a) documents a formatter and informed product-level readability research only. Its public repository license is all-rights-reserved, so no source code, logic, or assets were copied.

[KX's `KxSystems/kx-vscode` at `1c745bf0221dd3cca85dce925c4d432d80bb5ef5`](https://github.com/KxSystems/kx-vscode/tree/1c745bf0221dd3cca85dce925c4d432d80bb5ef5) was inspected as an Apache-2.0 reference. Its `kdb.ls.q.lint` command is qlint integration—linting, not a general qText result pretty-printer. Version 0.2.6 adapts no source code, logic, or assets from it or q Professional, so `THIRD_PARTY_NOTICES.md` needs no new entry. SQLTools remains absent as a runtime or UI dependency; the one-time configuration importer is KX-owned. See [PARITY.md](PARITY.md) for the bounded competitive audit; these references do not imply full KDB-X or q Professional parity.

## License

KX for VS Code is released under the [MIT License](LICENSE). Bundled third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

KX and the KX logo are trademarks of KX. They are used here solely to identify KX/kdb+ integration. This independent project is not affiliated with or endorsed by KX.

kdb+ and q are products of KX. This project is not a SQLTools extension and does not require SQLTools to be installed.
