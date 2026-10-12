## 1. Lock the Grouping Contract with Regression Tests

- [x] 1.1 Add focused failing tests for scalar group eligibility covering categorical, boolean, GUID, numeric, and temporal q metadata/inference; reject nested/complex values and prove candidate discovery is independent of the current virtualized column window.
- [x] 1.2 Add shared control-model and panel/browser tests proving **Group By** remains visible for all six chart types, disables honestly when no distinct candidate exists, preserves an eligible selection across type changes, and rejects X/Y/OHLC role conflicts.
- [x] 1.3 Add chart-data failing tests for existing grouped line/scatter/step/bar behavior, independently computed grouped box statistics, independently validated/aggregated grouped candlesticks, missing group values, duplicate X isolation, deterministic category/series ordering, and unchanged ungrouped output.
- [x] 1.4 Add bounds and lifecycle tests for the 12-category, 36-series, and shared visual-item limits; configuration/cache identity; explicit Render dirty state; stale-response rejection; grouped zoom/reset; and hidden grouped-series persistence.
- [x] 1.5 Add strict live-message, portable-v1, saved-renderer, and Python companion failing tests for grouped box/candlestick acceptance, malformed/excessive grouped-data rejection, old chart compatibility, exact saved-row ownership, and the explicit static-fallback notice.

## 2. Extend the Shared Chart Model

- [x] 2.1 Separate stable scalar groupability from numeric/temporal X/Y eligibility in the shared inference model, use q metadata when available and bounded value inference otherwise, and filter active chart-role conflicts centrally.
- [x] 2.2 Make `chartTypeCapabilities` the all-six-family grouping source of truth and remove divergent family checks from selection reconciliation, panel controls, notebook controls, request validation, and persistence validation.
- [x] 2.3 Implement grouped box preparation using shared deterministic X bins and independent `(group, Y, bin)` statistics while retaining the ungrouped path and existing box semantics byte-for-byte where practical.
- [x] 2.4 Implement grouped candlestick collection, per-category envelope validation/aggregation, aligned grouped candle series, union X domain, and category-specific error/warning context while retaining the current flat ungrouped path.
- [x] 2.5 Apply stable 12-category/36-combination selection and one total family-specific/7,000 visual-item budget before expensive preparation; report eligible rows, retained categories, omitted combinations, and returned items honestly.

## 3. Wire Results and Notebook Interaction

- [x] 3.1 Update KX Results controls, saved selection, request construction, legends, tooltips, status, overview, PNG/export rendering, and clustered box/candlestick drawing for grouped families without changing ungrouped charts.
- [x] 3.2 Update live notebook controls and host requests/responses so all six types use the complete explicitly visible schema, strict grouped-family payloads, stable category keys, and the existing dirty/render/zoom/reset/stale lifecycle.
- [x] 3.3 Update saved notebook controls and local preparation to retain off-screen visible group candidates, render grouped boxes/candles from owned rows only, and preserve hidden-series and compatible viewport state.
- [x] 3.4 Add accessible category/direction styling for grouped candles and category/measure styling for grouped boxes across light, dark, and high-contrast themes, with keyboard-operable legend visibility and non-color tooltip text.

## 4. Preserve Portable and Companion Compatibility

- [x] 4.1 Extend notebook message models/parsers with bounded aligned grouped box/candlestick structures and reject unknown fields, inconsistent alignment, invalid finite values, excessive categories/series/items, and family-mismatched shapes.
- [x] 4.2 Allow `groupByColumn` for box and candlestick in portable chart version 1 and every first-party saved-output validation/reconciliation path while preserving all existing valid v1/v2 output and no-group behavior.
- [x] 4.3 Update `kx_notebook.Chart` validation, MIME emission, tests, and README to allow distinct valid group columns for all six types while keeping the grouped static HTML fallback explicitly interactive-only.
- [ ] 4.4 Run cross-contract and parity fixtures proving equivalent Results, live notebook, saved notebook, and Python-emitted specifications select the same groups and family semantics without changing q values or issuing q queries.

## 5. Documentation and Verification

- [x] 5.1 Update `mkdocs-src/charting.md`, `mkdocs-src/notebooks.md`, `mkdocs-src/results-viewer.md`, relevant settings/performance guidance, generated `docs/`, and `CHANGELOG.md` with all-family grouping, scalar eligibility, role separation, limits, and static-fallback behavior.
- [ ] 5.2 Run focused chart/model/browser/message/contract tests, `npm run test:notebook-python`, live-q chart classification where supported, and the chart sampling benchmark; resolve correctness, parity, confidentiality, and performance regressions.
- [ ] 5.3 Run `npm test`, the applicable Extension Host or visual acceptance suite when its runtime is available, strict OpenSpec validation for `enable-group-by-all-charts`, and `git diff --check`; record any environment-only acceptance blocker without marking it complete.

Verification blockers: `npm run test:results-display-browser` cannot run because no Linux Chromium executable is available; `npm run test:extension-host` cannot run because no compatible Linux VS Code runtime is available. The worktree cross-parity runner also fails its preflight because its pinned reference checkout is at revision `71d05103ce1a48c63b117ed75e8bc973f7e0e79e` instead of expected `b1e77c361cff685384bedfdc948078b2a597b9e3`.

## 6. Repeated-X Grouping Regression

- [x] 6.1 Add focused line/scatter/step regressions proving repeated finite `(group, X)` values remain source-ordered, aligned across groups and selected Y columns, bounded by ordinary sampling, and no longer blank the chart.
- [x] 6.2 Implement occurrence-aware grouped ordinary alignment without changing ungrouped output, family-specific box/candlestick aggregation, category limits, or query behavior.
