## Why

KX Variables currently inspects only the active profile's configured namespace and deliberately omits tables and callable bindings, so it cannot show application objects loaded elsewhere in the same q process. Users need a process-wide, namespace-aware snapshot that includes definitions actually present when q is inspected, including bindings loaded by startup scripts or other clients such as `.demo.calculate` when it exists, while keeping KX-reserved runtime internals such as `.Q` out of the tracker.

## What Changes

- Change KX Variables from a flat configured-namespace data-variable list into a hierarchical snapshot of the active q process: root bindings from ``key `.`` plus recursively discoverable application namespace bindings rooted in ``key ` ``.
- Exclude every one-character top-level namespace because q reserves that namespace class for KX, rather than maintaining a version-sensitive list limited to currently observed `.Q`, `.q`, `.z`, `.h`, `.j`, `.m`, `.o`, or `.s` roots. Include multi-character application namespaces such as `.qr` only when q reports them, including bindings created before the extension connected or by another q client.
- Show every safely named binding currently reported under included contexts with a conservative kind label, including data values, tables, functions, projections, and unknown types. Never synthesize or require example names; treat real namespace dictionaries as hierarchy while keeping ordinary dictionary-valued variables as leaves.
- Keep refresh metadata-only and explicit. Discover names and type/classification metadata without fetching values, polling, instrumenting user queries, or claiming provenance for an application binding.
- Keep the hover/focus **Open in KX Results** action only for safely materializable data and table bindings. Revalidate the exact fully qualified path and runtime snapshot, apply the existing bounded preview warning, and never invoke or materialize a function/projection merely because it is tracked.
- Preserve Connections, Query History, Server Explorer, connected language intelligence, KX Results rendering, and live/saved notebook-output contracts outside this Variables-view scope.
- Add regression coverage and documentation for root and nested namespaces, reserved-root exclusion, an application callable being present, absent, or removed, ordinary dictionaries, stale snapshots, qualified preview safety, explicit refresh, and unaffected consumers of configured-namespace metadata.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-sidebar-inspection`: Replaces the configured-namespace-only, data-variable-only Variables snapshot with a process-wide hierarchical application-binding snapshot while preserving explicit refresh, metadata-only discovery, stale-state rejection, and safe Results handoff. This delta builds on the active `add-runtime-sidebar-views` change and must be reconciled with it before either change is archived.

## Impact

- Affected extension-host code: `src/variables.ts`, safe q metadata/query builders and parsers in `src/server-explorer-model.ts`, and a dedicated process-workspace metadata path in or beside `src/q-metadata-service.ts`.
- Affected q traffic: explicit Variables refresh and namespace expansion issue bounded metadata-only queries through the existing active direct-q session; no persistent server object or additional IPC connection is introduced.
- Affected UI: KX Variables gains root/namespace branches, binding-kind presentation, partial/error states, and qualified binding actions. Existing view identity and native VS Code view reordering remain unchanged.
- Affected tests and documentation: deterministic provider/parser/query-safety tests, live-q namespace fixtures, manifest/Results regressions, `mkdocs-src/connections.md`, `mkdocs-src/settings.md`, generated docs, and `CHANGELOG.md`.
- Persisted contracts: none. Connection profiles, history storage, result payloads, notebook MIME, and settings retain their existing formats.
- Dependencies: no new runtime dependency is expected. This follow-on depends on the active `add-runtime-sidebar-views` Variables contract being completed or reconciled first.

## Non-goals

- Continuous polling, automatic refresh after user queries, watch expressions, mutation controls, runtime debugging, or recording how or by whom a binding was created.
- Displaying KX-reserved one-character top-level namespace contents or attempting to maintain a brittle per-version builtin-object allow/deny list.
- Traversing arbitrary dictionary values as namespaces, evaluating property-like tree labels, or invoking tracked functions/projections.
- Broadening Server Explorer or connected language-intelligence discovery beyond their configured namespace, or changing KX Results and notebook result presentation.
