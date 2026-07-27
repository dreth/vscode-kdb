# KX Results notebook parity matrix

This implementation matrix was captured before the parity refactor. “Shared” means
one source of truth is consumed by the full Results panel and notebook renderer;
“host adapter” means the DOM or VS Code messaging remains surface-specific.

| Capability | Established KX Results panel | Notebook baseline | Parity target |
| --- | --- | --- | --- |
| Result identity | Connection, elapsed time, row count, messages | Connection and elapsed time in a notebook-only card | Shared summary/state labels; explicit live-full versus saved-preview badges and counts |
| Output toolbar | Output format, Headers, Row #, Copy, Export, Chart, Settings | Search, selection-only Tools/Copy, Chart, separate Settings | Same labels, formats, and action order; responsive notebook wrapping/overflow |
| Export formats | CSV, XLSX, TSV, JSON, NDJSON, HTML, Markdown | Copy TSV/CSV only | Shared format contract; live and saved-preview export through validated extension messaging; XLSX remains export-only |
| Range selection | Mouse drag, Shift extension, selected-range status | Mouse drag, Shift and keyboard extension | Shared range/status model; preserve notebook keyboard support and bounded clipboard guard |
| Sorting | Full-result asc/desc/none | Live full-result and saved-preview asc/desc/none | Shared sort-cycle label/semantics; keep extension-side live sort |
| Search | Formatted visible cells, capped results, Prev/Next | Live and saved search with Enter/Shift+Enter | Same Search/Prev/Next vocabulary, status, cap disclosure, and focus semantics |
| Column controls | Visibility, reorder, auto-fit/reset widths | None | Visibility and keyboard reorder in notebook; shared labels; panel-only pointer resize/auto-fit documented |
| Table rendering | Virtual grid, sticky header/index, VS Code themes, q formatting | Virtual live grid and bounded saved table with different skin | Shared tokens, density, borders, focus, selection/search colors, and formatting source |
| Null/temporal/symbol formatting | `ColumnarPanelResult.cellText` and q conversion | Live uses the same formatter; saved uses portable typed cells | Contract tests bind both paths to the same expected presentation |
| qText/scalar | qText settings and raw copy/export; scalar is a one-row grid | qText copy; scalar follows portable table/qText shape | Same qText controls and copy/export; scalar stays a grid where the panel does |
| Error/cancel | Error status and disabled table actions | Native notebook error output | Gallery and docs show the intentional native notebook error host; no fake table |
| Chart families | Line, Scatter, Step, Bar, Box, Candlestick | Same six families | Shared ordered type/capability contract |
| Chart columns | X, multi-Y, optional Group by, OHLC roles | Same model | Shared labels/capability rules and compatibility reconciliation |
| Chart lifecycle | Dirty controls keep old chart; Render applies; reset/refine zoom | Dirty controls keep old chart; Render and reset only | Add live Refine zoom through the live handle; saved preview remains reset-only |
| Series visibility | Legend click/keyboard; hidden state survives compatible rerenders | Same session behavior | Preserve and contract-test hidden-series behavior |
| Chart export | PNG through extension save dialog | None | PNG through validated extension messaging for live and saved-preview charts |
| Chart/table layout | Chart above table | Chart below table | Keep notebook chart below the useful grid as explicitly required |
| Settings source | `vscode-kdb.results.*` | Same configuration, duplicated schema/labels | Shared schema/defaults/labels; updates broadcast to panel and notebook |
| Live lifecycle | Full result remains in extension memory | Live handle requests slices/search/copy/chart | Preserve; add export/refined-chart adapters without persisting the full result |
| Saved lifecycle | Not applicable | Bounded portable preview | Explicit saved-preview state, omitted-row notice, rerun and open-current-preview actions |
| Open in KX Results | Native panel | Existing live table/text handoff | Exact shared label and same in-memory result object; saved output opens only the bounded preview |
| Local data server | Full-panel action | None | Full-panel-only: notebook sandbox has no durable server ownership |
| Large-operation confirmation | Modal copy/export/sort guardrails | Hard bounded inline copy/sort | Preserve limits; extension-side export confirmation; direct users to full panel when a notebook bound is hit |
| Accessibility | Native controls and legend keyboard support; grid gaps | Grid arrow navigation and ARIA, but visual/focus drift | Shared focus-visible styles, live regions, labels, reduced motion, narrow-width checks |
| Visual acceptance | No automated baseline | No automated baseline | Deterministic gallery plus real Extension Host light/dark table/chart and narrow screenshots |

## Closed implementation and unavoidable host differences

The refactor now shares `results-ui-contract.ts`, `kx-results-export.ts`, q
formatting/chart/series models, and semantic CSS between the panel and renderer.
The notebook host adapters implement every practical target above. The remaining
differences are ownership or persistence boundaries rather than alternate UI:

- A notebook can persist only the bounded portable preview. A first-party direct
  output's opaque live ID is session-bound and cannot recreate omitted rows after
  reload. Its separate opaque output-binding token may persist in output metadata
  only to target actions to the exact output; it contains no result data and
  grants no reopened live access.
- The notebook chart stays below the table and uses a bounded cell-height layout;
  the full panel owns the whole editor and can resize chart and grid against the
  full viewport.
- The local data server, running-query controls, pointer column resizing/auto-fit,
  editor-sized table/chart splitter, and automatic high-density zoom refinement
  remain full-panel facilities. Notebook copy/export uses the shared cell and
  estimated-byte confirmation guard, and live zoom has an explicit working
  **Refine zoom** action.
