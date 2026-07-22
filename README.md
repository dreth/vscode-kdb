# KX for VS Code

KX for VS Code is a standalone extension for working with kdb+/q directly in Visual Studio Code. It provides q language support, extension-owned direct q IPC connections, exact editor execution, portable Jupyter/IPython result output, optional first-party server exploration and local query history, and a high-performance native result panel.

Version 0.2.0 has no SQLTools dependency. It does not call SQLTools APIs, contribute SQLTools commands, or create or interpret `.session.sql` files.

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

For an ordinary Jupyter/IPython notebook, install the focused `python/kx_notebook` helper into that notebook's Python environment, configure its explicit evaluator callback, load the IPython extension, and use **KX: Tag Notebook Cell as q**. The command inserts a durable `%%q` marker and bounded-output options; it does not replace the notebook's Python controller or execute q by itself. See [Jupyter/IPython notebooks](#jupyteripython-notebooks).

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

Connection errors identify the failed `connect`, `handshake`, or `query` phase and direct host/port so endpoint, network, authentication, and q-listener problems can be distinguished. They do not include credentials or query contents.

### KX Connection form

**Add Connection** and **Edit Connection** open the same responsive, theme-aware **KX Connection** form instead of a sequence of VS Code prompts. Name, host, port, namespace/database, username, and password are visible together. Name and host are required, names are unique, port is an integer from `1` through `65535`, and namespace defaults to `.`. The help text explains that the endpoint is direct q IPC and that the database value is the q namespace used for editor runs.

The collapsible **Advanced direct q IPC** section provides optional per-connection **Connect / handshake timeout (ms)** and **Query timeout (ms)** overrides. Leave a value blank to use its global default. Only whole numbers from `0` through `2147483647` are accepted; `0` disables that timeout. No SSH, TLS, gateway, broker, keep-alive, or reconnect-policy controls are presented.

**Save Connection** is enabled only when the browser-level form checks pass, and every submitted message is validated again by the extension host before storage. Enter submits a valid form. Escape and **Cancel** close it without changing storage or the current connection. Labels, descriptions, an announced error region, invalid-field focus, and initial name-field focus support keyboard and screen-reader use. **Delete Connection** appears when editing and opens an explicit modal VS Code confirmation; the webview does not use browser `confirm`.

When editing a connection with a saved password, the password input is always empty and says to leave it blank to keep the existing secret. Enter a value to replace the secret, or select **Clear saved password** to delete it. The saved value itself is never sent back to the webview.

The visible **Test Connection** button validates and tests the current unsaved name, endpoint, namespace, username, password choice, and effective timeout overrides/defaults without saving the profile or touching its active client. It opens a separate temporary direct IPC socket, proves the handshake, validates a non-root namespace with a read-only expression while confirming the temporary session namespace is unchanged, performs a minimal response check, and closes the socket. Starting another test, saving, canceling, or closing the form cancels the older test; generation checks prevent late results from replacing current status. Status identifies validation, connect, handshake, namespace, query, or cancel without showing credentials or request text.

On Edit, a blank password may use the saved SecretStorage value for this test only; status says that a saved secret was used but never reflects it. Entered passwords remain in memory, and **Clear saved password** means test without that stored value. Testing never writes settings, SecretStorage, Query History, or diagnostics containing a credential.

### Timeout behavior

`vscode-kdb.connectionTimeoutMs` is the global connect/handshake default and remains `30000` milliseconds. The same complete budget applies separately to the TCP connect phase and then to the q IPC handshake phase. `vscode-kdb.queryTimeoutMs` defaults to `null`, which inherits `connectionTimeoutMs` for compatibility with existing profiles; set an integer to configure a separate global query timeout. A blank per-connection override inherits the corresponding resolved global value.

The query timer starts when a queued query becomes active and is sent; time spent waiting behind an earlier query on the same connection is not included. A query timeout drops the uncertain socket. Every timeout accepts `0` to disable it and is bounded at `2147483647` milliseconds.

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

The native TextMate grammar remains unchanged after its 0.1.4 review because no reliable token-coverage defect was found. `.k` is not associated with q: broadening that file association without a demonstrated, testable need could conflict with other VS Code language support.

Whole-document runs and multiline selections use [q's own documented script-line grouping](https://code.kx.com/q/ref/dotq/#ld-load-and-group), including q indentation and script termination rules; they require q 4.0 dated 2023-03-28 or newer (or q 4.1t dated 2022-11-01 or newer). Single-line selections and current-line execution remain raw q queries and do not use this grouping helper.

Queries use the active connection. A normal run replaces the active result panel; **Run Selection in New Result** keeps the existing panel and opens another.

Canceling a result wait is local and best-effort: the panel stops waiting immediately, but q computation or side effects already sent to the server can continue. It does not cancel other queued result panels on the same connection. Use **Disconnect** when you intentionally need to close that connection and fail its outstanding work.

## Jupyter/IPython notebooks

Version 0.2.0 adds persistent KX/q output to ordinary `.ipynb` code cells without contributing a notebook controller or modifying Microsoft Jupyter. Python cells continue through the selected Python kernel, Markdown remains ordinary notebook Markdown, and a q cell is durably identified by a leading `%%q` marker plus `vscode-kdb` namespaced cell metadata. Do not rely on a Python controller preserving a cell language ID of `q`.

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

The helper never opens a q connection. Optional PyKX use is explicit through `kx_notebook.pykx.configure_pykx()` and requires PyKX to be installed, configured, and licensed separately in the kernel. No q or PyKX binary is bundled.

**KX: Tag Notebook Cell as q** inserts a marker using the configured defaults:

```q
%%q --max-rows 1000 --max-bytes 1000000
select from trade where date=.z.D
```

It also writes versioned `vscode-kdb` cell metadata recording the q marker and limits. The marker is the portable source of truth. The helper validates options before calling the evaluator and publishes `application/vnd.kx.result+json` version 1 together with escaped `text/html` and `text/plain` fallbacks. The saved bundle contains a typed bounded table preview, schema, total and preview row counts, safe label/elapsed metadata, explicit truncation reasons, and an optional chart specification. It never stores credentials, access tokens, passwords, IPC handles, or an unbounded full result.

The inline renderer provides a compact table, bounded preview CSV copy, and uPlot line/scatter/step/bar charts with type/column controls and Reset zoom. An emitted chart specification persists in the notebook. Changes made only in renderer controls are session state and do not rewrite the `.ipynb`; re-emit the result with the desired chart specification to persist them. The HTML fallback contains the schema, row count, bounded preview, transfer/truncation notice, and a network-free static SVG for a persisted chart. Notebook HTML/PDF export is static and does not preserve arbitrary uPlot interaction.

`vscode-kdb.notebook.presentation` accepts `inline`, `panel`, or `both` and defaults to `inline`. Panel display is only a handoff of the saved bounded preview to the existing KX Results panel. It is not a live-result locator, cannot recover omitted rows, and remains available after reopening only because the bounded preview itself is in the notebook. Full omitted data exists only in the originating evaluator/session while that session retains it.

There is deliberately no extension-driven same-session notebook routing in 0.2.0. KX for VS Code does not intercept the Jupyter controller, does not secretly use its editor IPC connection for a `%%q` cell, and does not create a misleading second direct q connection. The configured helper callback is the sole notebook evaluator. Normal `.q` editor execution and its live full-result panel remain unchanged. See the complete [notebook guide](mkdocs-src/notebooks.md).

## Query History

When `vscode-kdb.features.queryHistory` is enabled, issued editor executions are stored newest first in **KX Query History**. Recording starts only after a line, selection, or script is actually sent. Each local entry contains the exact query text, stable connection ID and recorded label, timestamp, execution kind, status (`succeeded`, `failed`, or `canceled` after an issued run's local wait is canceled), and duration; result payloads and passwords are never stored. Runs that never reach q are not recorded.

History uses VS Code workspace `Memento` storage on the local machine. It is not written to user or workspace settings, registered for Settings Sync, transmitted as telemetry, or sent anywhere except when the user explicitly reruns that q text. `vscode-kdb.queryHistory.maxEntries` defaults to `100` and accepts `1` through `1000`; lowering it prunes the oldest retained entries.

Entry actions rerun, copy, insert into the active editor, or delete one entry. **KX: Clear Query History** requires confirmation. Rerun uses the same exact q execution, active-connection, configured-namespace, timeout, cancellation, error, diagnostic, and result pipeline as editor execution. After normal connection selection resolves the target, KX confirms every mismatch with the recorded stable ID—even when no profile was active or the recorded profile was removed—before issuing text. Renamed or removed profiles remain safely identified without exposing credentials.

## Result panel

Normal `.q` editor results open in the KX-owned viewer; there is no alternate SQLTools result target. A notebook can explicitly hand its saved bounded preview to the same viewer, but that does not restore omitted data. The viewer includes:

- columnar result storage and row virtualization for responsive large-table browsing;
- native q scalar, vector, dictionary, keyed-table, table, and text/function presentation, with configurable grid or q-text display where appropriate;
- cell/range selection, keyboard navigation, search, sorting, column visibility and sizing, and compact-to-comfortable density controls;
- copy and export for selections or full results, including CSV, XLSX, TSV, JSON, NDJSON, HTML, Markdown, and plain text as applicable;
- line, scatter, step, bar, box, and candlestick charts, grouped series, zoom/refinement, and PNG export; and
- an opt-in, tokenized local data endpoint bound only to `127.0.0.1` for controlled CSV/JSON/NDJSON access to the current result.

Large copy, export, rendering, and chart operations have configurable safety limits. The viewer exposes only implemented actions; it does not contain placeholder explorer or gateway controls.

qText result readability has two independent settings, both disabled by default: `vscode-kdb.results.qText.syntaxHighlighting` and `vscode-kdb.results.qText.displayFormatting`. Highlighting is limited to qText result output, uses VS Code theme colors, and creates text nodes/spans rather than interpolating result text into HTML. Display formatting is a conservative, non-mutating view transform for supported balanced lambda/block structures; strings and comments are preserved, and ambiguous or malformed input falls back to the exact raw text. Settings changes update open and reused result panels. Neither setting changes q source editors, executes q, or mutates copy/export source data.

Chart **Reset zoom** retains an immutable baseline for the original complete numeric or temporal X domain. Manual zoom and automatic/explicit refinement can replace the displayed sample without replacing that baseline; Reset restores the original sample/domain, returns Y to automatic scale, and clears selection, tooltip, and pending refinement state.

## Diagnostics

Open **View > Output** and select **KX** for connection, handshake, query, cancellation, disconnect, and close lifecycle diagnostics. Records include the phase and direct host/port where useful, but omit query text and result values. Authentication credentials, SecretStorage values, and local-data-server tokens are redacted or omitted.

For additional safe operation timings, enable this setting explicitly:

```json
"vscode-kdb.performance.trace": true
```

The setting is opt-in and is never changed automatically. Performance tracing adds operation durations, sizes/counts, and memory details to the KX output without logging query values or credentials.

## Focused standalone scope

Version 0.2.0 keeps extension-owned `.q` execution direct-q-IPC-only and adds a bounded notebook MIME renderer/helper path without a controller or remote bridge. Its Server Explorer is intentionally limited to read-only metadata and confirmed previews in the current configured namespace; it is not a KDB-X, q Professional, Insights, gateway, or remote-administration replacement. SSH setup, TLS termination, gateway or broker configuration, broad namespace browsing, remote connection orchestration, extension-driven notebook execution routing, full notebook-result recovery, and server-side interruption remain outside this release.

## Development and verification

Requirements: a current Node.js/npm installation and a supported VS Code installation for local extension development. Notebook-helper development also uses `uv`; do not install its test dependencies into system Python.

```sh
npm ci
npm run compile
node test/run.js
npm run test:unit
npm test
uv run --no-project --with-editable ./python/kx_notebook \
  python -m unittest discover -s python/kx_notebook/tests -v
```

`node test/run.js` is the focused harness for q IPC serialization/deserialization, q-text selection/current-line extraction, notebook MIME validation/bounds/fallbacks/renderer messages, qText result lexing/safe rendering/conservative formatting/live settings, connection-form validation and temporary-test lifecycle, SecretStorage keep/replace/clear behavior, persisted-first connection lifecycle, namespace wrapping, chart zoom baseline/reset/refinement contracts, Server Explorer request/identifier/stale/preview contracts, Query History privacy/storage/order/rerun contracts, diagnostics/redaction, result conversion, and manifest/source/webview guards. The isolated Python suite verifies the companion serializer, MIME fallbacks, static chart, escaping, callback magic, and optional PyKX boundary. `npm run test:unit` and `npm test` compile and run the JavaScript harness. These checks are not labelled as visual Extension Host E2E, and no screenshot is presented as substitute evidence.

Run the pinned cross-extension evidence gate from this standalone checkout with `npm run test:parity`. The checked report predates 0.2.0 and contains 63 classified cases and 381 assertions: 49 `PASS`, 5 `DIFFERENT_BY_DESIGN`, 3 `GAP`, and 6 `NOT_TESTABLE_HERE`, split into 38 deterministic, 14 live-q, and 11 boundary cases. It compares q decode/display semantics, editor/namespace contracts, all six pure chart engines, text/XLSX export structure, direct IPC lifecycle/errors, local HTTP behavior, package boundaries, and an anonymous loopback q fixture; it is not notebook evidence. `PASS` is case-scoped and is not complete functional or visual parity. See [the evidence report](PARITY_RUN.md) and [exact paths, overrides, strict mode, and report commands](test/parity/README.md). The default reference is pinned to `kdb-sqltools` commit `af2c7c9` at `/opt/data/home/projects/kdb-sqltools`, and q is required at `/opt/data/home/.kx/bin/q` unless explicitly overridden. The strict sign-off command remains blocked by the three recorded gaps.

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
npx @vscode/vsce package --out vscode-kdb-0.2.0.vsix
python - <<'PY'
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

source = Path("vscode-kdb-0.2.0.vsix")
with ZipFile("vscode-kdb-0.2.0-vsix.zip", "w", ZIP_DEFLATED, compresslevel=9) as archive:
    archive.write(source, arcname=source.name)
PY
python scripts/audit-release.py vscode-kdb-0.2.0.vsix vscode-kdb-0.2.0-vsix.zip
```

The wrapper contains exactly one file: the byte-identical VSIX. The release auditor checks both archives' paths, duplicates, encryption flags, symlinks, CRCs, manifest/assets, compiled/runtime inventory, nested archives, credential indicators, forbidden sources, raw embedded bytes, names, versions, and SHA-256 hashes. The VSIX is assembled through `.vscodeignore`; development dependencies, tests, caches, source maps, prompt files, archives, and local secrets are excluded from the release artifact.

## Competitive references and reuse

[q Professional / `jshinonome/vscode-k-pro` at `fc9afacaeaf5e90eb013eb34426488841cc24f2a`](https://github.com/jshinonome/vscode-k-pro/tree/fc9afacaeaf5e90eb013eb34426488841cc24f2a) documents a formatter and informed product-level readability research only. Its public repository license is all-rights-reserved, so no source code, logic, or assets were copied.

[KX's `KxSystems/kx-vscode` at `1c745bf0221dd3cca85dce925c4d432d80bb5ef5`](https://github.com/KxSystems/kx-vscode/tree/1c745bf0221dd3cca85dce925c4d432d80bb5ef5) was inspected as an Apache-2.0 reference. Its `kdb.ls.q.lint` command is qlint integration—linting, not a general qText result pretty-printer. Version 0.2.0 adapts no source code, logic, or assets from it or q Professional, so `THIRD_PARTY_NOTICES.md` needs no new entry. SQLTools remains absent as a runtime or UI dependency. See [PARITY.md](PARITY.md) for the bounded competitive audit; these references do not imply full KDB-X or q Professional parity.

## License

KX for VS Code is released under the [MIT License](LICENSE). Bundled third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

KX and the KX logo are trademarks of KX. They are used here solely to identify KX/kdb+ integration. This independent project is not affiliated with or endorsed by KX.

kdb+ and q are products of KX. This project is not a SQLTools extension and does not require SQLTools to be installed.
