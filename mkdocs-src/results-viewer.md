# Results Viewer

Every normal `.q` editor run targets the extension-owned **KX Results** viewer. There is no SQLTools result target or session-file fallback. A live **KX q (Direct IPC)** notebook result can hand the same in-memory decoded value to this viewer while its bound live record exists. Python-helper, reopened, and expired direct results can transfer only the rows actually saved in their payload: a bounded preview or an explicitly preserved full v2 result.

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

For a current first-party direct result, **Open in KX Results** can use its full extension-host value and the standard panel's grid/qText policies, virtualization, selection, search, sort, column controls, charting, copy, and supported exports. The compact inline adaptation provides natural/resizable table height, stable two-axis virtual scrolling, sticky headers/row numbers, capped Search with `Enter` / `Shift+Enter` navigation, drag/Shift/keyboard range selection, and bounded selection copy through the full live value. Its selection-only **Tools** menu uses one format selector and one Copy action instead of disabled duplicate copy buttons.

Inline Chart uses all six real panel types and their capability-valid X, multi-Y, Group By, or OHLC selectors. Config changes wait for explicit **Render**, and hidden legend series remain hidden through chart refreshes. The notebook renderer and panel share durable `vscode-kdb.results.*` settings.

Every new first-party Direct IPC output includes a strict `application/vnd.kx.result+json` v2 payload with a fresh opaque output identity and `preview` or `full` persistence mode. Preview mode defaults to 20 rows and records schema, total count, and an explicit truncation notice. A current live result enables the per-output **Preserve full result** checkbox; a persisted full v2 payload also keeps it enabled after reopening so it can be reduced back to the configured preview. Full mode directly stores every exactly representable row, column, and cell without preview row/byte ceilings. A genuine exact-representation failure is reported as an ordinary technical failure, never as a successful full preview. Legacy/Python v1 output remains accepted unchanged but cannot claim omitted rows or enable full persistence.

Each live record is bound to notebook URI/current-cell URI for the extension-host session, atomically moved when an output rewrite gives the cell a new URI, removed on cell rerun, cell removal, or notebook close, cleared on deactivation, and subject to a 512-record oldest-first cap. If a preview's record is absent, **KX: Open Saved Notebook Preview in Results Panel** opens only stored rows and reports persisted versus total row count.

Panel handoff never reruns the cell or opens another q connection. If snapshot output is truncated, omitted rows are not in the notebook and cannot be recovered after reopening. Python `%%q` helper output never receives a Direct IPC live record. A user evaluator may independently target the same server, but the two routes do not share extension-managed session state.

## Selection and navigation

The grid supports:

- a single cell or rectangular range;
- whole-row selection;
- whole-column selection with `Ctrl`/`Cmd`+click or `Ctrl`/`Cmd`+Space, with `Shift` extending the current selection;
- full-table selection;
- keyboard navigation and clipboard shortcuts; and
- deselection.

With no selection, copy and export use the complete visible table. Hidden columns are excluded. The left row-number display is included only when **Row #** output is enabled.

## View and column controls

Headers are focusable and expose their sort state and position to assistive technology. A click cycles source order → ascending → descending → source order. Pointer movement of at least 5 CSS pixels reorders and suppresses sorting. `Enter`/`Space` sorts; `Alt`+Left/Right reorders. Identity is the source column ordinal, so duplicate names remain distinct. The notebook renderer keeps order local to the logical output; a panel carries order only while its complete source-ordinal schema matches.

Open **Settings** in the panel toolbar:

| Control | Behavior |
| --- | --- |
| Search | Case-insensitive search over visible column display text, with previous/next match navigation. |
| Columns | Show, hide, or reset columns; reset explicit widths. |
| Auto-fit | Size visible columns from headers and rendered cells while scrolling. |
| Density | Choose compact, standard, or comfortable dimensions. |

Sort, search, copy, export, charting, and the local data server operate on the current visible column set and order where applicable. A sort changes result row order without changing q server data. Hidden-column and reorder choices carry to the next result in the same panel only when its full column schema matches.

Virtual and paged tables stripe odd absolute display rows with `--vscode-tree-tableOddRowsBackground` and a subtle RGBA fallback. Selection, search matches, and loading states take precedence. High-contrast and forced-colors modes use the theme odd-row color when defined and otherwise fall back to transparent.

Search is bounded and reports when results are capped or the scan is partial. Large sorts prompt before work unless the warning is explicitly disabled.

## Loading, errors, and cancellation

The toolbar shows **Cancel** while a result wait is active. A canceled panel clearly states that q may still be running. Genuine q errors are shown as errors with the connection endpoint context; they are not rendered as successful result data.

For connection, handshake, query, cancellation, and close lifecycle details, open **View > Output** and select **KX**. Diagnostic output omits query text and credentials.

## Viewer boundaries

The viewer does not embed an object explorer, SQLTools grid target, SSH controls, gateway controls, or placeholder actions. The separately gated **KX Server Explorer** sends confirmed previews into this same normal result viewer.
