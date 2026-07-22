# Results Viewer

Every editor run targets the extension-owned **KX Results** viewer. There is no SQLTools result target or session-file fallback.

## Grid and q-text modes

True q tables and keyed tables always use the grid, and scalars use a small synthetic grid. Vectors/lists, dictionaries, functions, and other decoded composite values use either a synthetic grid or deterministic q-like text according to the [display strategy settings](settings.md#result-display).

The defaults are:

- functions: `qText`;
- dictionaries: `grid`;
- lists: `grid`; and
- other composite objects: `grid`.

q-text mode bounds nested traversal at 16 levels and has a 1,048,576-character safeguard; character-capped output is marked with `... [truncated]`. Function source is not invented: when IPC provides only a function marker, the viewer reports that source is unavailable. Return `string f` or `.Q.s f` from q when exact server-side text is required.

## Virtual grid

The grid stores result columns in the extension host and sends only requested row and column windows to the webview. It virtualizes both directions so the DOM does not contain every cell at once.

This reduces rendering work; it does not stream the q response. The complete IPC response is decoded and retained before display. See [Performance & Large Results](performance.md).

## Result tabs

Normal selection/current-line and script runs reuse an existing KX panel. **Run Selection in New Result** opens another panel. The first panel uses `vscode-kdb.results.viewer.initialViewColumn`; a new panel uses the current KX result panel's editor group when one is available.

Panels preserve editor focus on creation. Replacing a loading result locally cancels the previous panel wait so its late response cannot overwrite newer output.

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

The viewer does not provide an object explorer, SQLTools grid target, SSH controls, gateway controls, or placeholder actions for unavailable features.
