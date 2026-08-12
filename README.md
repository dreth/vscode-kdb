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

Safe profile metadata is stored in the application-scoped `vscode-kdb.connections` user setting. Passwords are stored separately under connection-specific keys in VS Code SecretStorage and are not written back to settings or shown when a profile is edited. Removing a profile also removes its stored password.

| Setting | Default | Purpose |
| --- | ---: | --- |
| `vscode-kdb.connectionTimeoutMs` | `30000` | TCP connect and q IPC handshake timeout |
| `vscode-kdb.queryTimeoutMs` | `1800000` | Query response timeout |

Each value is in milliseconds. A per-profile value overrides its global default; blank inherits the default and `0` disables that deadline.

`KX: Import SQLTools KDB Connections` reviews eligible legacy KDB profiles already present in `sqltools.connections`. Import is one-time: it does not require SQLTools, change the source setting, overwrite an existing KX profile, or create ongoing synchronization. SSH-enabled profiles are not imported because this extension cannot reproduce the tunnel. Password transfer requires explicit confirmation and writes the copied value to SecretStorage.

See [Connections and SecretStorage](mkdocs-src/connections.md) for field validation, namespace behavior, timeouts, and import rules.

## Results

Editor results open in KX Results. The panel supports grid and q-text views, virtualized rows and columns, selection, search, sorting, column visibility and sizing, and configurable display density. Table headers use one consistent interaction: click cycles source/ascending/descending order, drag at least 5 CSS pixels reorders, `Ctrl`/`Cmd`+click selects a column, `Enter`/`Space` sorts, and `Alt`+Left/Right reorders. It can copy or export TSV, CSV, Markdown, JSON, NDJSON, HTML, plain text, and XLSX where applicable. Parquet export is not implemented.

Charts support line, scatter, step, bar, box, and candlestick views over eligible columns. Plain drag zooms X; `Shift`+drag, the Pan buttons, or Left/Right move the visible X range; `Home` resets. For the same absolute X range, pan completion uses the unchanged zoom range-loading and resampling decision; Y remains automatic for the visible X range. Large copy, export, sort, render, and chart operations are bounded or require confirmation. The complete q IPC response is decoded before display; virtualization reduces DOM work but does not stream the response.

The optional local data server exposes the current visible grid as tokenized CSV, JSON, or NDJSON endpoints on `127.0.0.1`. It never starts automatically. The URL is a temporary bearer secret: another local process that obtains it can read the exposed result, and `metadata.json` includes result metadata such as the connection name and query text. Stop the server when finished.

See [Results viewer](mkdocs-src/results-viewer.md), [copy and export](mkdocs-src/copy-export.md), [charting](mkdocs-src/charting.md), and [local data server](mkdocs-src/local-data-server.md).

## Jupyter notebooks

The default notebook workflow keeps the Python Jupyter kernel selected:

1. Select `Make q Cell (KX)` on the intended code cell.
2. Choose `Activate q Connection (KX)` and activate a saved profile.
3. Run the cell with `Run q Cell (KX)`, or use `Ctrl+Enter` / `Cmd+Enter` while the q cell editor has text focus.
4. Run Python cells with the normal Jupyter actions.

Direct q cells use only the globally active KX profile and reuse its q session. Legacy notebook-level target ID/name metadata is ignored safely and does not override the star; KX does not implicitly edit notebooks merely to remove it. The KX action writes completed output as an undoable notebook edit, so the notebook becomes dirty until saved. It will not overwrite a cell that changed while q was running.

First-party Direct IPC notebook output uses a strict portable v2 payload plus a transient live result. Preview mode defaults to 20 rows and obeys the 1,000,000-byte preview budget. While the live record exists, KX Results can open the full decoded value and the per-output **Preserve full result** checkbox directly stores every exactly representable row, column, and cell. Full persistence ignores preview row/byte limits; if exact representation is technically impossible, KX reports an ordinary failure instead of calling a preview full. Reopened full v2 output stays complete and can be unchecked back to a preview; reopened truncated previews and legacy/Python v1 output cannot recover omitted rows. Set `vscode-kdb.notebook.preserveFullResultByDefault` to check full persistence for new Direct IPC output by default. Extension-managed connection credentials, session objects, and IPC handles are never written into notebook output.

Set `vscode-kdb.notebook.enableDirectController` to `true` only for the optional q-only `KX q (Direct IPC)` controller. It then appears in the kernel picker and uses the active KX profile for normal q-cell Run commands. It supports q code cells only and rejects a leading `%%q`.

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
