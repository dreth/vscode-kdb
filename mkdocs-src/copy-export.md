# Copy & Export

Grid copy and export use the current rectangular selection. With no selection, they use the complete visible result. Hidden columns, visible column order, and current sort order are honored.

q-text results instead copy their displayed text or export it as `kx-results.txt`.

## Formats

| Format | Copy | Export | Notes |
| --- | --- | --- | --- |
| TSV | Yes | Yes | Tab-separated text. |
| CSV | Yes | Yes | Fields are quoted when required. |
| Markdown | Yes | Yes | Markdown table. |
| JSON | Yes | Yes | Structured array of row objects. |
| NDJSON | Yes | Yes | One structured row object per line. |
| HTML | Yes | Yes | HTML table. |
| XLSX | No | Yes | A real worksheet in an `.xlsx` ZIP container. |

The panel format selector controls both toolbar actions. Right-click **Copy**, `Ctrl+C`, or `Cmd+C` uses the same selected range and current output options.

**KX Results: Copy Selection** in the Command Palette forwards the same action to the active/available KX result panel.

## Headers and row numbers

Toolbar checkboxes and settings choose whether output includes column headers and a 1-based row-number column:

```json
{
  "vscode-kdb.results.includeHeaders": true,
  "vscode-kdb.results.includeRowIndex": true
}
```

The visual row-number column is independently controlled by `vscode-kdb.results.showRowIndex`.

## Display text and structured values

TSV, CSV, Markdown, and HTML use export cell text, including the selected array format for ordinary arrays. For exact q cells this is deliberately more explicit than the concise default grid view: copy/export retains backtick symbols, quoted character vectors, `enlist` singleton vectors, typed null/infinity values, temporals, and nested structure. JSON and NDJSON preserve structured values where the q decoder retained them. Grid presentation never rewrites the underlying value used by these paths.

Changing a grid/list display setting changes presentation; it does not reconstruct server-side q source.

## Guardrails

Copy/export prompts when the selection reaches the configured cell threshold (1,000,000 by default) or the estimated output reaches an internal 50 MiB threshold. A realized clipboard payload above 15 MiB offers file export instead.

```json
{
  "vscode-kdb.results.copyExportConfirmCellThreshold": 1000000
}
```

The cell threshold has a minimum of `1`. Raising it removes only that prompt condition; it does not make materialization free or change the internal size prompt.

XLSX export rejects output beyond Excel worksheet limits:

- 1,048,576 output rows; or
- 16,384 output columns; or
- 32,767 characters in any header or displayed data cell.

The cell-text check reports the exact output row and column instead of silently truncating the q display.

Parquet export is not implemented.

The local data server uses a separate hard full-export cell limit. Changing the panel copy/export confirmation threshold does not change that server limit. See [Local Data Server](local-data-server.md#limits).

## Notebook output and export

A live first-party KX notebook result exposes the shared KX Results **Output:** workflow: CSV, XLSX, TSV, JSON, NDJSON, HTML, and Markdown; **Headers**; **Row #**; **Copy**; and **Export**. XLSX is export-only. With no selection, the operation uses all visible columns in their current order; otherwise it uses the drag, Shift-range, or keyboard-selected rectangle. Hidden columns stay excluded. Inline clipboard work is capped at 20,000 cells and 2,000,000 realized text characters, including live selected rows outside the loaded virtual slice. Notebook Copy and Export use the shared configured cell threshold and 50 MiB estimate prompt; file export is performed by the extension host.

Saved notebook tables expose the same controls, but the source is only their persisted rows: every row for a new first-party exact v2 result, or bounded rows for a historical/Python-helper preview. Preview actions cannot recover omitted rows; **Rerun cell** executes the current cell source as an explicit new run and upgrades a historical first-party preview to complete v2 output. A reopened complete result may show concise ordinary grid cells, but Copy and every export format retain exact q syntax for symbols, chars, vectors, sentinels, longs, and temporals. Nonzero IEEE real subnormals use a valid q IPC-deserialize expression so copy/export evaluates back to the same bits. A current live result can use **Open in KX Results** to hand the exact decoded value to the full panel without a lossy query or conversion.

Direct IPC output from the mixed runner or optional controller automatically persists complete exactly represented `application/vnd.kx.result+json` v2 plus a `text/plain` fallback; it does not add `text/html` or a persisted chart specification. A static fallback may be byte-bounded, but it never truncates or replaces the authoritative rich payload. Unsupported exact values report an encoding failure rather than creating a successful partial result. Separately installed `kx-notebook==0.1.0` also emits escaped `text/html`, but receives no extension live record/output binding. Its HTML includes schema, total and preview row counts, a bounded table preview, explicit truncation/transfer notices, and a network-free static SVG when an emitted chart specification supports it. Rows omitted from historical or Python-helper snapshots, interactive uPlot controls, zoom, tooltips, clipboard actions, and renderer-only chart changes are not portable to HTML/PDF.
