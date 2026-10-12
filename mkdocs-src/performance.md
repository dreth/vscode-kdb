# Performance & Large Results

The result viewer is designed to stay usable with large tables, but q IPC responses are not streamed through the complete pipeline.

Direct notebook execution automatically writes every exactly representable row using the typed portable v2/v3/v4 contracts. With a positive `maxOutputRows`, it also keeps the decoded value in extension-host memory while the live record exists. Set the row setting to `0` to avoid that duplicate session cache; the authoritative rich output remains complete after reopening and can still make the notebook large. It deliberately ignores helper-preview and static-fallback row/byte limits. A value outside the exact contract fails explicitly instead of being saved as a partial result labelled complete.

The `.qnb` serializer has no fixed whole-file byte ceiling. It preserves valid complete output even when its JSON exceeds 16 MiB; available memory, time, and filesystem capacity still constrain very large saves and reopen operations. Direct IPC emits compact MIME JSON, and `.qnb` saves validate and compact JSON output without building another complete typed-cell object tree. Reopening avoids copying the freshly parsed output tree. The separate `.ipynb` serializer belongs to VS Code/Jupyter.

Live notebook scrolling, output reconciliation, and result-menu checks reuse a validated ownership proof for identical output bytes. Each request still checks exact bytes and current metadata/session ownership. The bounded cache retains a byte snapshot rather than another parsed typed-cell tree, evicts older proofs, and clears on notebook close or output clearing. Its memory budget does not impose a notebook/result-size cap. This avoids repeatedly parsing a complete large result while autosave waits for the extension host.

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
| Built-in chart | Rejects sources over 2,000,000 rows by default. Initial/full and ranged line/scatter/step views return all eligible observations at or below 7,000 and exactly 7,000 shared aligned samples above that count; semantic groups/candles may be fewer. Grouping is client-side, retains at most 12 categories and 36 generated series, and shares one bounded visual-item budget across categories. Zoom stays local at 3,000 or more visible samples and refills below that threshold. Compatible pans use a cached X index, retain overlap, and decode only newly exposed/boundary Y slices. |
| Local server full export | Rejects more than 1,000,000 visible cells by default. |
| Local server slice | Fixed maximum of 1,000,000 requested cells. |
| q-text | Bounds nested traversal at 16 levels; caps very large output at 1,048,576 characters and marks character truncation. |
| Notebook live registry | Used only when `maxOutputRows` is positive. Records are bound to notebook/cell URI, removed on successful rerun, cell removal, native output clearing, notebook close, or deactivation, capped at 512, and oldest-first evicted. Each result caches at most four full sort orders. Zero mode creates no new record. |
| Notebook live slice | At most 500 rows, 128 columns, 20,000 cells, and 2,000,000 aggregate text characters per host message; individual display cells cap at 65,536 characters. |
| Notebook saved output | Every successful first-party Direct IPC run automatically persists complete exact rich v2/v3/v4 output without the `maxOutputRows` or `maxOutputBytes` ceilings. Its saved grid and column controls page through bounded windows, bound visible cell/page text and search work, and display at most 1,048,576 full-qText characters with an explicit notice; Copy/Export with no selection still uses every retained visible column or the complete saved qText. The 0-10,000-row setting controls live-cache retention and supplies positive helper limits; zero uses a 20-row Tag/Prepare fallback. The 16,384-10,000,000-byte setting continues to bound tagged Python-helper previews and static fallback material. Historical preview payloads retain their declared 256-column, 32,768-character cell, and 1,048,576-character qText safety limits. |

Some cell and chart limits are configurable. Internal time, byte-size, group-count, and file-format limits remain protective boundaries. Raising a configurable limit can temporarily block the extension host.

Large-sort approval is transient result state. Cancellation does not grant it, and re-execution, replacement, reopening, or a new output identity resets it. Column summaries use the already-decoded result without another q query, retain source-column ordinals, and send only compact payloads to the webview. In bounded mode, evaluated, valid, null, distinct, frequent-value, and numeric/temporal metrics describe only the deterministic sample; no count is extrapolated to unevaluated rows.

Notebook row/byte options do not limit q execution or authoritative first-party rich persistence. Zero rows disables the duplicate live cache; positive rows and the byte option supply tagged Python-helper/static limits, with a 20-row helper fallback in zero mode. Apply a q-side limit when the full q value itself should not materialize or be stored. A historical or Python-helper preview has no recovery handle for omitted rows in the `.ipynb`; rerunning a historical first-party preview executes the current cell source once and replaces it with new complete exact v2/v3/v4 output. Native output clearing removes the output and its live ownership so stale data cannot reappear. Cell removal, notebook close, deactivation, oldest-first eviction, or reopening likewise cannot recover rows absent from a saved preview.

## Timeout and queue behavior

`vscode-kdb.connectionTimeoutMs` defaults to 30,000 milliseconds. It applies a complete budget to TCP connect and then a new complete budget to q IPC handshake. The independent `vscode-kdb.queryTimeoutMs` defaults to 3,600,000 milliseconds (60 minutes). Mixed q-cell execution and the optional pure-q controller both inherit the active profile's effective query timeout and add no separate 30-second query ceiling.

The **KX Connection** form's **Advanced direct q IPC** section accepts optional per-profile `connectTimeoutMs` and `queryTimeoutMs` overrides. Blank inherits the corresponding global value, including for existing profiles whose query override is omitted. Every timeout is a whole number from `0` through `2147483647` milliseconds; use `0` only when an unbounded phase wait is intentional. Zero disables only the corresponding connect/handshake or query response deadline.

The query timer starts when queued work becomes active and the client sends it, not when it first enters the per-connection queue. It runs until the response completes. Expiry destroys and drops the uncertain socket so a later query reconnects instead of reusing it.

A connection serializes its q query requests. Local panel or direct-notebook cancellation stops waiting for one result but does not undo work already sent to q or cancel other queued work. Pre-dispatch notebook cancellation sends nothing. Disconnecting closes the client and fails its outstanding queue.

## Diagnostics

Open **View > Output** and select **KX**. Lifecycle events are always available there for connection, handshake, query, cancellation, disconnect, and close transitions. They include the phase, effective timeout/disabled state for connect, handshake, and active queries, and direct `host:port` where useful.

`.qnb` saves also record `phase: "notebook-save"`, input/output byte counts, cell count, duration, and `start`, `serialized`, or `failed` status. These records contain no query text, results, file paths, or credentials. `serialized` means bytes were returned to VS Code; VS Code still owns the file write. If saving stalls after that event, collect the remote/Extension Host and window logs as well. A heap-exhaustion crash can appear in the save popup as **Canceled**; increasing the q query timeout does not fix that failure.

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

## Large notebook tables

Version 0.2.42 stores all supported native q tables/keyed tables with authoritative typed columns as full v4 packed columns, without a row/cell-count cutoff. Repeated constants and nested-vector headers are removed; exact numeric binary streams are losslessly compressed and embedded as base64 in ordinary notebook JSON. Decimal scaling is used only when reversible; exact IEEE bit corrections or binary storage preserve other floating values. Non-table/plain-row fallback v2 output and existing v1/v2/v3 readers remain supported. New v4 output requires 0.2.40 or later.

The existing Dev Container notebook contained **20,340,848 scalar values**, including 2.4 million nested numeric vectors. Its **278.8 MiB** saved file became **20.1 MiB** (about 93% smaller), below a **32.7 MiB** gzip-JSON baseline. Every scalar and all q metadata were checked, and MIME bytes and durable identity survived save/reopen exactly. The actual file remained unchanged; the isolated test did not execute q. Converting the old saved representation took **22.8 seconds**; subsequent `.qnb` serialization took **0.22 seconds**. Reading, validating and comparing the original large file added diagnostic time. Standalone notebook factory mocks were used; these are not measurements of the installed Extension Host or Jupyter writer.

The separate 600,000 × 14 producer fixture shrank from roughly **160 MiB to 5.2 MiB** and passed complete creation/save/reopen under a **1 GiB JavaScript heap limit**. Buffers outside that heap contribute to process memory. Compression ratio depends on values and nested shapes; no fixed file size or speed is promised. Existing saved files keep their format until a fresh execution.

The row/byte settings do not cap first-party rich data. Zero rows avoids retaining a duplicate raw live value; q-side limits remain the way to reduce actual query/result size. Genuine runtime string/allocation exhaustion is reported explicitly without truncating the result.
