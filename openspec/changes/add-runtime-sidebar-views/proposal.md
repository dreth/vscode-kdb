## Why

The KX activity-bar container does not currently give users a direct, always-discoverable view of data variables in the active q runtime, and its existing Query History view records only editor executions. Although the disabled-by-default Server Explorer can show variables inside a combined category and preview them through KX Results, that behavior is buried and does not provide the runtime-oriented Variables and History views users expect beside Connections.

## What Changes

- Add a dedicated **KX Variables** tree view beside **KX Connections**. It represents data variables in the globally active direct-q profile's configured namespace, uses explicit refresh rather than polling, and shows clear inactive, disconnected, loading, stale, cancellation, and error states.
- Add an inline hover action to each current variable row that, after the existing bounded-materialization confirmation, evaluates only that safely validated variable against the same active profile/session/namespace and opens the value in the normal KX Results panel.
- Keep the existing **KX Server Explorer** table, column, function-metadata, refresh, preview, and feature-gating behavior intact; share its metadata, identifier-validation, bounded-preview, diagnostics, and generation/staleness policy instead of creating a conflicting runtime-inspection path.
- Make **KX Query History** an always-discoverable sidebar view and enable local capture by default for new/default configurations. Preserve an explicit `false` opt-out and show an explanatory disabled/empty state when capture is off.
- Extend enabled Query History capture from issued editor line/selection/script executions to user-initiated first-party direct-q notebook cell executions as well. Keep newest-first ordering, bounds, outcomes, connection identity, rerun/copy/insert/delete/clear actions, and local-workspace-only storage; exclude result payloads, credentials, background metadata requests, variable previews, and Python-kernel-owned `%%q` executions.
- Add focused regression coverage and user documentation for view contribution/visibility, runtime binding, stale-item rejection, safe Results handoff, notebook-history capture, privacy, retention, and all existing Connections/Server Explorer/Results/notebook contracts at risk.

## Capabilities

### New Capabilities

- `runtime-sidebar-inspection`: Defines dedicated Variables and History views for the active q runtime, safe variable-to-Results handoff, capture scope and privacy, and preservation of the existing Connections and Server Explorer behavior.

### Modified Capabilities

- `notebook-q-execution`: Enabled Query History now records user-initiated first-party direct-q notebook executions without changing execution ownership, exactly-once behavior, inline/live/saved results, or output lifecycle.

## Impact

- Affected extension-host code: sidebar/view contributions in `package.json`; feature lifecycle and shared metadata/preview behavior in `src/feature-controls.ts`, `src/server-explorer.ts`, `src/server-explorer-model.ts`, and likely a focused Variables provider; Query History capture/model integration in `src/query-history.ts`, `src/query-history-model.ts`, `src/extension.ts`, and the direct-q notebook execution bridge/controller paths.
- Affected tests: deterministic provider/model, manifest, feature-control, history, editor/notebook execution, stale-generation, Results handoff, and live-q metadata/preview coverage in `test/`.
- Affected documentation: `mkdocs-src/connections.md`, notebook/history troubleshooting or settings guidance, generated `docs/`, and `CHANGELOG.md`.
- Compatibility boundaries: no change to connection selection or persistence, q IPC framing, query timeout/cancellation semantics, q-value identity, KX Results rendering/copy/export/chart sampling, live notebook rendering, or persisted notebook MIME v1/v2. The existing local Query History storage key and retained entries remain readable; disabled capture still performs no writes and does not silently delete retained text.
- Dependencies: no new runtime or webview dependency is expected.

## Non-goals

- Polling the q process, automatically refreshing after every query, browsing arbitrary namespaces, editing/deleting remote bindings, or exposing non-standard names as executable text.
- Materializing variable values while listing them, bypassing preview limits/confirmation, or previewing functions and projections.
- Capturing background metadata queries, generated variable-preview expressions, result payloads, secrets, telemetry, or Python-kernel-owned execution history.
- Changing the visual/result contract for the KX Results panel, live notebook output, or saved notebook output.
