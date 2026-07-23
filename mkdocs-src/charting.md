# Charting

The KX result viewer includes a compact built-in chart for the current visible grid result. Version 0.2.0 also provides bounded inline notebook charts for persisted KX MIME previews.

The standalone extension does not currently contribute a run-and-auto-chart `.q` editor command. Run q first, then open **Chart** from its KX result panel.

## Notebook charts

A live **KX q (Direct IPC)** result can issue bounded chart requests against its full in-memory value and can open that value in the standard KX Results panel for the panel's supported line, scatter, step, bar, box, candlestick, refinement, and export behavior. It uses the common durable `vscode-kdb.results.*` chart settings.

The separate Python helper can persist a chart specification for line, scatter, step, or bar using eligible bounded rows. Direct-controller output does not write a chart specification to the saved snapshot. The VS Code NotebookRenderer uses the bundled local uPlot implementation and provides show/hide, type, X column, Y series, point-cap, and Reset zoom controls for both live/direct and saved bounded data.

On the Python-helper route, the emitted chart specification is notebook data. Renderer control changes and zoom are session state and do not silently rewrite the `.ipynb`; re-emit the helper result with the desired `kx_notebook.Chart` specification to persist a changed selection. Its escaped `text/html` fallback renders a network-free static SVG from the emitted specification. Direct-controller output has no HTML fallback or persisted chart specification. HTML/PDF export is static and does not preserve uPlot controls, tooltips, or zoom.

Once a direct result's bound live record is absent, notebook charting uses only the bounded rows saved in the MIME payload. Opening that snapshot in the full KX Results panel does not restore missing data.

## Open and render

1. Run q into a KX result panel.
2. Press the top-level **Chart** button.
3. Select a chart type and eligible columns.
4. Press **Render**.
5. Use the tooltip/crosshair, legend toggles, drag zoom, **Refine zoom**, or **Reset zoom**.
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

Column eligibility is inferred from a sample of visible data. Hidden columns do not appear as chart choices.

### Candlestick validation

Candlestick rows require finite numeric OHLC values. The selected columns must be distinct, `High` must be at least `Low`, `Open`, and `Close`, and `Low` must be no greater than `Open` and `Close`. The chart reports the offending row/x value instead of drawing an invalid envelope.

Rows at the same x value are aggregated into an OHLC candle. Further reduction uses financial buckets that preserve opening, high, low, and closing meaning.

## Interaction and reduction

The bundled uPlot assets run locally under the VS Code webview content security policy. The chart supports:

- cursor/crosshair values and OHLC-aware tooltips;
- readable numeric and temporal axes;
- legend series toggling;
- drag-select zoom;
- automatic and explicit refinement of the current zoom range;
- reset to the original x domain;
- a draggable chart/table splitter; and
- PNG export of the rendered canvas, including custom bars, boxes, and candles.

The first full render captures an immutable original X-domain and retains the original full sample. Manual drag zoom, auto-refinement, explicit **Refine zoom**, resize/rerender, and refined samples do not replace them. **Reset zoom** restores that original numeric or temporal domain and original sample, returns Y to automatic scaling, clears selection and tooltip state, and clears pending auto-refinement timer/state. The button state is derived from the current scale with a small deterministic floating-point tolerance.

Input x values are sorted for charting when required; table order is unchanged and a warning is shown. Invalid x values are dropped. Line and step retain sampled gaps for missing/non-finite Y values; other generic types skip them where appropriate.

Generic series use min/max-aware reduction, bars keep aligned x clusters, boxes use bounded x buckets, and candlesticks use OHLC-aware aggregation. Grouping retains at most 12 categories and 36 generated group/Y series. Status text reports source rows, eligible rows, sampled points, the algorithm, and warnings.

## Limits and settings

The default chart source limit is 2,000,000 rows. Sources above `vscode-kdb.results.viewer.chartMaxSourceRows` are rejected before scanning. Raising the limit can block the extension host; prefer a q-side limit or the [Local Data Server](local-data-server.md) for larger analysis.

The full-view sample target is bounded by plot width and a built-in 12,000-point ceiling. Zoom refinement defaults to a 3,000-point trigger and a 7,000-point maximum. Configure numeric label precision and refinement using the [chart settings](settings.md#charting).

The built-in chart intentionally does not attempt to embed a full external analytics environment. Use tokenized local data endpoints for Python, pandas, Plotly, or another separately managed toolchain.
