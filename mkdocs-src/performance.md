# Performance & Large Results

The result viewer is designed to stay usable with large tables, but q IPC responses are not streamed through the complete pipeline.

## Memory and rendering model

The extension receives and decodes the complete q IPC response before the panel can show it. Table data is retained in columnar form in the extension host. The webview then requests only visible row/column windows, so DOM and message traffic are virtualized.

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
| Search | At most 1,000 matching rows; a scan can stop after 2,000,000 cells or about 1.5 seconds and reports partial status. |
| Sort | Confirmation at 250,000 rows unless explicitly disabled. |
| Copy/export | Confirmation at 1,000,000 selected cells or an estimated 50 MiB; large realized clipboard output gets another export suggestion. |
| Built-in chart | Rejects sources over 2,000,000 rows by default and reduces plotted points. |
| Local server full export | Rejects more than 1,000,000 visible cells by default. |
| Local server slice | Fixed maximum of 1,000,000 requested cells. |
| q-text | Bounds nested traversal at 16 levels; caps very large output at 1,048,576 characters and marks character truncation. |

Some cell and chart limits are configurable. Internal time, byte-size, group-count, and file-format limits remain protective boundaries. Raising a configurable limit can temporarily block the extension host.

## Timeout and queue behavior

`vscode-kdb.connectionTimeoutMs` defaults to 30,000 milliseconds. It applies a complete budget to TCP connect and then a new complete budget to q IPC handshake. `vscode-kdb.queryTimeoutMs` defaults to `null`, which inherits that global connect value for compatibility; set it to an integer for a separate global query-response deadline.

The **KX Connection** form's **Advanced direct q IPC** section accepts optional per-profile `connectTimeoutMs` and `queryTimeoutMs` overrides. Blank inherits the corresponding resolved global value. Every timeout is a whole number from `0` through `2147483647` milliseconds; use `0` only when an unbounded phase wait is intentional.

The query timer starts when queued work becomes active and the client sends it, not when it first enters the per-connection queue. It runs until the response completes. Expiry destroys and drops the uncertain socket so a later query reconnects instead of reusing it.

A connection serializes its q query requests. Local panel cancellation stops waiting for one result but does not remove work already sent to q or cancel other queued panel work. Disconnecting closes the client and fails its outstanding queue.

## Diagnostics

Open **View > Output** and select **KX**. Lifecycle events are always available there for connection, handshake, query, cancellation, disconnect, and close transitions. They include the phase and direct `host:port` where useful.

For safe timing detail, explicitly enable:

```json
{
  "vscode-kdb.performance.trace": true
}
```

Timing records include operation names, durations, sizes/counts, and memory snapshots where implemented. Query text and result values are not logged. Passwords, authentication credentials, SecretStorage values, and local-data-server tokens are omitted or redacted. The extension does not mutate this setting automatically.

For development compatibility, the same performance records retain their `[vscode-kdb:perf]` entry in the Extension Host console. **Output > KX** is the supported user-facing place to collect them.

Performance trace can itself add small measurement and output overhead. Disable it after collecting the evidence needed for a report.

## External analysis

For a result already loaded in the panel, use bounded [Local Data Server](local-data-server.md) slices to avoid creating an additional q query. For data that should never be fully loaded into VS Code, query and aggregate it directly in q or use a separately managed client suited to that volume.
