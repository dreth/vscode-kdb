# Results Viewer

Every normal `.q` editor run targets the extension-owned **KX Results** viewer. There is no SQLTools result target or session-file fallback. A live **KX q (Direct IPC)** notebook result can hand the same in-memory decoded value to this viewer while its bound live record exists. Released-companion, reopened, and expired direct results can transfer only rows actually saved in their payload: a bounded preview or an explicitly preserved full v2 result.

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

Column widths use one resolved positional vector for headers, cells, and horizontal virtualization. In the default **Whole result** auto-fit mode, the extension measures the widest displayed header/value in the complete result once, including array/list values outside the viewport, so vertical scrolling cannot resize columns. **Visible rows** is the explicit viewport-adaptive alternative.

## Result tabs

Normal selection/current-line and script runs reuse an existing KX panel. **Run Selection in New Result** opens another panel. The first panel uses `vscode-kdb.results.viewer.initialViewColumn`; a new panel uses the current KX result panel's editor group when one is available.

Panels preserve editor focus on creation. Replacing a loading result locally cancels the previous panel wait so its late response cannot overwrite newer output.

### Notebook live results and saved snapshots

For a current first-party direct result, **Open in KX Results** hands the same decoded extension-host value to the standard panel without rerunning q. The panel and notebook consume one UI contract for labels, output formats, settings, chart families, summaries, focus behavior, theme tokens, positional widths, and auto-fit modes. Inline output provides natural/resizable height, stable two-axis virtual scrolling, sticky headers/row numbers, bounded Search with **Prev**/**Next**, drag/Shift/keyboard range selection, visible-column show/hide/reset/move controls, header-edge resizing, and the shared **Output:** workflow for CSV, XLSX, TSV, JSON, NDJSON, HTML, and Markdown. Headers use source-ordinal identity: click cycles source/ascending/descending order, movement of at least 5 CSS pixels reorders, `Ctrl`/`Cmd`+click or `Ctrl`/`Cmd`+Space selects a whole column, `Enter`/`Space` sorts, and `Alt`+Left/Right reorders. Accessible labels and `aria-sort` expose the current state, including duplicate names. XLSX is export-only. No selection means all visible columns in their current order; a selection means that rectangle, including source-ordinal columns outside the loaded virtual slice. Clipboard work is capped at 20,000 cells, while extension-host file export uses the shared confirmation threshold.

Inline Chart uses all six panel types and their capability-valid X, multi-Y, Group By, or OHLC selectors. The chart stays below the grid. Config changes wait for explicit **Render**, with zoom, pan, refine, and reset disabled until those changes are rendered. Multi-series charts keep a visible color-keyed legend with pointer and **Enter**/**Space** toggles, accurate pressed/hidden state, and matching swatches in the Y-series selector. That selector remains contained and scrollable at narrow output widths. VS Code theme tokens keep axis/tick text readable and gridlines restrained in light, dark, and high-contrast themes. Plain drag zooms X; `Shift`+drag, Pan left/right, and Left/Right pan X; Home and **Reset zoom** restore the original domain. Pan and zoom completion use the same unchanged absolute-range loading and fixed resampling decision, reject stale replies after a newer range/reset, and keep Y automatic for visible X. Hidden legend series survive compatible refreshes and settings changes, and **Export PNG** uses the extension save dialog. The notebook renderer and panel share durable `vscode-kdb.results.*` settings.

Every new first-party Direct IPC output includes a strict `application/vnd.kx.result+json` v2 payload with a fresh opaque output identity and `preview` or `full` persistence mode. Preview mode defaults to 20 rows and records schema, total count, and an explicit truncation notice. A current live result enables the per-output **Preserve full result** checkbox; a persisted full v2 payload also keeps it enabled after reopening so it can be reduced back to the configured preview. Full mode directly stores every exactly representable row, column, and cell without preview row/byte ceilings. A genuine exact-representation failure is reported as an ordinary technical failure, never as a successful full preview. Legacy/Python v1 output remains accepted unchanged but cannot claim omitted rows or enable full persistence.

Each execution receives fresh output/live identities. Its live record is bound to the notebook URI and exact current cell/output for the extension-host session, atomically moved when a supported output rewrite gives the cell a new URI, removed on cell rerun, cell removal, or notebook close, cleared on deactivation, and subject to a 512-record oldest-first cap. Stale renderer generations and requests cannot claim a newer run. If a preview's record is absent, inline output identifies itself as **Saved preview**, reports persisted versus total rows, and offers **Open saved preview** plus **Rerun cell**. Copy/export/chart actions then operate only on stored rows; zoom cannot refine into omitted data. A reopened full v2 payload remains complete without a live record.

The full panel additionally owns its draggable table/chart splitter, running-query controls, and the local data server. A live handoff never reruns the cell or opens another q connection. A rerun from a saved preview is explicitly a new execution. If preview output is truncated, omitted rows are not in the notebook and cannot be recovered after reopening; explicitly preserved full v2 output owns its complete portable rows. Released `kx-notebook==0.1.0` / `%%q` output never receives an extension Direct IPC live record or output binding. Its Python-process-owned evaluator may independently target the same server, but the extension does not claim or manage shared session state between the routes. **Run %%q live with KX** instead confirms an extension-selected target and creates a new first-party Direct IPC result without invoking Jupyter or changing the selected Python kernel.

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
| Columns | Show, hide, or reset visible columns. |
| Resize | Drag a header edge to set an authoritative width; double-click it to reset that position. |
| Reset column widths | Clear every positional manual width. |
| Auto-fit | Enable or disable automatic sizing. Unchecked means no automatic width calculation. |
| Auto-fit scope | **Whole result** measures the complete available result once; **Visible rows** adapts to rendered rows. |
| Cell width / Density | Set the all-column base preset and clear/replace positional manual widths. |

Sort, search, copy, export, charting, and the local data server operate on the current visible column set and order where applicable. A sort changes result row order without changing q server data. Hidden-column and reorder choices carry to the next result in the same panel only when its full column schema matches.

Virtual and paged tables stripe odd absolute display rows with `--vscode-tree-tableOddRowsBackground` and a subtle RGBA fallback. Selection, search matches, and loading states take precedence. High-contrast and forced-colors modes use the theme odd-row color when defined and otherwise fall back to transparent.

Manual widths are stored globally as a sparse zero-based original/source-position map, not by query text or column name. A header moved or filtered to another display position still updates its original source slot; that same ordinal source slot is reused by later result schemas and live or saved notebook grids. The map is not capped by the notebook transport's column limit, so every ordinary-panel source position remains persistable. Legacy array-shaped settings are normalized into the map. It survives panel disposal, VS Code reload/restart, and machine restart. Manual positions take precedence over auto-fit; otherwise enabled auto-fit takes precedence over the active density's base **Cell width**.

Changing **Cell width** or switching density intentionally clears all positional overrides, including the first column. With auto-fit unchecked, the selected base width then applies uniformly to every data column. With auto-fit enabled, the selected scope computes each non-manual width. Saved notebook output treats its persisted preview or full v2 rows as the complete available result; a preview cannot measure omitted rows.

In notebook output, stored font size `0` is presented as **Auto** while remaining numeric `0` in the shared settings contract. The notebook Settings overlay is constrained and scrollable inside its result and supplies visible **Close** plus **Escape** dismissal; either dismissal returns focus to the Settings summary.

Search is bounded and reports when results are capped or the scan is partial. Large sorts prompt before work unless the warning is explicitly disabled.

## Loading, errors, and cancellation

The toolbar shows **Cancel** while a result wait is active. A canceled panel clearly states that q may still be running. Genuine q errors are shown as errors with the connection endpoint context; they are not rendered as successful result data.

For connection, handshake, query, cancellation, and close lifecycle details, open **View > Output** and select **KX**. Diagnostic output omits query text and credentials.

## Viewer boundaries

The viewer does not embed an object explorer, SQLTools grid target, SSH controls, gateway controls, or placeholder actions. The separately gated **KX Server Explorer** sends confirmed previews into this same normal result viewer.
