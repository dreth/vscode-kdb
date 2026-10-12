## 1. Lock the Namespace Contract with Focused Tests

- [x] 1.1 Add pure failing-first tests for process-root parsing, top-level one-character namespace exclusion, `.qr` acceptance only when returned, absent-name omission, nested qualified paths, deterministic ordering, unsafe-name omission, and malformed/oversized response rejection.
- [x] 1.2 Add pure failing-first tests that distinguish actual nested namespace contexts from ordinary type-99 dictionary bindings and classify data, table, function, projection, and unknown leaves conservatively.
- [x] 1.3 Add provider failing-first tests for explicit root refresh, lazy namespace expansion, generation-owned caching, branch-local loading/empty/error/cancel/oversized states, and invalidation on active route/session/namespace changes.
- [x] 1.4 Add action failing-first tests proving only current data/table rows can open bounded fully qualified previews, while a present application callable remains visible but functions, projections, namespaces, unknowns, stale rows, and unsafe paths cannot issue materialization queries.

## 2. Build Isolated Process-Workspace Metadata

- [x] 2.1 Add shared process-root and validated namespace-context query builders plus response schemas/parsers without changing the existing configured-namespace `SERVER_VARIABLES_QUERY` contract.
- [x] 2.2 Implement structural filtering for every one-character top-level namespace, per-segment qualified identifier validation, derived fully qualified labels, namespace-context detection, binding-kind classification, omission counts, and deterministic child ordering.
- [x] 2.3 Add a dedicated Variables-only metadata API that uses the existing active direct-q session and enforces current timeout, cancellation, item, byte, request-shape, and stale-generation bounds without installing q code or entering Query History.
- [x] 2.4 Preserve the existing configured-namespace `QMetadataService.root()`/table paths and add negative regressions proving Server Explorer and connected language intelligence receive no process-wide metadata.

## 3. Render the Hierarchical Variables Tracker

- [x] 3.1 Replace the flat Variables list with provider-owned root-context, namespace, binding, omitted-count, and branch-status tree items while retaining the existing KX Variables view identity and native reordering behavior.
- [x] 3.2 Make refresh discover root bindings and accepted namespace roots atomically, make expansion load one immediate context lazily, cache successful children for the current generation, and never query on activation, visibility, collapse, or ordinary user-query completion.
- [x] 3.3 Invalidate root and child rows, local waits, and late responses on refresh or active connection/session/configured-namespace/state changes, preserving explicit no-runtime, disconnected, never-refreshed, canceled, failed, empty, and incomplete states.
- [x] 3.4 Show fully qualified names and conservative kinds only for bindings returned by q, including application objects defined before connection or out of band, and remove rows after a successful refresh no longer reports them.

## 4. Keep Results Handoff Safe

- [x] 4.1 Extend the Variables Results command to resolve only current provider-owned data/table items, revalidate their absolute qualified path and kind around confirmation, and build only bounded extension-owned preview expressions.
- [x] 4.2 Keep function/projection/namespace/unknown rows non-actionable, ensure metadata and previews remain excluded from Query History, and verify declining confirmation or observing removal/retyping issues no materialization query.
- [x] 4.3 Run focused Results regressions proving qualified data/table previews retain existing conversion, grid/list/dictionary, copy/export, chart, and chart-sampling behavior and never create or mutate live or saved notebook output.

## 5. Live-q, Documentation, and Release Verification

- [x] 5.1 Add live-q fixtures for a clean runtime's reserved roots, a root value/table/function, a conditionally present application callable, nested application namespaces including a one-character nested segment, and an ordinary dictionary; verify present, absent, and removed bindings plus preview safety without fetching or invoking callable values.
- [x] 5.2 Update `mkdocs-src/connections.md`, `mkdocs-src/settings.md`, generated documentation, and `CHANGELOG.md` with process-wide manual discovery, the one-character reserved-root rule, lazy expansion, callable visibility, bounds, and Results-action eligibility.
- [ ] 5.3 Run the focused deterministic and Extension Host suites plus the supported live-q suite, resolving all namespace, stale-state, privacy, and configured-metadata isolation failures. Focused and live-q suites pass; Extension Host remains blocked because this environment has neither a compatible Linux VS Code runtime nor Xvfb.
- [x] 5.4 Run the full `npm test` gate and strict OpenSpec validation for `track-runtime-namespaces`; reconcile its requirement ordering with `add-runtime-sidebar-views` before either change is archived and keep every task checkbox accurate.
