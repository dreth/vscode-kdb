## Context

The shared chart model already supports grouping line, scatter, step, and bar data and can normalize strings, booleans, numbers, big integers, dates, and q scalar wrappers into bounded labels. Eligibility is narrower than that engine: declared numeric and temporal columns return early from inference without becoming grouping candidates. `chartTypeCapabilities`, panel/browser controls, live-message validation, saved chart validation, and the Python companion additionally hard-code box and candlestick as non-groupable.

Box data currently uses a common X-bin array plus aligned per-Y statistics. Candlestick data currently carries one flat candle array. Both the KX Results webview and notebook renderer have family-specific drawing, tooltip, overview, legend, zoom, and status paths. Portable notebook MIME stores the chart selection rather than prepared chart data, while live notebook prepared chart data crosses a validated extension-host/renderer message boundary. Static HTML intentionally does not draw grouped or family-specific interactive charts.

The existing chart-resampling specification remains authoritative: ordinary line/scatter/step charts keep the exact 7,000/3,000 density contract; bar, box, and candlestick keep family-specific aggregation under a 7,000 visual-item ceiling; all refills remain source-faithful and lifecycle-safe. The implementation must also preserve chart source-row guards, 12-category and 36-series caps, explicit Render behavior, hidden legend state, absolute-range zoom/reset, and the exact q/notebook result contracts.

## Goals / Non-Goals

**Goals:**

- Make a distinct scalar categorical, boolean, GUID, numeric, or temporal result column a valid grouping key.
- Expose one shared grouping capability for all six chart families in Results, live notebooks, and saved notebooks.
- Define independently computed grouped box statistics and independently validated/aggregated grouped OHLC series.
- Preserve deterministic bounds, lifecycle behavior, persisted version-1 compatibility, and identical ungrouped output.

**Non-Goals:**

- Server-side q grouping, query rewriting, or automatic reruns.
- Treating lists, dictionaries, tables, functions, projections, or arbitrary object stringification as grouping keys.
- Changing ungrouped chart geometry, ordinary-series density thresholds, result identity, or notebook MIME versions.
- Adding grouped drawing to the network-free static HTML fallback.

## Decisions

### Use one shared scalar-groupability classification

`chartColumnOptions` will expose grouping candidates from a shared inference result that distinguishes stable scalar groupability from X/Y numeric or temporal roles. Known q scalar metadata is authoritative; metadata-free columns use the existing bounded inference sample and `normalizeCategoricalValue`-style conversion. Groupability will include supported numeric and temporal values instead of being mutually exclusive with X/Y eligibility. Complex or inconsistent columns remain excluded.

Each surface will derive controls from the complete explicitly visible chart schema, not the current virtualized column window. The control model will remove the active X, selected Y, and OHLC columns from grouping candidates and clear a now-conflicting selection with an explanatory validation state. This keeps one role per column and prevents accidental one-category-per-observation explosions from selecting X itself.

Alternative considered: allow every column and let preparation stringify it. Rejected because nested q values are expensive, ambiguous, and can produce unsafe or unstable labels. Alternative considered: keep categorical-only candidates and only enable box/candlestick. Rejected because it does not fix numeric/temporal line grouping reported by the user even though the data engine already handles those scalar values.

### Make all chart capabilities groupable through the shared model

`chartTypeCapabilities` becomes the only source of truth and reports `supportsGroupBy: true` for all six types. Panel, live renderer, saved renderer, message validation, portable-contract validation, selection reconciliation, and Python validation will consume that shared policy or an exact mirror covered by cross-contract tests. The selector remains present but disabled when its filtered candidate list is empty. Switching chart types preserves an eligible group choice because no family now requires clearing it.

Alternative considered: special-case the missing line control only. Rejected because duplicated family checks are the reason behavior diverges and the user explicitly requested grouping for all chart types.

### Align grouped box data on shared X bins

Box preparation will first select retained categories under the existing stable 12-category policy, establish the same deterministic X bins used by the ungrouped path, then compute statistics independently for every retained `(group, Y, X-bin)` combination. `BoxChartSeries` gains bounded group identity, and its display label derives from group plus Y while keeping the original source column name. The total combination count remains subject to the 36-series cap and box-item budget. Ungrouped preparation continues through the current path so its bytes and geometry do not drift.

Alternative considered: replace X with group categories for box charts. Rejected because it changes the meaning of the required X selector and breaks zoom/navigator parity. Alternative considered: compute bins independently per group. Rejected because incomparable X positions complicate shared navigation and can visually misalign categories.

### Add aligned grouped candlestick series

Candlestick source collection will optionally capture a normalized group value before OHLC aggregation. Retained groups are selected stably and each group is validated and aggregated independently. Prepared data gains an optional bounded candlestick-series array containing group identity and candles aligned to the union of returned X positions with explicit missing slots. The existing flat `candlesticks` field and rendering path remain unchanged for ungrouped charts.

Panel and notebook renderers will draw grouped candles side-by-side at a shared X position. Category hue identifies the group; bullish/bearish direction remains distinguishable through a consistent lightness/fill treatment and tooltip text. Legend keys use stable group identities so visibility survives compatible refresh paths. Navigator/overview data uses the union X domain and a deterministic close-value summary without claiming one category is the whole source.

Alternative considered: overlay all group candles at the same X coordinate. Rejected because one group can obscure another. Alternative considered: emit one independent plot per category. Rejected because it breaks the existing one-chart controls, shared navigator, export, and comparison workflow.

### Apply one total visual-item budget

For grouped family charts, a visual item is one category bar, box, or candle. The 7,000 ceiling and stricter family/width bounds apply to the total across categories, not once per category. Budget allocation follows stable retained-group order with deterministic proportional remainder distribution, and aggregation never combines different groups. Status reports source rows, retained categories, and total returned items separately.

Ordinary grouped line/scatter/step behavior keeps its current aligned X sampler and series caps. Grouping stays part of the existing configuration/cache key; changing it invalidates pan/refinement state and late responses through the current request-id lifecycle.

### Preserve repeated ordinary grouped observations by occurrence

For line, scatter, and step charts, rows that share one normalized X and group are aligned by their stable source occurrence within that `(X, group)` cluster. The cluster emits as many repeated X slots as the largest retained group needs; each generated series fills its corresponding occurrence and other groups receive null slots. This retains finite source observations, keeps every generated series aligned, and avoids blanking the chart when q timestamps or other X values normalize to the same plotted position. The ordinary shared sampler remains responsible for the 7,000-point bound.

Alternative considered: average or take the last duplicate value. Rejected because it silently changes the user's Y values. Alternative considered: keep the unique-X error. Rejected because one duplicate currently prevents every otherwise valid grouped series from rendering.

### Extend existing version-1 boundaries additively

Portable chart selection already has optional `groupByColumn`; validation will allow it for box and candlestick without changing field names or MIME version. Existing payloads remain valid. Live prepared-data validation will add only the bounded grouped family structures required by the renderer and will continue rejecting inconsistent shapes, unknown fields, excessive categories/items, or mismatched alignment.

The Python companion will remove its family restriction while retaining column existence, role separation, and OHLC validation. Its static fallback keeps the existing explicit interactive-only notice for every grouped chart. No persisted prepared chart data or migration is introduced.

## Risks / Trade-offs

- [Grouped candlestick colors must communicate category and price direction simultaneously] → Use category hue plus consistent bullish/bearish fill/lightness, include textual tooltip/legend identity, and cover light, dark, and high-contrast rendering.
- [Many group/Y combinations can increase preparation and drawing cost] → Apply the existing 12-category/36-series caps before expensive statistics, use one total item budget, retain source-row guards, and benchmark grouped family fixtures.
- [Broad scalar eligibility can offer high-cardinality identifiers] → Keep deterministic category caps and warnings; do not scan or materialize complex values merely to populate the selector.
- [A wider live message shape could weaken validation] → Add strict shape, alignment, finite-value, category-count, series-count, item-count, and unknown-field tests before renderer use.
- [Role changes can invalidate a selected group] → Reconcile controls centrally, clear conflicts visibly, and retain the previously rendered chart until explicit Render.
- [Saved and live surfaces can drift] → Test the shared capability/control model, host/browser message parsers, portable contract, Python cross-contract, and executable panel/notebook rendering paths with the same fixtures.

## Migration Plan

1. Land shared groupability and all-family capability tests before changing controls.
2. Add grouped box/candlestick preparation models and strict validators while preserving the ungrouped branches.
3. Wire Results and notebook controls/renderers, lifecycle keys, persistence, and Python emission.
4. Update charting/notebook/results documentation, generated docs, changelog, and visual/manual acceptance evidence.
5. Run focused chart/browser/contract/Python suites, sampling benchmarks, `npm test`, and strict OpenSpec validation.

Rollback can restore the family restrictions and ignore the additive grouped prepared-data fields; previously valid ungrouped and generic grouped version-1 payloads require no migration.

## Open Questions

None. The grouped-family semantics, role separation, bounds, and static-fallback boundary are fixed by this design.
