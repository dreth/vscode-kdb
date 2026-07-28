# Settings

Open VS Code Settings and search for `vscode-kdb`, or edit settings JSON. The manifest is the source of truth for accepted values.

Connection records can be owned by User, Workspace, or Workspace Folder settings. Other settings can be set at their declared VS Code configuration scopes unless the UI writes a global preference. Result-panel preference controls write the corresponding global setting; they do not change settings silently.

## Notebook language and results

Notebook cell language is not a `vscode-kdb` setting. The default workflow keeps the Python controller selected: set only the intended code cells to q with **Make q Cell (KX)**, choose one saved target, and use **Run q Cell (KX)**. Python cells retain normal Jupyter Run. KX is absent from the kernel candidates by default; VS Code's top-right Jupyter selector itself remains.

Use the leading **Make q Cell (KX)** action. It applies VS Code's supported document-language setter to selected code cells, skips Markdown, preserves source/metadata/output, and does not switch the Python kernel. An actual q cell shows `KX: <profile> · Ctrl+Enter` (`Cmd+Enter` on macOS) and a notebook-level `q default` chooser. Only the chosen stable profile ID/name are persisted; credentials and endpoint fields are excluded. Every run resolves current profile data, so same-ID endpoint edits take effect and active-profile changes do not override the notebook target. Missing targets prompt rather than falling through.

VS Code's built-in Jupyter serializer stores a non-default q cell as raw `metadata.vscode.languageId: "q"`. If explicitly enabled, the optional KX controller appears in the kernel/controller selector, not the Python controller's per-cell language picker.

**KX: Restore Notebook Cell Language** resolves the notebook default from `language_info.name` or `kernelspec.language` and applies it only to selected code cells. For an ordinary IPython notebook that is Python. The command is shown only when a default is available and refuses to apply an unregistered language. It preserves cell source, marker, other metadata, and output.

| Setting | Default | Values / range | Behavior and tradeoff |
| --- | --- | --- | --- |
| `vscode-kdb.notebook.presentation` | `inline` | `inline`, `panel`, `both` | Automatic presentation for released-companion output. Direct IPC output from **Run q Cell (KX)** or the optional controller always remains inline and uses an explicit live/saved KX Results handoff button. No mode reruns q or recovers omitted rows. |
| `vscode-kdb.notebook.enableDirectController` | `false` | Boolean | Application-scoped opt-in that registers the legacy q-only **KX q (Direct IPC)** controller and offers it in the normal kernel picker. While false, mixed Make/Target/Run stays available, KX is not a kernel candidate, and a previously saved KX controller selection cannot be restored because that controller is unregistered. It does not remove VS Code's selector. |
| `vscode-kdb.notebook.maxOutputRows` | `20` | Integer `1`-`10000` | Maximum rows persisted in a new Direct IPC mixed-runner/optional-controller snapshot or inserted by the extension's optional Tag command. Tables at or below the bound persist fully; larger tables retain schema/headers, the bounded preview, total count, and truncation notice. `kx-notebook==0.1.0` separately accepts `%%q --max-rows`. |
| `vscode-kdb.notebook.maxOutputBytes` | `1000000` | Integer `16384`-`10000000` | Maximum portable MIME bytes for new direct snapshots and extension-tagged output. `kx-notebook==0.1.0` also accepts an explicit `%%q --max-bytes` limit. |

**KX: Tag Notebook Cell as q** is an optional editing aid: it first sets actual q language mode, then persists the current row/byte values in one `%%q` marker and nested `vscode-kdb` metadata. It preserves an existing marker, cell code, and unrelated metadata. A q-language cell without the marker exposes **Prepare this q cell for the active Python kernel**, which performs only marker/metadata preparation. Neither command is required by released `kx-notebook==0.1.0`.

These are output-serialization limits, not server-side q limits. The portable contract also caps schemas at 256 columns and cell text at 32,768 characters. The payload excludes credentials, passwords, authentication tokens, connection objects, recoverable IPC handles, and unbounded data. Output metadata may contain a random targeting ID so actions bind to the exact output; that ID contains no result or connection data and cannot restore a live result. A direct result's full value is transient extension-host state only: bound to the notebook/current-cell URI (and rebound after a mixed output edit), removed on rerun, cell removal, notebook close, or deactivation, and capped at 512 oldest-first records. Reopened output is the snapshot and cannot recover omitted data.

Mixed **Run q Cell (KX)** and the optional direct controller reject a leading `%%q`; they run ordinary complete-cell q. Mixed cells use the notebook's explicit current target, while the q-only controller uses the active session only if explicitly enabled and selected. The mixed action does not switch the Python controller. While the q cell editor itself has text focus, guarded `Ctrl+Enter` / `Cmd+Enter` runs and stays, `Shift+Enter` runs and moves next, and `Alt+Enter` / `Option+Enter` runs and inserts below. Move/insert occurs only after an executed result. Python, Markdown, cell-container, and output focus keep normal notebook behavior.

The released Python `%%q` companion is a distinct Python-kernel-owned route: start with and keep a Python-language cell, load `kx_notebook`, connect with `%kx connect` or select another explicit evaluator, and use normal Jupyter Run. A durable extension Direct IPC cell stays q-language instead; do not switch one cell back and forth. The companion does not share the extension Direct IPC session or receive its live record/output binding. Its bounded MIME output cannot supply omitted rows to the extension. **Run %%q live with KX** explicitly reruns the body as a new extension-selected Direct IPC execution after confirmation; it does not call Jupyter Run, reuse the helper session, or change the selected Python kernel.

`inline` is the default released-companion experience. For companion output, `panel` uses the saved-output KX Results panel and `both` retains inline output plus that handoff. Companion output has no extension live-result record/output binding, so the panel source is only the bounded saved payload. First-party direct output remains inline so its live viewer is available; use its concise KX Results button. User-resized inline table height and output-local sort/search/selection/chart configuration/zoom state persist only for that rendered result in the current notebook session. The visible notebook-only point-cap preference is removed. Supported density/sizing, display strategies, qText/array formatting, elapsed time, and chart guardrails use the same durable `vscode-kdb.results.*` configuration as the panel; Settings messages update and broadcast that common source of truth. In notebook output, the Settings overlay is height-constrained and scrollable inside the result. Its visible **Close** button and **Escape** dismissal both return focus to the Settings summary.

## Feature Controls

Server Explorer and Query History are independent, window-scoped, and disabled by default. This avoids unexpected remote metadata work, sidebar noise, or local persistence of sensitive query text.

| Setting | Default | Values / range | Behavior and tradeoff |
| --- | --- | --- | --- |
| `vscode-kdb.features.serverExplorer` | `false` | Boolean | Shows the focused Server Explorer for an active direct q IPC profile, including a disconnected/reconnect status. Metadata requires a connection and is manual-refresh/on-expand only; disabling disposes its provider and hides its view and commands. |
| `vscode-kdb.serverExplorer.previewCellLimit` | `10000` | Integer `1`-`1000000` | Server-side table/variable Preview cap: approximate table cells or outer list/dictionary items. Every preview still confirms because scalars and nested values can be large; functions/projections are metadata-only. |
| `vscode-kdb.features.queryHistory` | `false` | Boolean | Records actually issued editor query text in local workspace extension storage. Disabling stops writes and hides its view/commands, but retained entries require re-enabling and running **KX: Clear Query History** to erase them. |
| `vscode-kdb.queryHistory.maxEntries` | `100` | Integer `1`-`1000` | Maximum newest-first local entries; lowering the limit prunes the oldest. No result payload is stored. |

Server Explorer applies the active connection's configured namespace and never auto-refreshes or installs persistent server code. Preview accepts only standard q identifiers and warns before materialization. Local cancellation stops waiting but does not interrupt q work already sent.

Query History uses VS Code workspace `Memento`, not a syncable/global setting. It is not registered for Settings Sync and is not transmitted as telemetry. Stored fields are exact query text, stable connection ID and recorded label, timestamp, editor execution kind, status (`succeeded`, `failed`, or `canceled` after an issued run's local wait is canceled), and duration. Passwords and results are excluded. Query text can be commercially or personally sensitive, so enable the feature only in workspaces where local persistence is acceptable.

## Connections and diagnostics

### Legacy import input

`sqltools.connections` is not a KX setting and is not contributed, written, watched, or synchronized by this extension. **KX: Import SQLTools KDB Connections** may inspect an already-existing value through VS Code's configuration API only when the user invokes the command. It reviews matching legacy KDB candidates from user, workspace, and workspace-folder scopes; SQLTools itself can be absent.

Only normalized `KDB`, `kdb+`, `kdb`, `kdb-sqltools`, and `DanielAlonso.kdb-sqltools` driver values are eligible. Other drivers are ignored before their profile fields or passwords are inspected. Treat workspace settings as untrusted: every mapped field is validated against the standalone bounds, SSH-enabled profiles are not importable, and no `sshOptions` value is copied.

The imported `connectionTimeout` is interpreted as seconds and maps to the new profile's `connectTimeoutMs` only. `queryTimeoutMs` remains omitted, so it inherits the resolved global KX query default described below. Passwords are copied only after selected candidates receive an explicit modal one-time SecretStorage confirmation; users may choose the labelled import-without-passwords path or cancel. The source value remains unchanged and no ongoing sync exists.

| Setting | Default | Use |
| --- | --- | --- |
| `vscode-kdb.connections` | `[]` | Safe standalone connection metadata at User, Workspace, or Workspace Folder scope. Same-ID precedence is Folder > Workspace > User. The form preserves/moves ownership explicitly. User values are Settings Sync eligible where allowed; passwords remain separate in SecretStorage and never sync. |
| `vscode-kdb.connectionTimeoutMs` | `30000` | Global direct q IPC connect/handshake timeout in milliseconds. TCP connect and q IPC handshake each receive this full budget. `0` disables both phase deadlines. |
| `vscode-kdb.queryTimeoutMs` | `1800000` | Independent global query-response timeout in milliseconds (30 minutes). `0` disables only the query deadline. |
| `vscode-kdb.performance.trace` | `false` | Add safe operation timings, sizes, and counts to **Output > KX**. Query text/values, credentials, and local-server tokens are omitted or redacted. |

Timeout settings accept integers from `0` through `2147483647`. Connect/handshake and query response deadlines are independent: setting either global or per-profile value to `0` does not disable the other deadline. The query deadline begins when queued work becomes active and is sent, so time waiting behind another query is excluded. A query timeout discards the uncertain client.

Each object in `vscode-kdb.connections` has these safe fields:

| Field | Required | Use |
| --- | --- | --- |
| `id` | Yes | Extension-generated stable ID. |
| `name` | Yes | Unique display name. |
| `host` | Yes | Direct q host name or IP address. |
| `port` | Yes | Integer from `1` through `65535`. |
| `database` | Yes | q namespace, normally `.` or a value such as `.analytics`. |
| `username` | Yes | Optional username represented as a string; empty means none. |
| `connectTimeoutMs` | No | Per-connection connect/handshake override. Omit (leave blank in the form) to inherit the global connect default; `0` disables both deadlines. |
| `queryTimeoutMs` | No | Per-connection query override. Omit (leave blank in the form) to inherit the resolved global query default; `0` disables it. |

Existing connection objects without either override remain valid and need no migration. A blank or omitted per-connection query override inherits the global `queryTimeoutMs` value, whose default is 30 minutes; it does not copy a global or per-connection connect override. Password is deliberately absent from this schema and must not be added manually. Editing with a blank password keeps the SecretStorage value; **Clear saved password** removes it explicitly.

Workspace-defined profiles live with the project and survive container recreation; remote/container User settings are not a durable project substitute. SecretStorage is local to the relevant VS Code environment, so passwords may need re-entry after moving between local, remote, or container hosts.

The `KX` Output channel always receives connection/query lifecycle diagnostics. Performance trace adds detail only when explicitly enabled. The extension does not enable it for you.

Enabled performance records also retain their `[vscode-kdb:perf]` Extension Host console entry for development compatibility; use **Output > KX** for normal troubleshooting.

## Result display

| Setting | Default | Values / range | Use |
| --- | --- | --- | --- |
| `vscode-kdb.results.viewer.initialViewColumn` | `active` | `active`, `beside`, `one`, `two`, `three` | Editor group for the first result panel. |
| `vscode-kdb.results.viewer.arrayDisplayFormat` | `commaSpace` | `commaSpace`, `space`, `raw` | Array/list cell display text. |
| `vscode-kdb.results.viewer.functionDisplayStrategy` | `qText` | `grid`, `qText` | Top-level functions and function-like values. |
| `vscode-kdb.results.viewer.dictionaryDisplayStrategy` | `grid` | `grid`, `qText` | Top-level dictionaries. |
| `vscode-kdb.results.viewer.listDisplayStrategy` | `grid` | `grid`, `qText` | Top-level general/mixed/object lists. |
| `vscode-kdb.results.viewer.objectDisplayStrategy` | `grid` | `grid`, `qText` | Other top-level composite objects. |
| `vscode-kdb.results.qText.syntaxHighlighting` | `false` | Boolean | Apply lightweight, theme-aware q token colors only to qText result display. Raw text is rendered through text nodes/spans, never raw HTML. |
| `vscode-kdb.results.qText.displayFormatting` | `false` | Boolean | Apply conservative view-only layout to supported balanced q lambda/block structures; malformed or ambiguous input remains exact raw qText. |
| `vscode-kdb.results.density` | `standard` | `compact`, `standard`, `comfortable` | Active grid density. |
| `vscode-kdb.results.showRowIndex` | `true` | Boolean | Show the visual row-number column. |
| `vscode-kdb.results.elapsedTimeDisplay` | `auto` | `auto`, `milliseconds` | Result elapsed-time formatting. |

True q tables and keyed tables remain grids. q-text has a large-character safety cap and marks truncation. Both readability settings are disabled by default, do not affect source editors or execute q, and propagate to open/reused result panels and live direct notebook results.

The KX Results panel and notebook renderer use the same `vscode-kdb.results.*` schema for density/dimensions, row-index display, output defaults, copy/export threshold, elapsed time, qText/value strategies, and chart precision/source/sampling. A supported change made in either surface updates the same global setting and propagates to open panels and KX notebook outputs. `vscode-kdb.notebook.*` remains separate only for genuine notebook lifecycle/presentation concerns such as portable snapshot limits, direct-controller registration, and companion-output presentation. Per-output selection, visible-column order, sort, search, height, chart selection, hidden series, and zoom are transient and are not written into `.ipynb`.

Font size keeps its existing numeric storage contract. A value of `0` still means “use the VS Code default,” but notebook Settings presents that state as **Auto** rather than an ambiguous raw zero. Entering `0` or clearing the field writes `0`; no second preference or per-output font-size state is created.

Array display examples:

| Value | Example |
| --- | --- |
| `commaSpace` | `1, 2, 3` |
| `space` | `1 2 3` |
| `raw` | `[1 2 3]` where bracketed q-like display is available |

## Density dimensions

| Setting | Default | Range |
| --- | --- | --- |
| `vscode-kdb.results.compact.cellWidth` | `140` | 80-600 px |
| `vscode-kdb.results.compact.rowHeight` | `24` | 20-80 px |
| `vscode-kdb.results.compact.fontSize` | `0` (**Auto**) | 0-32 px; stored `0` uses the VS Code default |
| `vscode-kdb.results.standard.cellWidth` | `160` | 80-600 px |
| `vscode-kdb.results.standard.rowHeight` | `28` | 20-80 px |
| `vscode-kdb.results.standard.fontSize` | `0` (**Auto**) | 0-32 px; stored `0` uses the VS Code default |
| `vscode-kdb.results.comfortable.cellWidth` | `180` | 80-600 px |
| `vscode-kdb.results.comfortable.rowHeight` | `32` | 20-80 px |
| `vscode-kdb.results.comfortable.fontSize` | `0` (**Auto**) | 0-32 px; stored `0` uses the VS Code default |

## Charting

| Setting | Default | Use |
| --- | --- | --- |
| `vscode-kdb.results.viewer.chartMaxSourceRows` | `2000000` | Maximum source rows scanned for a built-in chart; minimum `1`. |
| `vscode-kdb.results.viewer.chartDecimalPlaces` | `4` | Numeric axes, tooltip, legend, box, and OHLC precision; `0`-`12`. |
| `vscode-kdb.results.viewer.chartZoomMinSampledPoints` | `3000` | Minimum visible sampled points before eligible settled zooms auto-refine; minimum `1`. |
| `vscode-kdb.results.viewer.chartZoomMaxSampledPoints` | `7000` | Maximum refined sample size; clamped to at least the minimum setting. |

## Copy, export, and warnings

| Setting | Default | Use |
| --- | --- | --- |
| `vscode-kdb.results.includeHeaders` | `true` | Include headers by default. |
| `vscode-kdb.results.includeRowIndex` | `true` | Include 1-based row numbers by default. |
| `vscode-kdb.results.hideLargeResultWarnings` | `false` | Hide the non-blocking result-size notice. |
| `vscode-kdb.results.hideLargeSortWarnings` | `false` | Skip the large-sort confirmation. |
| `vscode-kdb.results.copyExportConfirmCellThreshold` | `1000000` | Selected-cell threshold for copy/export confirmation; minimum `1`. |
| `vscode-kdb.results.localDataServerFullExportCellLimit` | `1000000` | Visible-cell hard limit for local-server `current.*` endpoints; minimum `1`. |

## Example

```json
{
  "vscode-kdb.features.serverExplorer": false,
  "vscode-kdb.serverExplorer.previewCellLimit": 10000,
  "vscode-kdb.features.queryHistory": false,
  "vscode-kdb.queryHistory.maxEntries": 100,
  "vscode-kdb.notebook.presentation": "inline",
  "vscode-kdb.notebook.enableDirectController": false,
  "vscode-kdb.notebook.maxOutputRows": 20,
  "vscode-kdb.notebook.maxOutputBytes": 1000000,
  "vscode-kdb.connectionTimeoutMs": 30000,
  "vscode-kdb.queryTimeoutMs": 1800000,
  "vscode-kdb.performance.trace": false,
  "vscode-kdb.results.viewer.arrayDisplayFormat": "space",
  "vscode-kdb.results.viewer.functionDisplayStrategy": "qText",
  "vscode-kdb.results.qText.syntaxHighlighting": false,
  "vscode-kdb.results.qText.displayFormatting": false,
  "vscode-kdb.results.density": "standard",
  "vscode-kdb.results.includeHeaders": true,
  "vscode-kdb.results.includeRowIndex": true,
  "vscode-kdb.results.copyExportConfirmCellThreshold": 1000000
}
```
