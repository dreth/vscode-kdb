## Context

See `proposal.md` for motivation and the delta specs for observable behavior. The extension already contributes one KX activity-bar container with Connections, a feature-gated Server Explorer, and a feature-gated Query History. Server Explorer already owns safe runtime-name discovery, q type classification, identifier validation, bounded table/variable preview construction, and stale-generation checks. Query History already owns a versioned workspace `Memento` record, bounded normalization, generation-invalidated capture, and tree actions, but its entire view/provider lifecycle currently follows the capture feature flag and its entry kind accepts only editor line/selection/script runs.

First-party `.qnb` and mixed-Jupyter direct-q cells share `KxQNotebookRunner` and a `DirectQNotebookBridge`. The bridge exposes the exact issue callback and already carries the selected connection and complete cell source, making it the narrow common boundary for observational history recording. Notebook result conversion, live binding, output commit/retry, and persisted MIME happen downstream and must stay independent.

The repository has no current main capability spec for the older Server Explorer/History behavior, so the new `runtime-sidebar-inspection` capability records both the requested additions and the existing invariants most exposed by the refactor. Current q-result specs remain authoritative; this change only feeds a returned value into the existing KX Results panel.

## Goals / Non-Goals

**Goals:**

- Keep one runtime-metadata and preview-safety policy while presenting variables in a focused always-available tree.
- Separate History view discoverability from the privacy-sensitive capture switch while defaulting capture on and preserving explicit opt-out.
- Observe direct-q notebook issue/outcome once at the common execution boundary without coupling history storage to notebook output success.
- Preserve old history entries and every existing Connections, Server Explorer, Results, and notebook lifecycle boundary.

**Non-Goals:**

- A general namespace/object browser, runtime debugger, watch expressions, remote mutation controls, or automatic metadata refresh.
- A new Results representation or a notebook-output handoff for variables.
- Capturing execution owned by a Python/Jupyter kernel or any extension-generated q request.

## Decisions

### 1. Contribute focused sibling TreeViews, not a new webview or activity container

`package.json` will add an unconditional `vscode-kdb.variables` view and remove the Query History view's visibility condition while keeping all three under the existing `vscode-kdb` container. Query History capture actions remain guarded by `config.vscode-kdb.features.queryHistory`; its provider renders a disabled status node when that setting is false. Connections and the separately gated Server Explorer keep their identifiers and placement.

This uses native VS Code view title and inline item menus, so the variable action naturally appears on hover/focus and remains keyboard accessible. A custom tabbed webview was rejected because it would duplicate tree accessibility, theming, contribution, and lifecycle behavior and would turn three independent native views into one browser-owned surface.

### 2. Reuse the metadata/preview policy while giving Variables independent UI state

The existing `QMetadataService` root snapshot (with the current direct-query fallback retained for focused tests) and the pure helpers in `server-explorer-model.ts` remain the source of truth for table exclusion, variable/function classification, identifier safety, and bounded preview query construction. Shared status/cancellation and preview-running helpers will be extracted only where doing so prevents policy drift; table-column caching stays owned by Server Explorer.

`VariablesTreeProvider` will own its own view generation and displayed snapshot `{connectionId, namespace}`. Explicit Variables refresh asks the shared metadata source for a fresh root, filters to `kind === 'variable'`, and publishes rows atomically. Connection-tree events invalidate displayed rows on active ID, namespace, or connected-state changes. Every async completion and item command checks both the provider generation and current active snapshot. This independent presentation state prevents enabling or refreshing Variables from implicitly expanding, revealing, or changing Server Explorer state while still sharing the underlying rules.

Alternatives considered:

- Moving variables out of Server Explorer would make existing users lose a documented category, so it is rejected.
- Making Variables a shallow alias over Server Explorer tree items would couple feature-gated provider lifetime and stale-item ownership, so separate owned tree items are safer.
- Automatic refresh after every q run would add hidden metadata traffic and still miss mutations made by other clients, so refresh remains explicit.

### 3. Use a dedicated variable command backed by the existing Results runner

A dedicated `vscode-kdb.openVariableInResults` item command will resolve only a currently owned Variables row. After the same modal size warning used by Server Explorer, it will re-resolve the row and active snapshot, build the existing bounded variable preview expression, and invoke the already injected preview runner with the expected connection ID. That runner continues through `executeQText` with strict namespace and no history kind, then uses `qValueToColumnarPanel` and `KxResultsPanel` exactly as today.

Reusing `vscode-kdb.previewServerObject` directly was rejected because that command intentionally resolves `ServerObjectTreeItem` instances owned by a different provider; weakening its ownership check would make stale or forged cross-view items easier to accept. The q builder, warning, configured `vscode-kdb.serverExplorer.previewCellLimit`, and runner remain shared for compatibility.

### 4. Keep the History feature instance alive and gate capture/data exposure separately

`FeatureControls` will create one Query History view/provider for the extension lifetime. It will track the feature setting as an enabled state rather than constructing/disposal-cycling the feature. A setting transition invalidates pending captures, refreshes the tree, and toggles whether `capture()` can return a token. While disabled, root children return only a recording-disabled status and do not enumerate retained entries; history commands stay disabled by their existing manifest enablement clauses. Re-enabling shows the same normalized entries from the unchanged `vscode-kdb.queryHistory.v1` workspace key and applies the current retention bound.

Keeping the existing storage key and adding one accepted execution kind makes old entries forward-compatible without rewriting them. Deleting retained entries on disable or changing to Settings storage were rejected because both violate the existing privacy/persistence contract.

### 5. Record notebook history at the DirectQNotebookBridge execution boundary

The bridge factory will receive a small history adapter supplied by `FeatureControls`. Its `executeScript` wrapper will:

1. capture an enabled-history generation before awaiting the underlying execution;
2. note the issue timestamp only from the existing `onIssued` callback;
3. forward the caller's callback unchanged;
4. after completion, error, or abort, record only if issue occurred, classifying an aborted post-issue signal as `canceled`, another error as `failed`, and a return as `succeeded`; and
5. let the existing `FeatureControls.recordHistory` containment report storage errors without replacing the execution return/error.

The history model will add a `notebook` execution kind and map it to script transport for rerun. Both `.qnb` native execution and mixed-Jupyter **Run q Cell (KX)** already use this bridge, while Python `%%q`, metadata, previews, and connected-language requests do not. Therefore one wrapper covers the intended sources without renderer hooks or duplicate recording in each output path.

Recording ends at q execution rather than output commit. This is deliberate: a local output retry is not another command, and a q success remains a successful history outcome even if later notebook output persistence fails. The existing notebook issue/stale checks remain authoritative and prevent pre-issue entries.

### 6. Test at model, provider, manifest, execution, and live-q boundaries

Pure tests will cover metadata filtering, history-kind normalization/backward compatibility, disabled provider state, ordering/retention, and command resolution. VS Code harness tests will cover view contributions, hover-action menu clauses, feature toggles, generation invalidation, confirmation, and Results runner arguments. Notebook controller/integration tests will cover one record per issued q run across success/failure/cancel and none before issue or during output retry. Live-q coverage will verify that refresh does not fetch values and bounded variable expressions still restore namespace and reject functions.

No renderer or Python companion code is expected to change. Existing result, notebook, manifest privacy, repository audit, and full `npm test` gates remain required.

## Risks / Trade-offs

- [Variables duplicates names also visible in enabled Server Explorer] → Keep the focused view intentionally shallow and share metadata/preview rules; document Server Explorer as the richer tables/functions surface.
- [An explicitly refreshed snapshot becomes obsolete due to changes made inside q without a connection event] → Label behavior as snapshot/manual refresh, fail closed when the selected binding is removed or retyped at preview time, and never claim live polling.
- [A scalar or nested value can still be large despite outer-item limits] → Preserve the modal warning and existing function/projection rejection before every materialization.
- [Default-on History can surprise users who do not want local query-text retention] → Document local workspace storage prominently, preserve an explicit `false` opt-out, render a prominent disabled state, and perform no storage read for display or write while disabled.
- [History writes add latency near notebook completion] → Keep entries bounded and local, contain write errors, and do not make output/result state depend on the write. If profiling shows user-visible latency, the adapter can enqueue the contained write without altering the issue/outcome contract.
- [Feature-setting changes race with an in-flight execution] → Reuse generation invalidation so a capture started under a now-disabled instance cannot commit later.
- [Refactoring shared explorer helpers regresses the existing feature] → Preserve provider ownership boundaries and add explicit regression tests for tables, functions, columns, feature gating, and stale/error behavior.

## Migration Plan

1. Ship the new Variables view and unconditional History view contribution without changing connection or result data formats.
2. Change `vscode-kdb.features.queryHistory` to default to `true`; an existing explicit `false` remains disabled, and existing `vscode-kdb.queryHistory.v1` data remains unchanged.
3. Extend history normalization to accept `notebook` while continuing to accept every valid old `line`, `selection`, and `script` entry. No eager rewrite is required.
4. Keep the Server Explorer feature setting, view ID, commands, preview-limit setting, and behavior in place.
5. Rollback can remove the new Variables contribution and notebook adapter while old history readers safely ignore any newly stored `notebook` entries they do not recognize; no connection, result, or notebook payload migration is involved.
