## 1. Lock Down Shared Models and Contracts

- [x] 1.1 Add focused failing tests for a dedicated Variables snapshot: metadata-only refresh, deterministic data-variable filtering, unsafe-name counts, no tables/functions, empty/error/canceled states, and current-generation ownership; verify the new assertions fail before provider implementation.
- [x] 1.2 Add focused failing Query History model tests for a `notebook` execution kind, script-pipeline rerun mapping, unchanged v1 storage-key compatibility, ordering/deduplication/retention, and rejection of invalid or sensitive-shaped entries; verify existing line/selection/script fixtures remain valid.
- [x] 1.3 Refactor or extend the existing pure runtime metadata and preview helpers so Variables and Server Explorer share identifier validation, classification, bounds, warning text, and namespace-safe query construction; verify their focused model tests pass without changing existing Server Explorer outputs.

## 2. Add the Variables Sidebar View

- [x] 2.1 Implement the dedicated Variables tree provider/feature with explicit refresh, active-profile/session/namespace snapshots, metadata-only loading, deterministic rows, actionable inactive/disconnected/empty/error/canceled states, and connection-event generation invalidation; verify provider tests reject late and stale data.
- [x] 2.2 Implement the owned-row **Open Variable in KX Results** action with inline hover/focus contribution, modal bounded-materialization confirmation, second snapshot validation, and the existing strict-namespace Results runner; verify confirm/decline, stale/retyped/disconnected, unsafe-name, and expected connection/query arguments in the VS Code harness.
- [x] 2.3 Contribute and activate the unconditional `vscode-kdb.variables` view plus refresh/open commands while preserving all Connections and feature-gated Server Explorer contributions; verify manifest tests cover view placement, command enablement, title action, inline-only item action, and keyboard accessibility through native TreeView behavior.
- [x] 2.4 Make Connections, Variables, and Query History explicitly default-visible as native collapsible sections, preserve VS Code's built-in drag ordering and Views-menu controls, and issue a patch-version VSIX so an installed `0.2.29` cannot mask the new manifest.

## 3. Make History Discoverable Without Weakening Privacy

- [x] 3.1 Keep the Query History view/provider alive independently of capture enablement, add a disabled-status node, and invalidate pending captures on setting transitions without reading/displaying or deleting retained entries while disabled; verify enable/disable/re-enable, retained v1 entries, pruning, and no-write behavior in focused tests.
- [x] 3.2 Remove only the Query History view visibility condition while preserving capture/action feature gates, existing empty/entry presentation, rerun/copy/insert/delete/clear behavior, connection labels, and mismatch confirmation; verify manifest and tree-command regression tests pass.

## 4. Capture First-Party Direct-q Notebook Commands

- [x] 4.1 Add the contained history adapter at the shared direct-q notebook bridge issue boundary, recording one `notebook` entry for issued success/failure/post-issue cancellation and none for pre-issue rejection; verify source, actual connection identity, issue time, duration, and outcome with focused controller/bridge tests.
- [x] 4.2 Verify `.qnb` native runs and mixed-Jupyter **Run q Cell (KX)** each record exactly once while enabled, and that output commit retries, stale completions, disabled capture, metadata/preview requests, renderer actions, and Python-owned `%%q` runs do not create entries.
- [x] 4.3 Add failure-containment and compatibility coverage proving history-storage errors do not alter q execution/output success, reissue q, change live-result ownership, change exact persisted MIME v2, or affect KX Results/list-grid/chart behavior; run the notebook controller/integration and cross-contract gates.

## 5. Documentation and Verification

- [x] 5.1 Update `mkdocs-src/connections.md`, relevant notebook/settings/troubleshooting guidance, and `CHANGELOG.md` for the Variables refresh/open workflow, visible default-on History state and explicit opt-out, capture scope/exclusions, privacy, limits, and the distinction from Server Explorer; regenerate `docs/` and verify `mkdocs build --strict` succeeds.
- [ ] 5.2 Run focused deterministic tests plus `npm run test:extension-host`, `npm run test:notebook-cross`, and `npm run test:live-q`; record any environment-only blocker without marking behavior verified by an unrun gate.
- Verification note: deterministic tests, Extension Host, and notebook cross-contract pass. The available KDB-X 5.0 Community runtime rejects/resets the live gate's immediate post-readiness IPC connection; a diagnostic delayed connection reaches an existing q-version result-shape mismatch (`()` decoded as Grid where the gate expects Text). No compatible older q runtime is installed, so live-q behavior is not marked verified.
- [x] 5.3 Run the full `npm test` gate and `npm exec --no -- openspec validate add-runtime-sidebar-views --type change --strict`; resolve all failures and confirm every specified regression scenario has automated coverage or an explicit manual-verification rationale.
