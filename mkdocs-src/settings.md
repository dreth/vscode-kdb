# Settings

Open VS Code Settings and search for `vscode-kdb`, or edit settings JSON. The manifest is the source of truth for accepted values.

Connection records are application-scoped user metadata. Other settings can be set at normal VS Code configuration scopes unless the UI writes a global preference. Result-panel preference controls write the corresponding global setting; they do not change settings silently.

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

| Setting | Default | Use |
| --- | --- | --- |
| `vscode-kdb.connections` | `[]` | Safe standalone connection metadata. Manage it through the **KX Connection** form; passwords are stored separately in SecretStorage. |
| `vscode-kdb.connectionTimeoutMs` | `30000` | Global direct q IPC connect/handshake timeout in milliseconds. TCP connect and q IPC handshake each receive this full budget. `0` disables both phase deadlines. |
| `vscode-kdb.queryTimeoutMs` | `null` | Global query-response timeout in milliseconds. `null` inherits `connectionTimeoutMs` for compatibility; `0` disables the query deadline. |
| `vscode-kdb.performance.trace` | `false` | Add safe operation timings, sizes, and counts to **Output > KX**. Query text/values, credentials, and local-server tokens are omitted or redacted. |

Timeout settings accept integers from `0` through `2147483647`. The query deadline begins when queued work becomes active and is sent, so time waiting behind another query is excluded. A query timeout discards the uncertain client.

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

Existing connection objects without either override remain valid and need no migration. The default global `queryTimeoutMs: null` resolves to the global `connectionTimeoutMs` value. A blank per-connection query override inherits that resolved global query value; it does not copy a per-connection connect override. Password is deliberately absent from this schema and must not be added manually. Editing with a blank password keeps the SecretStorage value; **Clear saved password** removes it explicitly.

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
| `vscode-kdb.results.density` | `standard` | `compact`, `standard`, `comfortable` | Active grid density. |
| `vscode-kdb.results.showRowIndex` | `true` | Boolean | Show the visual row-number column. |
| `vscode-kdb.results.elapsedTimeDisplay` | `auto` | `auto`, `milliseconds` | Result elapsed-time formatting. |

True q tables and keyed tables remain grids. q-text has a large-character safety cap and marks truncation.

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
| `vscode-kdb.results.compact.fontSize` | `0` | 0-32 px; `0` uses the VS Code default |
| `vscode-kdb.results.standard.cellWidth` | `160` | 80-600 px |
| `vscode-kdb.results.standard.rowHeight` | `28` | 20-80 px |
| `vscode-kdb.results.standard.fontSize` | `0` | 0-32 px; `0` uses the VS Code default |
| `vscode-kdb.results.comfortable.cellWidth` | `180` | 80-600 px |
| `vscode-kdb.results.comfortable.rowHeight` | `32` | 20-80 px |
| `vscode-kdb.results.comfortable.fontSize` | `0` | 0-32 px; `0` uses the VS Code default |

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
  "vscode-kdb.connectionTimeoutMs": 30000,
  "vscode-kdb.queryTimeoutMs": null,
  "vscode-kdb.performance.trace": false,
  "vscode-kdb.results.viewer.arrayDisplayFormat": "space",
  "vscode-kdb.results.viewer.functionDisplayStrategy": "qText",
  "vscode-kdb.results.density": "standard",
  "vscode-kdb.results.includeHeaders": true,
  "vscode-kdb.results.includeRowIndex": true,
  "vscode-kdb.results.copyExportConfirmCellThreshold": 1000000
}
```
