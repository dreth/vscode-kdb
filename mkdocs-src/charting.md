# Charting

The KX result viewer includes a compact built-in chart for the current visible grid result. Version 0.2.0 introduced bounded inline notebook charts for the persisted KX MIME previews used at that time.

The standalone extension does not currently contribute a run-and-auto-chart `.q` editor command. Run q first, then open **Chart** from its KX result panel.

## Notebook charts

A live result from either **KX q (Direct IPC)** or mixed-mode **Run q Cell (KX)** issues bounded chart requests against its full in-memory value and can hand that exact value to the standard KX Results panel. Both surfaces consume one chart-family/capability contract:

- line, scatter, step, bar, box, and candlestick;
- an eligible X column;
- one or more eligible Y series;
- Group By only for supported generic types; and
- distinct Open, High, Low, and Close fields for candlestick.

Column choices are visible and validated. Changing configuration leaves the old rendered chart visible until **Render** is pressed. The chart stays below the table and adds no chart height while hidden.

There is no redundant notebook-only visible Point cap control. Live requests honor the shared `vscode-kdb.results.*` source guardrail, the fixed density contract below, and a hard 10,000-point inline safety ceiling; compact status text distinguishes eligible source rows from rendered visual items and reports validation, reduction, and warnings. A compact overview navigator directly below the main plot represents the full X domain and its selected window for all six chart families. Drag the window to pan, drag either edge to resize, or use its focusable window and handles with bounded arrow-key adjustments. Main-plot drag defaults to zoom; the toolbar toggle immediately before chart close selects explicit pan mode, and Shift-drag remains a pan override while zoom mode is selected. Home resets. Every distinct settled live viewport, including a second navigator or zoom change inside a refined response, uses an absolute range from the full in-memory source. All viewport input uses the same range-loading and deterministic resampling decision rather than a second sampling policy. The bundled local uPlot implementation uses VS Code theme tokens for readable axis/tick text and restrained grid/tick contrast in light, dark, and high-contrast themes. Numeric Y-axis width is measured from its formatted labels rather than fixed, and useful configured decimal precision is retained. Multi-series charts keep a visible legend with a color swatch for every plotted label. Each legend button supports pointer and **Enter**/**Space** toggling, exposes its current pressed state, and visibly distinguishes a hidden series. Hidden-series state survives compatible navigator changes, zoom, automatic refinement, reset, rerender, resize, settings, and configuration updates.

The Y-series selector repeats the same swatches beside selected and available series, so names map directly to plotted lines. Its overlay is width-contained and vertically scrollable instead of covering the full notebook output at narrow widths.

Separately installed `kx-notebook==0.1.0` can persist a supported chart specification using eligible bounded rows. First-party direct output does not write a chart specification to saved notebook output.

On the released-companion route, the emitted chart specification is notebook data. Renderer control changes and zoom are session state and do not silently rewrite the `.ipynb`; re-emit the companion result with the desired `kx_notebook.Chart` specification to persist a changed selection. Its escaped `text/html` fallback renders a network-free static SVG from the emitted specification. Direct IPC output from the mixed runner or optional controller has no HTML fallback or persisted chart specification. HTML/PDF export is static and does not preserve uPlot controls, tooltips, or zoom.

Once a direct result's bound live record is absent, notebook charting uses only rows owned by the MIME payload. New first-party Direct IPC output automatically owns every exactly represented row in its complete v2 payload. A historical or Python-helper preview can navigate and reset within its stored rows but cannot request omitted rows; rerunning a historical first-party preview executes the current cell source and replaces it with new complete output. Opening a bounded preview in the full KX Results panel does not restore missing data. The panel additionally has an editor-sized draggable table/chart splitter; inline output deliberately keeps the chart below the table.

## Open and render

1. Run q into a KX result panel.
2. Press the top-level **Chart** button.
3. Select a chart type and eligible columns.
4. Press **Render**.
5. Use the tooltip/crosshair, pointer or keyboard legend toggles, the **Zoom mode**/**Pan mode** drag toggle, Shift-drag panning, the overview navigator's draggable/resizable window, or **Reset zoom**.
6. After rendering, use **Export PNG** to save the chart canvas.

Changing controls does not silently rerender the existing chart. The panel marks settings as changed until **Render** is pressed. Compatible chart selections are remembered for that result shape.

## Types and controls

| Type | X | Values | Group by |
| --- | --- | --- | --- |
| Line | Numeric or temporal | One or more numeric Y columns | Categorical column supported |
| Scatter | Numeric or temporal | One or more numeric Y columns | Categorical column supported |
| Step | Numeric or temporal | One or more numeric Y columns | Categorical column supported |
| Bar | Numeric or temporal | One or more numeric Y columns | Categorical column supported |
| Box | Numeric or temporal | One or more numeric Y columns summarized as box statistics | Not supported |
| Candlestick | Numeric or temporal | Four distinct numeric Open, High, Low, and Close columns | Not supported |

Decoded q columns use shared q type metadata before any value sampling. q `byte`, `short`, `int`, `long`, `real`, and `float` are numeric; q `timestamp`, `month`, `date`, `datetime`, `timespan`, `minute`, `second`, and `time` are temporal. Every listed temporal type is a valid X choice for every chart family above, but not a numeric Y or OHLC choice. Portable notebook schema uses the same classification, so saved temporal values remain chartable within the rows their payload owns. Unknown/untyped external values use conservative sample inference. Hidden columns do not appear as chart choices.

### Candlestick validation

Candlestick rows require finite numeric OHLC values. The selected columns must be distinct, `High` must be at least `Low`, `Open`, and `Close`, and `Low` must be no greater than `Open` and `Close`. The chart reports the offending row/x value instead of drawing an invalid envelope.

Rows at the same x value are aggregated into an OHLC candle. Further reduction uses financial buckets that preserve opening, high, low, and closing meaning.

## Interaction and reduction

The bundled uPlot assets run locally under the VS Code webview content security policy. The chart supports:

- cursor/crosshair values and OHLC-aware tooltips;
- readable numeric and temporal axes using VS Code theme colors;
- a persistent color-keyed legend with pointer and **Enter**/**Space** series toggling;
- zoom-default main-plot dragging with an explicit zoom/pan toggle and Shift-drag pan override;
- a full-X-domain overview navigator with a draggable window, two resizable edges, focusable window/handles, bounded arrow-key adjustments, and Home reset;
- automatic refinement below the visible-sample low-water mark, with no separate Refine button;
- reset to the original x domain;
- a draggable chart/table splitter; and
- PNG export of the rendered canvas, including custom bars, boxes, and candles.

The first full render captures an immutable original X domain and retains the extension-side full source and original sample. Main-plot zoom plus navigator window/edge input feed one settled-viewport coordinator. For an identical absolute X range, every input runs the same unchanged range-loading and resampling decision. A sampled view is retained while at least 3,000 sampled points remain visible; below that low-water mark, retained source is refined toward the 7,000-point target only when eligible unsampled source rows remain. Navigator movement and resizing clamp to the immutable full range, stale replies cannot replace a newer range or reset, and Y remains automatic for visible X rather than gaining a second navigator. Identical scale notifications are deduplicated. Programmatic response reconstruction, settings, resize, and hide/show rerenders cannot recursively request another range. The same lifecycle applies to live notebook charts, while saved notebook charts navigate and rebuild from their immutable stored payload.

Navigator changes, manual zoom, automatic refinement, resize/rerender, and reduced samples never replace the immutable baseline. **Reset zoom**, Home, or double-click restores the original numeric or temporal domain and sample without backend I/O, invalidates pending requests, returns Y to automatic scaling, and clears selection, tooltip, and settled-range timer/state. Series hidden from the legend remain hidden through these refreshes. The button state uses a small deterministic floating-point tolerance.

Input x values are sorted for charting when required; table order is unchanged and a warning is shown. Invalid x values are dropped. Line and step retain sampled gaps for missing/non-finite Y values; other generic types skip them where appropriate.

Generic series use deterministic min/max-aware reduction, bars keep aligned X clusters, boxes use bounded X buckets, and candlesticks use OHLC-aware aggregation. Ungrouped temporal line/scatter/step charts may instead use automatic or fixed-duration min/max buckets anchored to Unix epoch zero, so overlapping viewport requests keep compatible boundaries. Same-level panning retains the bucket duration and may reuse safe overlapping summaries; grouped and other unsafe cases fall back to full range reduction. Grouping retains at most 12 categories and 36 generated group/Y series. Status text separately reports eligible rows, rendered visual items, the algorithm, and warnings; a reduced group/candle count is not presented as missing eligible source rows.

## Limits and settings

The default chart source limit is 2,000,000 rows. Sources above `vscode-kdb.results.viewer.chartMaxSourceRows` are rejected before scanning. Raising the limit can block the extension host; prefer a q-side limit or the [Local Data Server](local-data-server.md) for larger analysis.

Initial/full and absolute ranged views use one fixed ordinary-series density contract; plot width is not a lower cap:

- Fewer than 7,000 eligible finite source points: render every eligible point and never upsample.
- At least 7,000 eligible finite source points: line, scatter, and step render exactly 7,000 deterministic plotted points when chart semantics do not genuinely consolidate them. The reducer preserves first/last and extrema where possible, then fills the remaining slots deterministically.

Type-specific semantic consolidation still applies. Bar grouping and duplicate-X consolidation may produce fewer aligned visual clusters; boxes may produce fewer buckets; candlesticks aggregate duplicate X values and may produce fewer candles. Status keeps eligible source rows separate from these rendered visual-item counts. Hard source-row and notebook safety ceilings remain in force. Configure numeric label precision and the source-row guardrail using the [chart settings](settings.md#charting).

The legacy `vscode-kdb.results.viewer.chartZoomMinSampledPoints` and `vscode-kdb.results.viewer.chartZoomMaxSampledPoints` keys remain only as deprecated compatibility entries. They are ignored so user or workspace overrides cannot weaken the fixed 7,000-point ordinary-series contract.

## Zoom lifecycle compatibility note

The exact KDB SQLTools 0.3.15 release source at commit `f7af079` rebuilt each refined response as a fresh plot whose natural sampled X-domain became the next zoom frame. The following 0.3.16 lifecycle change at commit `4beaa6b` added a fixed full-range baseline plus one `chartRequestIsRefinement` boolean, but did not retain the exact requested range and original full sample as independent state. A refined plot reconstruction could therefore compare its natural sampled domain with the full baseline as though it were a new user zoom, while nested requests and Reset lacked a complete lifecycle baseline.

This implementation instead tracks the active request ID, exact absolute requested range, immutable original domain, and original full sample separately. That is why a reconstruction notification can be ignored without suppressing a distinct second zoom, and why Reset can reject stale responses and restore locally.

The built-in chart intentionally does not attempt to embed a full external analytics environment. Use tokenized local data endpoints for Python, pandas, Plotly, or another separately managed toolchain.
