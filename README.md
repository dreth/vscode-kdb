# KX for VS Code

KX for VS Code runs q from `.q` files and Jupyter notebooks against saved kdb+/q endpoints over direct q IPC. It adds q syntax highlighting and displays decoded results in a VS Code panel or notebook output. It does not bundle q, translate SQL, or require SQLTools.

See the [user guide](mkdocs-src/index.md) for detailed setup and the [troubleshooting guide](mkdocs-src/troubleshooting.md) for connection, execution, and result problems.

## Quick start

KX for VS Code requires VS Code 1.96 or newer and a reachable q process. For local development, bind q to loopback:

```sh
q -p 127.0.0.1:5000
```

`q -p 5000` can listen on non-loopback interfaces. Use that form only on a trusted, firewalled machine.

1. Install KX for VS Code and open the KX activity-bar view.
2. In KX Connections, select `Add Connection`.
3. Enter a unique name, host `localhost`, port `5000`, and namespace `.`.
4. Select `Test Connection`, save the profile, then choose `Activate Connection`. Activation opens its transport and marks it with the sole star.
5. Open a `.q` file containing `til 5`, then press `Ctrl+Enter` on Windows/Linux or `Cmd+Enter` on macOS.

Install [`DanielAlonso.vscode-kdb` from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=DanielAlonso.vscode-kdb), or run `ext install DanielAlonso.vscode-kdb` from VS Code Quick Open. For a local build, run `npm ci` followed by `npm run package`, then use `Extensions: Install from VSIX...`.

## Run q from an editor

Queries use only the starred active connection. A connected non-active profile is never selected. If no profile is active, KX asks you to activate one; it does not silently fall back.

| Command | Windows/Linux | macOS | What runs |
| --- | --- | --- | --- |
| `KX: Run Selection / Current Line` | `Ctrl+Enter` | `Cmd+Enter` | The exact selection, or the complete current physical line |
| `KX: Run q Script` | `Ctrl+Alt+Enter` | `Cmd+Alt+Enter` | The complete active `.q` document |
| `KX: Run Selection in New Result` | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` | The selection/current line in another result panel |

With the root namespace (`.`), single-line execution sends raw q. For a non-root namespace, the extension wraps the query to enter that namespace and restore the previous one afterward. Multiline selections, complete documents, and direct notebook cells are grouped by q source-line indentation and evaluated in order with `value`. Blank lines, q comments, and top-level system commands retain their script meaning. This path does not use `.Q.ld`.

Complete-source execution also enters the configured namespace and restores the previous process namespace afterward.

Cancel stops the extension waiting for a result. It does not reliably interrupt q work or side effects already sent to the server. Disconnect the profile to close its socket and fail outstanding IPC work.

## Connections

Connection profiles are managed in the KX Connections view. A profile contains a name, direct host and port, q namespace, optional username, and optional timeout overrides. `.` is the root namespace. Zero or one profile is starred **Active**, and that profile is the sole route for editor queries, direct notebooks, Server Explorer, result reruns, and previews. `KX: Activate Connection` opens the candidate transport before switching the star; a failed switch leaves the prior active route and transport unchanged. Deactivating or removing the active profile leaves no active route rather than choosing another saved or connected profile.

Profile definitions are stored in `vscode-kdb.connections` at User, Workspace, or Workspace Folder scope. Passwords saved through the connection form use VS Code SecretStorage and are not shown when a profile is edited. Settings may instead include a fallback such as `"password": "<plaintext-password>"`, but it is plaintext and may be committed or synchronized; SecretStorage is safer and takes precedence whenever an entry exists, including an empty string.

| Setting | Default | Purpose |
| --- | ---: | --- |
| `vscode-kdb.connectionTimeoutMs` | `30000` | TCP connect and q IPC handshake timeout |
| `vscode-kdb.queryTimeoutMs` | `3600000` | Query response timeout (60 minutes) |

Each value is in milliseconds. A per-profile value overrides its global default; blank inherits the default and `0` disables that deadline. Mixed **Run q Cell (KX)** and the optional pure-q controller both use the active profile's effective query timeout. Neither adds an independent 30-second notebook query ceiling; `30000` remains the separate TCP connect/q IPC handshake default.

`KX: Import SQLTools KDB Connections` reviews eligible legacy KDB profiles already present in `sqltools.connections`. Import is one-time: it does not require SQLTools, change the source setting, overwrite an existing KX profile, or create ongoing synchronization. SSH-enabled profiles are not imported because this extension cannot reproduce the tunnel. Password transfer requires explicit confirmation and writes the copied value to SecretStorage.

See [Connections and SecretStorage](mkdocs-src/connections.md) for field validation, namespace behavior, timeouts, and import rules.

## Results

Editor results open in KX Results. The panel supports grid and q-text views, virtualized rows and columns, selection, search, sorting, column visibility and sizing, and configurable display density. Table headers use one consistent interaction: click cycles source/ascending/descending order, drag at least 5 CSS pixels reorders, `Ctrl`/`Cmd`+click selects a column, `Enter`/`Space` sorts, and `Alt`+Left/Right reorders. It can copy or export TSV, CSV, Markdown, JSON, NDJSON, HTML, plain text, and XLSX where applicable. Parquet export is not implemented.

Panel and notebook grids apply subtle theme-token-derived shading to alternating logical displayed rows. The absolute displayed-row ordinal, rather than DOM position, owns the stripe, so virtual scrolling, sort windows, and saved paging do not flicker; headers are not striped. Selection, hover, focus, search, loading/error, and accessibility states take precedence. Panel and live-notebook sorts prompt only when the displayed result exceeds `vscode-kdb.results.largeSortWarningRowThreshold`, which defaults to 5,000,000 rows: exactly 5,000,000 does not warn and 5,000,001 does. A confirmed sort approves only that exact displayed result; cancellation does not, and re-execution, replacement, reopening, or a new output identity resets approval. `vscode-kdb.results.hideLargeSortWarnings` remains the global opt-out.

Decoded q keyed tables give their key columns a distinct, subtle theme-safe tint in both KX Results and notebook tables. Identity comes only from the keyed-table key schema and original source ordinals—not column names or query text—so it follows hide/reorder, sorting, paging, and virtualization; an ordinary table with the same names is not highlighted. Key headers announce that role accessibly, and selection, search, focus, errors/loading, hover, sorted state, and high-contrast cues remain dominant.

Grid cells use concise familiar text for ordinary booleans, numerics, temporals, GUIDs, nulls, and infinities. q syntax remains where it prevents ambiguity: symbols use backticks, character vectors use quotes, singleton vectors use `enlist`, and nested or special values retain enough structure. qText remains q-native. Table copy/export instead uses analyst-friendly data values: ordinary strings, numbers and booleans, portable temporal text, and format-appropriate nulls. This boundary does not change exact q type metadata, IPC values, grid formatting, qText, or notebook persistence.

Charts support line, scatter, step, bar, box, and candlestick views over eligible columns. A compact overview navigator below the main plot shows the full X domain and a selected window: drag the window to pan, drag either edge to resize, or use the focusable window/handles with bounded arrow-key movement. Plain main-plot drag zoom remains available, and `Home` or **Reset zoom** restores the full domain. Settled live ranges refine automatically through the same absolute-range/stale-response lifecycle; saved or otherwise bounded charts navigate locally. There are no dedicated Pan or Refine buttons. Ordinary line, scatter, and step charts plot exactly 7,000 deterministic points when at least 7,000 eligible finite source points exist, or all eligible points below that threshold. Semantic grouping/aggregation can honestly yield fewer bars, box groups, or candles, and status distinguishes eligible rows from rendered visual items. Large copy, export, sort, render, and chart operations are bounded or require confirmation. The complete q IPC response is decoded before display; virtualization reduces DOM work but does not stream the response.

Table file export is hard-bounded before whole-result allocation: text formats allow at most 5,000,000 output cells, 100,000 output columns, 128 MiB realized UTF-8, and 8,388,608 analyst-text characters per cell/header/key; XLSX allows at most 1,000,000 output cells and 64 MiB uncompressed worksheet XML in addition to Excel's sheet/cell limits. Panel clipboard copy has a separate 15 MiB realized UTF-8 cap. Limit failures never truncate or write a partial file; see [copy and export](mkdocs-src/copy-export.md#guardrails).

The panel Settings menu can enable default-off column summary statistics. They are computed in the extension host from the current decoded result without rerunning q, and only compact summaries cross into the webview. Results at or below both 50,000 rows and 100,000 cells are exact; larger results use a clearly labelled deterministic evenly spaced sample of at most 10,000 rows, with sampled counts reported as observed rather than extrapolated.

The optional local data server exposes the current visible grid as tokenized CSV, JSON, or NDJSON endpoints on `127.0.0.1`. It never starts automatically. The URL is a temporary bearer secret: another local process that obtains it can read the exposed result, and `metadata.json` includes result metadata such as the connection name and query text. Stop the server when finished.

See [Results viewer](mkdocs-src/results-viewer.md), [copy and export](mkdocs-src/copy-export.md), [charting](mkdocs-src/charting.md), and [local data server](mkdocs-src/local-data-server.md).

## Jupyter notebooks

The default notebook workflow keeps the Python Jupyter kernel selected:

1. Select `Make q Cell (KX)` on the intended code cell.
2. Choose `Activate q Connection (KX)` and activate a saved profile.
3. Run the cell with `Run q Cell (KX)`, or select the q cell and use `Ctrl+Enter` / `Cmd+Enter`; the same shortcut also works while its text editor has focus.
4. Run Python cells with the normal Jupyter actions.

Direct q cells use only the globally active KX profile and reuse its q session. Legacy notebook-level target ID/name metadata is ignored safely and does not override the star; KX does not implicitly edit notebooks merely to remove it. The KX action writes completed output as an undoable notebook edit, so the notebook becomes dirty until saved. It will not overwrite a cell that changed while q was running.

Every successful first-party Direct IPC notebook execution automatically stores its complete result in a strict portable v2 rich payload, alongside a transient live result. `vscode-kdb.notebook.maxOutputRows` never limits that rich output, and `maxOutputBytes` limits only static fallbacks such as `text/plain`. Versioned exact q cells retain atom/vector identity, vector attributes, symbols versus character vectors, longs, temporals, nulls/infinities, and nested typed vectors through JSON save/reopen. Keyed-table key source ordinals are stored as optional validated schema metadata, so first-party saved/reopened output retains the same key-column styling; older payloads without that field remain unhighlighted. Default grid cells use the same selective concise display as the panel, qText remains conservative q syntax, and table copy/export uses the shared analyst conversion without rewriting the saved cells. Unsupported exact persistence—including a whole-table-column attribute or top-level dictionary identity—reports a technical failure with q type and bounded value detail instead of flattening, stringifying, truncating, or relabelling a preview as complete. Extension-managed connection credentials, session objects, and IPC handles are never written into notebook output.

Rerun always executes the current cell source again through a new bridge/IPC call, assigns fresh output and live identities, and replaces the cell with the complete new result. Bounded first-party v1/v2 Direct IPC previews already saved in notebooks remain readable and are labelled **Historical saved preview**; their Rerun action performs a new execution and upgrades the output rather than recovering omitted rows. Use VS Code/Jupyter's native **Clear Cell Output** and **Clear All Outputs** actions to remove output. KX adds no custom clear control, and clearing or removing an output also invalidates its transient live record so stale data cannot reappear. The separate Python `%%q` helper keeps its bounded v1 output contract.

Set `vscode-kdb.notebook.enableDirectController` to `true` to enable the optional pure-q `KX q (Direct IPC)` controller. This first-class Direct IPC controller then appears in the kernel picker and uses the active KX profile for normal q-cell Run commands. It remains opt-in so mixed Python/q stays the default, supports q code cells only, and rejects a leading `%%q`.

The separate `python/kx_notebook` helper is for a Python/IPython-owned evaluator and does not use or share the extension's direct IPC session. From a source checkout:

```sh
uv venv /tmp/vscode-kdb-kx-notebook
uv pip install --python /tmp/vscode-kdb-kx-notebook/bin/python \
  --editable ./python/kx_notebook
```

Configure an evaluator in that kernel before loading the magic:

```python
from kx_notebook import configure_evaluator

configure_evaluator(lambda source: my_existing_q_session(source))
%load_ext kx_notebook
```

This route requires Python 3.9 or newer, IPython, and an evaluator supplied by the user. Optional PyKX support requires a separate PyKX installation, configuration, and license. See the [notebook guide](mkdocs-src/notebooks.md) for cell-language handling, the `%%q` route, saved-output limits, and chart persistence.

## Optional sidebar features

Server Explorer and Query History are disabled by default:

```json
{
  "vscode-kdb.features.serverExplorer": false,
  "vscode-kdb.features.queryHistory": false
}
```

Server Explorer loads tables and safe variable/function metadata only on refresh or table expansion. Preview requires confirmation and limits table cells or outer list/dictionary items. Scalars and nested values can still be large. Functions and projections are metadata-only.

Query History stores issued editor query text, connection identity, status, timestamp, execution kind, and duration in local VS Code workspace extension storage. It does not store results or passwords and is not registered for Settings Sync or telemetry. Disabling it stops new entries but does not delete retained data; re-enable it and run `KX: Clear Query History` to erase the entries.

All supported settings and ranges are listed in the [settings reference](mkdocs-src/settings.md).

## Security and compatibility

Direct q IPC is plaintext in transit, including authentication and query traffic. The extension does not provide TLS, SSH tunnelling, a gateway, or a broker. Use loopback, a trusted private network, or a separately managed secure tunnel.

Complete-source execution does not depend on `.Q.ld`. No minimum q version is enforced; historical q releases are not maintained as a compatibility matrix.

Language support covers `.q` files with a TextMate grammar; `.k` is not associated with q. The extension does not provide language-server features such as linting or source formatting.

Open `View > Output` and select `KX` for connection, handshake, query, cancellation, and socket lifecycle diagnostics. Diagnostics omit credentials, query text, result values, and local-data-server tokens. Optional timing diagnostics can be enabled with:

```json
{
  "vscode-kdb.performance.trace": true
}
```

## Documentation and support

Start with the [user guide](mkdocs-src/index.md), [settings reference](mkdocs-src/settings.md), or [troubleshooting guide](mkdocs-src/troubleshooting.md).

Report bugs and documentation problems in the [GitHub issue tracker](https://github.com/dreth/vscode-kdb/issues).

## Development

Install dependencies and run the main compile/test suite:

```sh
npm ci
npm test
```

Additional maintained checks include:

```sh
npm run test:notebook-python
npm run test:notebook-cross
npm run test:extension-host
```

The live-q test detects `~/.kx/bin/q`, or accepts `VSCODE_KDB_Q_BIN=/absolute/path/to/q`:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

The live test is optional unless `VSCODE_KDB_LIVE_REQUIRED=1` is set.

## License

KX for VS Code is released under the [MIT License](LICENSE). Bundled third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

KX and the KX logo are trademarks of KX and are used only to identify KX/kdb+ integration. This independent project is not affiliated with or endorsed by KX. kdb+ and q are products of KX.
