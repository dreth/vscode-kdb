# Performance & Large Results

The result viewer is designed to stay usable with large tables, but q IPC responses are not streamed through the complete pipeline.

Direct notebook execution keeps the decoded live value in extension-host memory while its live record exists and automatically writes every exactly representable row using the typed portable v2 contract. The authoritative rich output therefore remains complete after reopening and can make the notebook large; it deliberately ignores helper-preview and static-fallback row/byte limits. A value outside the exact contract fails explicitly instead of being saved as a partial result labelled complete.

## Memory and rendering model

The extension receives and decodes the complete q IPC response before the panel or notebook can show it. Table data is retained in columnar form in the extension host. The webview then requests only bounded row/column windows, so DOM and message traffic are virtualized.

Virtual scrolling reduces browser work; it does not reduce the original q response, decode allocation, or extension-host storage. Limit at the q server when the full dataset is not required:

```q
1000#select from trade where date=.z.D
```

Prefer server-side aggregation before charting:

```q
select avg price by 0D00:05 xbar time from trade where date=.z.D
```

## Built-in safeguards

| Operation | Default safeguard |
| --- | --- |
| Result notice | Non-blocking notice at 5,000,000 cells, 1,000,000 rows, or 500 columns. |
| Search (panel and live notebook) | At most 1,000 matching rows; a scan can stop after 2,000,000 cells or about 1.5 seconds and reports partial status. |
| Sort (panel and live notebook) | Confirmation only above `vscode-kdb.results.largeSortWarningRowThreshold`, which defaults to 5,000,000 rows; exactly 5,000,000 does not warn. Confirmation approves only the exact displayed result, while the global hide setting skips the guardrail. |
| Column summaries (panel only, opt-in) | Exact only through both inclusive limits of 50,000 rows and 100,000 cells. Larger results use deterministic evenly spaced sampling of at most 10,000 rows and 100,000 cells, labelled sampled/partial. |
| Copy/export | Confirmation at 1,000,000 selected cells or an estimated 50 MiB; large realized clipboard output gets another export suggestion. |
| Built-in chart | Rejects sources over 2,000,000 rows by default. Initial/full and ranged line/scatter/step views show all eligible finite points below 7,000 and deterministically target exactly 7,000 at or above that count; semantic groups/candles may be fewer. |
| Local server full export | Rejects more than 1,000,000 visible cells by default. |
| Local server slice | Fixed maximum of 1,000,000 requested cells. |
| q-text | Bounds nested traversal at 16 levels; caps very large output at 1,048,576 characters and marks character truncation. |
| Notebook live registry | Current extension-host session only; records are bound to notebook/cell URI, removed on rerun, cell removal, native output clearing, notebook close, or deactivation, capped at 512, and oldest-first evicted. Each result caches at most four full sort orders. |
| Notebook live slice | At most 500 rows, 128 columns, 20,000 cells, and 2,000,000 aggregate text characters per host message; individual display cells cap at 65,536 characters. |
| Notebook saved output | Every successful first-party Direct IPC run automatically persists complete exact rich v2 output without the `maxOutputRows` or `maxOutputBytes` ceilings. Its saved grid and column controls page through bounded windows, bound visible cell/page text and search work, and display at most 1,048,576 full-qText characters with an explicit notice; Copy/Export with no selection still uses every retained visible column or the complete saved qText. The 1-10,000-row and 16,384-10,000,000-byte settings continue to bound tagged Python-helper previews and static fallback material where applicable. Historical preview payloads retain their declared 256-column, 32,768-character cell, and 1,048,576-character qText safety limits. |

Some cell and chart limits are configurable. Internal time, byte-size, group-count, and file-format limits remain protective boundaries. Raising a configurable limit can temporarily block the extension host.

Large-sort approval is transient result state. Cancellation does not grant it, and re-execution, replacement, reopening, or a new output identity resets it. Column summaries use the already-decoded result without another q query, retain source-column ordinals, and send only compact payloads to the webview. In bounded mode, evaluated, valid, null, distinct, frequent-value, and numeric/temporal metrics describe only the deterministic sample; no count is extrapolated to unevaluated rows.

Notebook row/byte options constrain tagged Python-helper previews and static fallback material where applicable, not q execution or authoritative first-party rich persistence. Apply a q-side limit when the full q value itself should not materialize or be stored. A historical or Python-helper preview has no recovery handle for omitted rows in the `.ipynb`; rerunning a historical first-party preview executes the current cell source and replaces it with new complete exact v2 output. Native output clearing removes the output and its live ownership so stale data cannot reappear. Cell removal, notebook close, deactivation, oldest-first eviction, or reopening likewise cannot recover rows absent from a saved preview.

## Timeout and queue behavior

`vscode-kdb.connectionTimeoutMs` defaults to 30,000 milliseconds. It applies a complete budget to TCP connect and then a new complete budget to q IPC handshake. The independent `vscode-kdb.queryTimeoutMs` defaults to 3,600,000 milliseconds (60 minutes). Mixed q-cell execution and the optional pure-q controller both inherit the active profile's effective query timeout and add no separate 30-second query ceiling.

The **KX Connection** form's **Advanced direct q IPC** section accepts optional per-profile `connectTimeoutMs` and `queryTimeoutMs` overrides. Blank inherits the corresponding global value, including for existing profiles whose query override is omitted. Every timeout is a whole number from `0` through `2147483647` milliseconds; use `0` only when an unbounded phase wait is intentional. Zero disables only the corresponding connect/handshake or query response deadline.

The query timer starts when queued work becomes active and the client sends it, not when it first enters the per-connection queue. It runs until the response completes. Expiry destroys and drops the uncertain socket so a later query reconnects instead of reusing it.

A connection serializes its q query requests. Local panel or direct-notebook cancellation stops waiting for one result but does not undo work already sent to q or cancel other queued work. Pre-dispatch notebook cancellation sends nothing. Disconnecting closes the client and fails its outstanding queue.

## Diagnostics

Open **View > Output** and select **KX**. Lifecycle events are always available there for connection, handshake, query, cancellation, disconnect, and close transitions. They include the phase, effective timeout/disabled state for connect, handshake, and active queries, and direct `host:port` where useful.

For safe timing detail, explicitly enable:

```json
{
  "vscode-kdb.performance.trace": true
}
```

Timing records include operation names, durations, sizes/counts, and memory snapshots where implemented. Query text and result values are not logged. Passwords, authentication credentials, SecretStorage values, and local-data-server tokens are omitted or redacted. The extension does not mutate this setting automatically.

For development compatibility, the same performance records retain their `[vscode-kdb:perf]` entry in the Extension Host console. **Output > KX** is the supported user-facing place to collect them.

Performance trace can add small measurement and output overhead. Disable it after troubleshooting.

## External analysis

The optional [Local Data Server](local-data-server.md) provides an explicit loopback workflow with bounded slices and tokenized endpoints. For data that should never be fully loaded into VS Code, query and aggregate it directly in q or use a separately managed client suited to that volume.
