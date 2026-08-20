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

## Analyst values and q-native display

Table copy/export is a data-analysis boundary, not a copy of rendered q syntax. It is shared by the panel, live notebook results, saved/reopened notebook results, selections, and full-table file exports:

- symbols and character vectors become ordinary strings without backticks or q quoting;
- safe integral and floating values become numbers, booleans remain booleans, and GUIDs become UUID strings;
- 64-bit integers outside JavaScript's safe range remain decimal strings instead of being rounded;
- months, dates, datetimes, and timestamps use portable ISO-style text; timestamps retain nine fractional digits, and timespans use ISO-8601 duration text;
- q nulls become JSON/NDJSON `null` and blank cells in delimited, HTML, Markdown, and XLSX output;
- q infinities become JSON/NDJSON `null`, and deterministic `Infinity` or `-Infinity` text in the other formats;
- arrays and mixed cells are converted recursively, while column names are ordinary strings.

JSON and NDJSON emit actual numbers, booleans, arrays, and nulls. Duplicate column occurrences are never silently overwritten: their object keys receive deterministic collision-safe suffixes, including around names such as `__proto__`. XLSX stores Excel-safe scalar numbers and booleans as worksheet values, nulls as blank cells, and unsafe integers, subnormal or over-precision numbers, temporals, vectors, and infinities as text; SpreadsheetML escaping preserves controls and literal `_xHHHH_` text. CSV and TSV use delimiter-aware quoting that preserves tabs, quotes, and line breaks. Markdown escapes table syntax and embedded HTML while using `<br>` for actual line breaks; HTML escapes markup.

The grid still uses its q-aware display formatter, and q-text results still copy/export their original q text. Analyst conversion does not mutate the decoded IPC value or the exact portable notebook cell.

Changing a grid/list display setting changes presentation; it does not reconstruct server-side q source.

## Guardrails

Copy/export prompts when the selection reaches the configured cell threshold (1,000,000 by default) or a sampled estimate reaches 50 MiB. The estimate is advisory: escaped controls, quotes, markup, Unicode, repeated JSON keys, or SpreadsheetML can expand differently when encoded. Continuing past the prompt never bypasses the hard limits below.

```json
{
  "vscode-kdb.results.copyExportConfirmCellThreshold": 1000000
}
```

The cell threshold has a minimum of `1`. Raising it removes only that prompt condition; it does not change the estimate threshold or any hard limit.

Panel clipboard copy has a hard 15 MiB realized UTF-8 limit. Encoding is checked incrementally before a complete clipboard payload is allocated. Above the limit, KX Results offers **Export** or **Cancel**; there is no truncate or **Copy Anyway** path.

CSV, TSV, JSON, NDJSON, HTML, and Markdown file exports have these hard limits after applying the current selection, visible columns, headers, and row-number option:

- 5,000,000 output cells;
- 100,000 output columns;
- 128 MiB of realized UTF-8 file content; and
- 8,388,608 analyst-text characters in any data cell, emitted header, or JSON/NDJSON key.

JSON and NDJSON do not count the **Headers** option as an extra row because their column names are object keys. The encoder measures escaped per-cell/syntax fragments first, then allocates one right-sized bounded byte buffer; it never builds a complete row or table string. A hard-limit failure identifies the format and remedy and writes no partial file.

XLSX export rejects output beyond Excel worksheet limits:

- 1,048,576 output rows; or
- 16,384 output columns; or
- 32,767 characters in any header or analyst data cell.

XLSX additionally has hard extension-host limits of 1,000,000 output cells and 64 MiB of uncompressed worksheet XML. Worksheet XML is measured per cell, then streamed into the ZIP; control/Xstring/XML expansion counts toward the XML limit. The analyst-text check reports the exact output row and column instead of silently truncating the exported value. Every rejection occurs before the destination is written, so no partial XLSX is left behind.

Parquet export is not implemented.

The local data server uses a separate hard full-export cell limit. Changing the panel copy/export confirmation threshold does not change that server limit. See [Local Data Server](local-data-server.md#limits).

## Notebook output and export

A live first-party KX notebook result exposes the shared KX Results **Output:** workflow: CSV, XLSX, TSV, JSON, NDJSON, HTML, and Markdown; **Headers**; **Row #**; **Copy**; and **Export**. XLSX is export-only. With no selection, the operation uses all visible columns in their current order; otherwise it uses the drag, Shift-range, or keyboard-selected rectangle. Hidden columns stay excluded. Inline clipboard work is capped in the extension host at 20,000 selected source cells and 2,000,000 realized text characters, including live selected rows outside the loaded virtual slice and saved-preview requests. Notebook Copy and Export use the shared configured cell threshold and advisory 50 MiB estimate prompt. Notebook table file export is performed by the extension host under the same realized text/XLSX hard limits as the panel.

Saved notebook tables expose the same controls, but the source is only their persisted rows: every row for a new first-party exact v2 result, or bounded rows for a historical/Python-helper preview. Preview actions cannot recover omitted rows; **Rerun cell** executes the current cell source as an explicit new run and upgrades a historical first-party preview to complete v2 output. A reopened complete result uses the same analyst conversion as a live result and the panel, while its stored typed q cells remain unchanged. A current live result can use **Open in KX Results** to hand the exact decoded value to the full panel without a query or persistence conversion.

Direct IPC output from the mixed runner or optional controller automatically persists complete exactly represented `application/vnd.kx.result+json` v2 plus a `text/plain` fallback; it does not add `text/html` or a persisted chart specification. A static fallback may be byte-bounded, but it never truncates or replaces the authoritative rich payload. Unsupported exact values report an encoding failure rather than creating a successful partial result. Separately installed `kx-notebook==0.1.0` also emits escaped `text/html`, but receives no extension live record/output binding. Its HTML includes schema, total and preview row counts, a bounded table preview, explicit truncation/transfer notices, and a network-free static SVG when an emitted chart specification supports it. Rows omitted from historical or Python-helper snapshots, interactive uPlot controls, zoom, tooltips, clipboard actions, and renderer-only chart changes are not portable to HTML/PDF.
