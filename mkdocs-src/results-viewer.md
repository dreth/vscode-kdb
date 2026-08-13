# Results Viewer

Every normal `.q` editor run targets the extension-owned **KX Results** viewer. There is no SQLTools result target or session-file fallback. A live **KX q (Direct IPC)** notebook result can hand the same in-memory decoded value to this viewer while its bound live record exists. New first-party Direct IPC output also reopens from its automatically persisted complete exact v2 payload. Released-companion output and historical saved direct previews can transfer only the rows actually stored in their payload.

## Grid and q-text modes

True q tables and keyed tables always use the grid, including schema-bearing zero-row tables. Ordinary non-null scalars use a small synthetic grid. q general null/no-value responses, typed nulls, empty generic/typed vectors, empty strings, and empty generic composites use compact qText instead of a fabricated `value` or `index,value` grid. Non-empty vectors/lists, dictionaries, functions, and other decoded composite values use either a synthetic grid or deterministic q-like text according to the [display strategy settings](settings.md#result-display).

For a decoded q keyed table, every structural key column receives a subtle theme-safe background and an accessible “key column” header description. The source of truth is the decoded key-table schema and its original source ordinals, never a column label or query-text guess. The cue therefore follows sorting, hidden columns, drag reorder, paging, and horizontal/vertical virtualization, while an ordinary table with identical names remains unhighlighted. Row parity is still visible beneath the tint; selection, search, focus, loading/error, hover, sorted-header state, and high-contrast/forced-colors cues take precedence.

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

For a current first-party direct result, **Open in KX Results** hands the same decoded extension-host value to the standard panel without rerunning q. The panel and notebook consume one UI contract for labels, output formats, settings, chart families, focus behavior, theme tokens, positional widths, and auto-fit modes. Inline output provides natural/resizable height, stable two-axis virtual scrolling, sticky headers/row numbers, bounded Search with **Prev**/**Next**, drag/Shift/keyboard range selection, visible-column show/hide/reset/move controls, header-edge resizing, and the shared **Output:** workflow for CSV, XLSX, TSV, JSON, NDJSON, HTML, and Markdown. Headers use source-ordinal identity: click cycles source/ascending/descending order, movement of at least 5 CSS pixels reorders, `Ctrl`/`Cmd`+click or `Ctrl`/`Cmd`+Space selects a whole column, `Enter`/`Space` sorts, and `Alt`+Left/Right reorders. Accessible labels and `aria-sort` expose the current state, including duplicate names. XLSX is export-only. No selection means all visible columns in their current order; a selection means that rectangle, including source-ordinal columns outside the loaded virtual slice. Clipboard work is capped at 20,000 cells, while extension-host file export uses the shared confirmation threshold.

Inline Chart uses all six panel types and their capability-valid X, multi-Y, Group By, or OHLC selectors. The chart stays below the grid. Config changes wait for explicit **Render**, with navigator, zoom, and reset input disabled until those changes are rendered. Multi-series charts keep a visible color-keyed legend with pointer and **Enter**/**Space** toggles, accurate pressed/hidden state, and matching swatches in the Y-series selector. That selector remains contained and scrollable at narrow output widths. VS Code theme tokens keep axis/tick text readable and gridlines restrained in light, dark, and high-contrast themes. A compact overview directly below the main plot shows the full X domain and its selected window. Drag the window to pan, drag either edge to resize, or use the focusable window/handles with bounded arrow-key adjustments; plain main-plot drag zoom remains available. Home and **Reset zoom** restore the original domain. Each settled live viewport uses the same absolute-range loading and automatic refinement lifecycle, rejects stale replies after a newer range/reset, and keeps Y automatic for visible X. Saved or otherwise bounded charts navigate locally. No visible Pan or Refine buttons are shown. Hidden legend series survive compatible refreshes and settings changes, and **Export PNG** uses the extension save dialog. The notebook renderer and panel share durable `vscode-kdb.results.*` settings.

Every successful first-party Direct IPC execution includes a strict `application/vnd.kx.result+json` v2 payload with a fresh opaque output identity and automatically stores every exactly representable row, column, and cell. The authoritative rich payload is not clipped by notebook preview row/byte settings. Its versioned exact q cells retain atom/vector identity, attributes, symbols versus chars, longs, temporals, sentinels, and nested typed values. An optional strictly validated list of keyed-table source ordinals preserves structural key-column identity across save/reopen; legacy payloads without it remain valid and unhighlighted. Default grid cells show concise familiar text for ordinary scalar booleans, numerics, temporals, GUIDs, nulls, and infinities instead of a universal type annotation. Symbols remain backticked, character vectors remain quoted, singleton vectors use `enlist`, and nested, empty typed, or otherwise ambiguous values retain the q syntax needed to distinguish them. This view-only choice does not alter source metadata: qText, copy/export, IPC, and portable persistence retain conservative exact q representation, including q's valid IPC-deserialize form for bit-exact real subnormals. Unsupported metadata outside the row/cell schema—currently whole-column table attributes and top-level dictionary identity—reports its q type and bounded value detail as an explicit encoding failure instead of being flattened, stringified, or relabelled as complete. Legacy v1 and v2 preview payloads remain readable and are identified as historical saved previews; separately produced Python-helper v1 output remains bounded by its declared limits.

Each execution receives fresh output/live identities. Its live record is bound to the notebook URI and exact current cell/output for the extension-host session, atomically moved when a supported output rewrite gives the cell a new URI, removed on rerun, cell removal, native **Clear Cell Output**/**Clear All Outputs**, or notebook close, cleared on deactivation, and subject to a 512-record oldest-first cap. Stale renderer generations and requests cannot claim a newer run. When a historical preview has no live record, inline output identifies it as **Historical saved preview**, reports persisted versus total rows, and offers its saved rows plus **Rerun cell**. Rerun executes the current cell source and replaces it with a new complete v2 result; copy/export/chart actions before rerun remain limited to stored rows. A reopened complete v2 payload remains complete without a live record.

The full panel additionally owns its draggable table/chart splitter, running-query controls, local data server, and optional column-summary surface. Opening a current live or complete saved table in KX Results does not rerun the cell or open another q connection. A rerun from a historical saved preview is explicitly a new execution of the current cell source. Rows omitted from a historical or Python-helper preview are not in the notebook and cannot be recovered after reopening; new first-party full v2 output automatically owns its complete portable rows. Released `kx-notebook==0.1.0` / `%%q` output never receives an extension Direct IPC live record or output binding. Its Python-process-owned evaluator may independently target the same server, but the extension does not claim or manage shared session state between the routes. **Run %%q live with KX** instead confirms an extension-selected target and creates a new first-party Direct IPC result without invoking Jupyter or changing the selected Python kernel.

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
| Large-sort warning rows | Set the row threshold above which sorting asks for confirmation. |
| Hide large-sort warnings | Disable large-sort confirmation globally. |
| Show column summary statistics | Panel only; compute bounded statistics from the current decoded result. Disabled by default. |

Sort, search, copy, export, charting, and the local data server operate on the current visible column set and order where applicable. A sort changes result row order without changing q server data. Hidden-column and reorder choices carry to the next result in the same panel only when its full column schema matches.

Virtual and paged tables shade alternating **logical displayed rows**, keyed by the absolute displayed-row ordinal rather than DOM `nth-child` position. The same row therefore keeps its stripe through vertical virtualization, scrolling, sort windows, and saved paging. Headers are not striped. The subtle background is derived from VS Code theme tokens rather than a fixed light-theme color. Selection, hover, focused cells, sorted-column state, search matches, loading, errors, and high-contrast or forced-colors accessibility treatment remain dominant.

Manual widths are stored globally as a sparse zero-based original/source-position map, not by query text or column name. A header moved or filtered to another display position still updates its original source slot; that same ordinal source slot is reused by later result schemas and live or saved notebook grids. The map is not capped by the notebook transport's column limit, so every ordinary-panel source position remains persistable. Legacy array-shaped settings are normalized into the map. It survives panel disposal, VS Code reload/restart, and machine restart. Manual positions take precedence over auto-fit; otherwise enabled auto-fit takes precedence over the active density's base **Cell width**.

Changing **Cell width** or switching density intentionally clears all positional overrides, including the first column. With auto-fit unchecked, the selected base width then applies uniformly to every data column. With auto-fit enabled, the selected scope computes each non-manual width. Saved notebook output measures every row its payload owns: all exact rows for new first-party v2 output, or only stored rows for a historical/Python-helper preview. A preview cannot measure omitted rows.

In notebook output, stored font size `0` is presented as **Auto** while remaining numeric `0` in the shared settings contract. The notebook Settings overlay is constrained and scrollable inside its result and supplies visible **Close** plus **Escape** dismissal; either dismissal returns focus to the Settings summary.

Search is bounded and reports when results are capped or the scan is partial. Panel and live-notebook sorts prompt only when the displayed result has strictly more rows than `vscode-kdb.results.largeSortWarningRowThreshold`. Its default is 5,000,000, so 5,000,000 rows do not warn and 5,000,001 do. Confirming and proceeding approves later sorts only for that exact displayed result identity; cancellation grants no approval. Re-execution, result replacement, reopen, or any new output identity resets the approval. `vscode-kdb.results.hideLargeSortWarnings` remains the durable global opt-out.

### Column summary statistics

`vscode-kdb.results.showColumnSummaryStatistics` is disabled by default and currently applies only to the standard KX Results panel. When enabled, the extension host computes summaries from the decoded result already owned by the panel; it does not rerun q and sends only the compact summary payload to the webview. Cache and in-flight work are tied to the exact displayed result and are discarded on replacement or panel disposal, so stale summaries cannot attach to a newer result.

Every source column, including duplicate names, retains its original zero-based source ordinal. Each card reports total rows, evaluated rows, valid values, q nulls, and distinct observed values. Numeric columns add minimum, maximum, mean, and median; temporal columns add minimum and maximum; symbol, char, and text columns add bounded representative/frequent values. q typed nulls are counted as null rather than ordinary values, while typed infinities retain their q ordering and display semantics instead of being collapsed into JavaScript nulls or finite numbers. Empty tables still report their schema with zero counts.

Exact mode is used only when both inclusive limits hold: no more than 50,000 rows and no more than 100,000 evaluated cells. Above either limit, sampled mode deterministically selects evenly spaced source rows, including endpoints when the cell budget permits, and evaluates at most 10,000 rows and 100,000 cells. Sampled valid, null, distinct, frequent-value, and metric counts describe only those evaluated rows; they are labelled sampled/partial and are never extrapolated to the full result.

## Loading, errors, and cancellation

The toolbar shows **Cancel** while a result wait is active. A canceled panel clearly states that q may still be running. Genuine q errors are shown as errors with the connection endpoint context; they are not rendered as successful result data.

For connection, handshake, query, cancellation, and close lifecycle details, open **View > Output** and select **KX**. Diagnostic output omits query text and credentials.

## Viewer boundaries

The viewer does not embed an object explorer, SQLTools grid target, SSH controls, gateway controls, or placeholder actions. The separately gated **KX Server Explorer** sends confirmed previews into this same normal result viewer.
