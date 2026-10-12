## MODIFIED Requirements

### Requirement: Variables reflect one current runtime snapshot
KX Variables SHALL represent safely named application bindings across the globally active direct-q profile's current q process only after explicit refresh or explicit expansion of a namespace discovered by that refresh. The root branch SHALL contain unqualified bindings reported by ``key `.``. Namespace branches SHALL start from the namespaces reported by ``key ` ``, SHALL support nested namespace contexts, and SHALL use the active profile's existing q connection/session.

The tracker SHALL exclude every one-character top-level namespace and its descendants because q reserves that namespace class for KX. This exclusion SHALL cover known and version-dependent system roots including `.Q`, `.q`, `.z`, `.h`, `.j`, `.m`, `.o`, and `.s` without depending on that example list. The tracker SHALL include safely named multi-character top-level namespaces such as `.qr`, every nested namespace below an included application root even when a nested segment is one character, and safely named root bindings even when their unqualified name is one character.

Refresh and namespace expansion SHALL retrieve only names, q type/classification metadata, and the information required to distinguish a namespace context from an ordinary dictionary value. The tracker SHALL show data values, tables, functions, projections, and conservatively classified unknown bindings with their fully qualified names and binding kinds; a real nested namespace SHALL be a branch, while an ordinary dictionary-valued binding SHALL remain a leaf. The tracker SHALL include bindings already present when KX connects and bindings created out of band, SHALL NOT claim whether KX, a startup script, or another client created them, and SHALL omit unsafe names with an explicit omitted count rather than interpolating them into executable q text.

For each successful root or context request, KX Variables SHALL display only the namespaces and bindings currently returned by that q process. It SHALL NOT synthesize, predeclare, or require `.demo`, `.demo.calculate`, or any other example namespace or binding. A named example in this specification is conditional on that binding existing in the inspected runtime at the time of the relevant metadata request.

Results SHALL be sorted deterministically within each context and published atomically for each request. Existing response byte/item limits and local timeout/cancellation containment SHALL remain in force; a malformed, unsafe, oversized, or failed context response SHALL produce an explicit retryable or omitted state rather than silently presenting it as complete. The view SHALL show explicit states for no active profile, disconnected profile, never refreshed, loading, empty process/application context, locally canceled wait, permission/query failure, and metadata invalidated by route or generation change. It SHALL NOT poll, automatically issue metadata after each user query, install persistent q code, or open a second IPC connection.

#### Scenario: Root and application namespaces are discovered
- **WHEN** the active q process contains root binding `rootValue`, application bindings `.demo.calculate` and `.demo.data`, and nested binding `.app.state.value`, and the user refreshes and expands their namespace branches
- **THEN** KX Variables shows `rootValue` under the root context, `.demo.calculate` and `.demo.data` under `.demo`, and `.app.state.value` under nested `.app.state`
- **AND** each leaf shows a conservative data, table, function, projection, or unknown kind without fetching its value

#### Scenario: KX-reserved roots are excluded structurally
- **WHEN** ``key ` `` reports one-character top-level namespaces such as `.Q`, `.q`, `.z`, `.h`, `.j`, `.m`, `.o`, or `.s` together with multi-character namespace `.qr`
- **THEN** KX Variables excludes every one-character top-level namespace and all of its descendants
- **AND** includes `.qr` without relying on a hard-coded list of observed system namespace names

#### Scenario: Application nesting does not over-apply the reserved-root rule
- **WHEN** an included multi-character application namespace contains nested namespace `.application.q` or the root context contains a one-character binding
- **THEN** KX Variables includes that nested namespace or root binding when its path is otherwise safe
- **AND** applies the one-character exclusion only to top-level namespace roots

#### Scenario: Script and out-of-band definitions are visible
- **WHEN** `.demo.calculate` was loaded by a startup script before KX connected or was created by another client before the user refreshes
- **THEN** KX Variables includes `.demo.calculate` according to the runtime metadata currently returned by q
- **AND** does not require the extension to have observed the defining command

#### Scenario: Absent or removed bindings are not invented
- **WHEN** `.demo.calculate` does not exist in the inspected q process, or it was removed before a successful refresh or `.demo` expansion
- **THEN** KX Variables does not display `.demo.calculate`
- **AND** does not create `.demo` unless that namespace itself is currently returned by q

#### Scenario: Ordinary dictionary remains a value leaf
- **WHEN** an included namespace contains ordinary dictionary-valued binding `.app.payload` and actual nested namespace `.app.state`
- **THEN** `.app.payload` is displayed as a dictionary data binding and is not traversed as a namespace
- **AND** `.app.state` is displayed as an expandable namespace branch

#### Scenario: No usable active runtime
- **WHEN** there is no active profile or the active profile is disconnected
- **THEN** KX Variables shows an actionable inactive or reconnect status
- **AND** it does not fall through to another saved or connected profile
- **AND** it does not retain a prior runtime's binding rows as though they were current

#### Scenario: Runtime identity changes
- **WHEN** the active connection, configured namespace, connected client/session, or refresh generation changes after namespace metadata was requested or displayed
- **THEN** prior branches, rows, cached child metadata, and late responses are invalidated
- **AND** the view requires a current refresh before any binding can be opened

#### Scenario: Refresh or expansion is canceled, fails, or exceeds bounds
- **WHEN** a metadata wait is canceled locally or q returns a permission, timeout, transport, shape, item-limit, or byte-limit error
- **THEN** the affected request shows a retryable or explicitly incomplete status that distinguishes local cancellation from failure
- **AND** it does not display late or stale bindings as current
- **AND** it does not claim that already-issued q work was canceled on the server

#### Scenario: Tracker remains explicitly driven
- **WHEN** the extension activates, the Variables view becomes visible, or a user-issued q query completes without a Variables refresh or namespace expansion
- **THEN** KX Variables sends no process-workspace metadata request
- **AND** it does not install hooks or persistent objects in the q process

#### Scenario: Configured-namespace metadata consumers remain scoped
- **WHEN** Server Explorer or connected q language intelligence requests its existing root metadata
- **THEN** that consumer remains scoped to the active profile's configured namespace with its existing bounds, cache, privacy, and feature gates
- **AND** process-wide Variables metadata is not exposed to that consumer

### Requirement: A current variable can open safely in KX Results
Each current safely materializable data or table binding row in KX Variables SHALL expose a small inline action when the row is hovered or focused. Function, projection, unknown, and namespace rows SHALL remain visible as metadata but SHALL NOT expose an action that invokes or materializes them. Invoking an eligible action SHALL revalidate the provider-owned row, its exact fully qualified symbol path, its current binding kind, and the active connection/session/configured-namespace/generation snapshot; show the existing bounded-materialization warning and require confirmation; then evaluate only that validated binding and display the returned q value through the normal KX Results panel pipeline.

The preview SHALL apply the configured server-side outer-item/cell bound, SHALL validate every qualified path segment as a standard q identifier, SHALL use an absolute binding reference rather than execute tree-label text in the configured namespace, and SHALL NOT synthesize arbitrary q from returned names. A stale, removed, retyped, disconnected, differently routed, or no-longer-materializable row SHALL fail closed and direct the user to refresh rather than opening a result from another binding or runtime. Metadata and preview requests SHALL remain excluded from Query History.

#### Scenario: Open a current qualified data binding
- **WHEN** the user invokes the inline action for current data binding `.demo.data`, confirms the bounded preview, and the active runtime snapshot and binding kind remain unchanged
- **THEN** KX evaluates only the validated absolute `.demo.data` binding against the same connection/session
- **AND** opens the returned value in a KX Results panel with the existing result conversion, display, copy, export, and chart behavior

#### Scenario: Open a current table binding
- **WHEN** the user confirms the inline action for a current table binding in an included application namespace
- **THEN** KX applies the existing server-side table cell/outer-item preview bound before returning data
- **AND** opens the bounded table through the normal KX Results panel pipeline

#### Scenario: Callable binding is tracked but never invoked
- **WHEN** an existing `.demo.calculate` binding is classified as a function or projection
- **THEN** KX Variables displays `.demo.calculate` and its callable kind
- **AND** exposes no Results action that executes, invokes, or materializes the callable

#### Scenario: User declines materialization
- **WHEN** the user invokes an eligible binding's inline action but declines the bounded-materialization confirmation
- **THEN** KX sends no preview query and opens no Results panel for that binding

#### Scenario: Binding row becomes stale or changes kind
- **WHEN** the selected binding was removed or retyped, or its connection, configured namespace, connected session, or refresh generation changed before preview starts
- **THEN** KX sends no materialization query for the stale row
- **AND** tells the user to reconnect or refresh the Variables view

#### Scenario: Unsafe qualified path fails closed
- **WHEN** a returned context or binding name cannot be represented as a validated qualified q identifier
- **THEN** KX does not construct or execute a preview expression from that name
- **AND** reports the omission in the relevant context

#### Scenario: Other result surfaces remain unchanged
- **WHEN** a binding preview opens in KX Results
- **THEN** it does not create or mutate live notebook output or saved notebook output
- **AND** KX Results rendering, q identity, grid/list/dictionary behavior, copy/export, charting, and chart sampling retain their existing contracts
