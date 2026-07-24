# Results Viewer

Every normal `.q` editor run targets the extension-owned **KX Results** viewer. There is no SQLTools result target or session-file fallback. A live **KX q (Direct IPC)** notebook result can hand the same in-memory decoded value to this viewer while its bound live record exists. Python-helper, reopened, and expired direct results can transfer only their bounded saved snapshot.

## Grid and q-text modes

True q tables and keyed tables always use the grid, including schema-bearing zero-row tables. Ordinary non-null scalars use a small synthetic grid. q general null/no-value responses, typed nulls, empty generic/typed vectors, empty strings, and empty generic composites use compact qText instead of a fabricated `value` or `index,value` grid. Non-empty vectors/lists, dictionaries, functions, and other decoded composite values use either a synthetic grid or deterministic q-like text according to the [display strategy settings](settings.md#result-display).

The defaults are:

- functions: `qText`;
- dictionaries: `grid`;
- lists: `grid`; and
- other composite objects: `grid`.

q-text mode bounds nested traversal at 16 levels and has a 1,048,576-character safeguard; character-capped output is marked with `... [truncated]`. Function source is not invented: when IPC provides only a function marker, the viewer reports that source is unavailable. Return `string f` or `.Q.s f` from q when exact server-side text is required.

### Optional qText readability

`vscode-kdb.results.qText.syntaxHighlighting` and `vscode-kdb.results.qText.displayFormatting` both default to `false`. With both disabled, qText display is the exact unmodified raw string.

Syntax highlighting is limited to qText results. A lightweight standalone lexer recognizes comments, system commands and namespaces, strings/escapes, symbols, temporal/numeric literals, qSQL/control words, builtins, and operators. The webview creates text nodes and styled spans; raw qText is never interpolated into `innerHTML`. Colors use VS Code theme variables, and setting changes update open or reused result panels.

Display formatting is a conservative, non-mutating view transform, not a document formatter or q evaluator. It introduces deterministic line breaks and indentation only for supported balanced lambda/block structures. String and comment contents remain byte-for-byte intact. Unsupported, ambiguous, or malformed input falls back to the original raw text; highlighting, when enabled, runs after formatting and never tokenizes inside strings or comments as code. Copy/export continues to use the original raw qText, while neither setting changes source editor behavior or server data.

## Virtual grid

The grid stores result columns in the extension host and sends only requested row and column windows to the webview. It virtualizes both directions so the DOM does not contain every cell at once.

This reduces rendering work; it does not stream the q response. The complete IPC response is decoded and retained before display. See [Performance & Large Results](performance.md).

## Result tabs

Normal selection/current-line and script runs reuse an existing KX panel. **Run Selection in New Result** opens another panel. The first panel uses `vscode-kdb.results.viewer.initialViewColumn`; a new panel uses the current KX result panel's editor group when one is available.

Panels preserve editor focus on creation. Replacing a loading result locally cancels the previous panel wait so its late response cannot overwrite newer output.

### Notebook live results and saved snapshots

For a current direct-controller result, **Open in KX Results** can use its full extension-host value and the standard panel's grid/qText policies, virtualization, selection, search, sort, column controls, charting, copy, and supported exports. The compact inline subset provides natural/resizable table height, stable two-axis virtual scrolling, sticky headers/row numbers, capped search, sort below 250,000 rows, drag/Shift/keyboard range selection, bounded TSV/CSV copy through the full live value, and sampled multi-Y charts. The direct notebook renderer and panel share durable `vscode-kdb.results.*` settings.

Every direct output also includes a validated bounded `application/vnd.kx.result+json` v1 snapshot. Each opaque live record is bound to notebook URI/cell URI for the current extension-host session, removed on cell rerun, cell removal, or notebook close, cleared on deactivation, and subject to a 512-record oldest-first cap. If the record is absent, **KX: Open Saved Notebook Preview in Results Panel** opens only the snapshot and reports persisted versus total row count.

Panel handoff never reruns the cell or opens another q connection. If snapshot output is truncated, omitted rows are not in the notebook and cannot be recovered after reopening. Python `%%q` helper output never receives a Direct IPC live record. A user evaluator may independently target the same server, but the extension does not claim or manage shared session state between the routes.

## Selection and navigation

The grid supports:

- a single cell or rectangular range;
- whole-row selection;
- whole-column selection when header mode is **Select**;
- full-table selection;
- keyboard navigation and clipboard shortcuts; and
- deselection.

With no selection, copy and export use the complete visible table. Hidden columns are excluded. The left row-number display is included only when **Row #** output is enabled.

## View and column controls

Open **Settings** in the panel toolbar:

| Control | Behavior |
| --- | --- |
| Header mode: Drag | Drag headers to reorder visible columns. |
| Header mode: Select | Select a complete column from its header. |
| Header mode: Sort | Cycle ascending, descending, and original order using display text. |
| Search | Case-insensitive search over visible column display text, with previous/next match navigation. |
| Columns | Show, hide, or reset columns; reset explicit widths. |
| Auto-fit | Size visible columns from headers and rendered cells while scrolling. |
| Density | Choose compact, standard, or comfortable dimensions. |

Sort, search, copy, export, charting, and the local data server operate on the current visible column set and order where applicable. A sort changes result row order without changing q server data. Hidden-column and reorder choices carry to the next result in the same panel only when its full column schema matches.

Search is bounded and reports when results are capped or the scan is partial. Large sorts prompt before work unless the warning is explicitly disabled.

## Loading, errors, and cancellation

The toolbar shows **Cancel** while a result wait is active. A canceled panel clearly states that q may still be running. Genuine q errors are shown as errors with the connection endpoint context; they are not rendered as successful result data.

For connection, handshake, query, cancellation, and close lifecycle details, open **View > Output** and select **KX**. Diagnostic output omits query text and credentials.

## Viewer boundaries

The viewer does not embed an object explorer, SQLTools grid target, SSH controls, gateway controls, or placeholder actions. The separately gated **KX Server Explorer** sends confirmed previews into this same normal result viewer.
