## Why

Chart grouping is currently exposed only for line, scatter, step, and bar charts, and even those charts reject numeric and temporal scalar grouping columns despite the shared grouping engine being able to normalize them. This makes a common line-chart workflow appear broken and creates an unnecessary capability gap for box and candlestick charts.

## What Changes

- Make **Group By** available for all six interactive chart families: line, scatter, step, bar, box, and candlestick.
- Treat safely representable scalar categorical, numeric, and temporal columns as eligible grouping keys, while continuing to reject nested or otherwise unsupported values and to report unavailable selections explicitly.
- Preserve the existing ungrouped output exactly; grouped box charts compute statistics independently per category, and grouped candlestick charts aggregate and render independent OHLC series per category.
- Preserve repeated X observations within one grouped line, scatter, or step series in stable source-occurrence slots instead of rejecting the complete chart when normalized X values collide.
- Apply the same control, validation, grouping, limits, status, legend, hidden-series, zoom/reset, and stale-response behavior in KX Results, live notebook output, and saved notebook output.
- Extend the portable notebook chart contract and the separately packaged Python companion to accept grouped box and candlestick specifications without changing MIME versions. The static network-free HTML fallback remains explicit that grouped charts require the interactive renderer.
- Preserve the 12-category and 36-generated-series safeguards, chart source-row limits, the 7,000-item density ceiling, family-specific aggregation, q-value identity, and existing behavior when **Group By** is `None`.

Non-goals: this change does not rewrite the source q query, perform server-side grouping, add a new chart family, change ungrouped geometry or sampling, make complex/nested q values valid grouping keys, or add grouped rendering to the static HTML fallback.

## Capabilities

### New Capabilities

- `chart-grouping`: Defines eligible grouping keys and consistent grouped behavior across every chart family and Results/notebook surface.

### Modified Capabilities

- `chart-resampling`: Extends the existing density, aggregation, cache-compatibility, and status guarantees to grouped box and candlestick output without weakening the ungrouped or ordinary-series contracts.

## Impact

- Shared chart classification and data preparation in `src/charting.ts`, including grouped box/candlestick response models and existing group/series caps.
- KX Results controls, rendering, legends, tooltips, selection persistence, zoom/refinement, and status in `src/kx-results-panel.ts`.
- Live and saved notebook control/message/persistence/rendering paths in `src/notebook-renderer-model.ts`, `src/notebook-message.ts`, `src/notebook-contract.ts`, `src/notebook-live-results.ts`, `src/notebook-integration.ts`, and `renderer/index.ts`.
- The `kx_notebook.Chart` validation contract, tests, and documentation in `python/kx_notebook/`; no MIME schema version bump or new dependency is expected.
- Deterministic model, panel/browser, renderer, portable-contract, Python companion, parity, and documentation coverage. Existing chart sampling benchmarks remain applicable and grouped family-specific cases are added where necessary.
