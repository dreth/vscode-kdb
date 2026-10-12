## Purpose

Defines discoverable KX sidebar views for inspecting active-runtime variables and privacy-aware query history without weakening connection, execution, or result-safety boundaries.

## ADDED Requirements

### Requirement: Runtime inspection views are discoverable beside Connections
The KX activity-bar container SHALL contribute separate **KX Variables** and **KX Query History** views beside the existing **KX Connections** view. The Connections view SHALL retain its current profile state, activation, connection lifecycle, and management actions, and the existing feature-gated KX Server Explorer SHALL retain its table, column, variable/function metadata, and preview behavior.

Query History SHALL remain visible when capture is disabled and SHALL explain that recording is off rather than appearing missing or silently enabling storage. KX Variables SHALL be available without enabling the broader Server Explorer and SHALL NOT query q merely because the extension or view activates.

#### Scenario: KX sidebar opens with optional features disabled
- **WHEN** the KX activity-bar container opens while Query History capture and Server Explorer are disabled
- **THEN** Connections, Variables, and Query History are discoverable as separate views
- **AND** Query History states that recording is disabled
- **AND** Server Explorer remains hidden according to its existing feature gate
- **AND** no runtime metadata or query text is fetched or stored merely because the sidebar opened

#### Scenario: Existing Connections behavior survives
- **WHEN** a user adds, edits, activates, connects, disconnects, tests, or removes a connection from KX Connections
- **THEN** the existing connection persistence, active-route, SecretStorage, optimistic-state, and client-lifecycle contracts remain unchanged

#### Scenario: Existing Server Explorer behavior survives
- **WHEN** the Server Explorer feature is enabled and used
- **THEN** its current tables, on-demand column metadata, Variables & Functions category, bounded previews, manual refresh, and status behavior remain available independently of KX Variables

### Requirement: Variables reflect one current runtime snapshot
KX Variables SHALL list data-variable bindings from the globally active direct-q profile's configured namespace only after explicit refresh. Refresh SHALL use that profile's existing q connection/session, retrieve names and safe type metadata without retrieving values, omit tables and safely recognized functions/projections, validate executable names as standard q identifiers, sort accepted variables deterministically, and report how many unsafe names were omitted.

The view SHALL show explicit states for no active profile, disconnected profile, never refreshed, loading, empty result, locally canceled wait, permission/query failure, and metadata invalidated by connection or namespace change. It SHALL NOT poll or automatically issue a metadata request after each user query.

#### Scenario: Connected manual refresh
- **WHEN** the user refreshes KX Variables with an active connected profile in namespace `.analytics`
- **THEN** the view lists the current safe data-variable names in `.analytics` using name/type metadata only
- **AND** table names and safely recognized function/projection bindings are not presented as data variables
- **AND** no listed variable value is materialized by the refresh

#### Scenario: No usable active runtime
- **WHEN** there is no active profile or the active profile is disconnected
- **THEN** KX Variables shows an actionable inactive or reconnect status
- **AND** it does not fall through to another saved or connected profile
- **AND** it does not retain a prior runtime's variable rows as though they were current

#### Scenario: Runtime identity changes
- **WHEN** the active connection, configured namespace, connection state, or refresh generation changes after variable metadata was requested or displayed
- **THEN** the previous rows and late responses are invalidated
- **AND** the view requires a current refresh before any row can be opened

#### Scenario: Refresh is canceled or fails
- **WHEN** a variable metadata wait is canceled locally or q returns a permission, timeout, transport, or shape error
- **THEN** the view shows a retryable status that distinguishes local cancellation from failure
- **AND** it does not display partial or stale variables
- **AND** it does not claim that already-issued q work was canceled on the server

### Requirement: A current variable can open safely in KX Results
Each current KX Variables row SHALL expose a small inline action when the row is hovered or focused. Invoking it SHALL revalidate the owned row and active connection/session/namespace snapshot, show the existing bounded-materialization warning and require confirmation, then evaluate only the validated binding through the configured namespace and display the returned q value through the normal KX Results panel pipeline.

The preview SHALL apply the configured server-side outer-item/cell bound, SHALL reject non-standard identifiers and function/projection values, and SHALL NOT synthesize or execute arbitrary tree-label text. A stale, removed, retyped, disconnected, or differently routed row SHALL fail closed and direct the user to refresh rather than opening a result from another runtime.

#### Scenario: Open a current data variable
- **WHEN** the user invokes the inline action for a current safe variable, confirms the bounded preview, and the active runtime snapshot is unchanged
- **THEN** KX evaluates that variable against the same connection/session/namespace
- **AND** opens the returned value in a KX Results panel with the existing result conversion, display, copy, export, and chart behavior

#### Scenario: User declines materialization
- **WHEN** the user invokes a variable's inline action but declines the bounded-materialization confirmation
- **THEN** KX sends no preview query and opens no Results panel for that variable

#### Scenario: Variable row becomes stale
- **WHEN** the selected variable was removed or retyped, or its connection, namespace, connection state, or refresh generation changed before preview starts
- **THEN** KX sends no preview query for the stale row
- **AND** tells the user to reconnect or refresh the Variables view

#### Scenario: Other result surfaces remain unchanged
- **WHEN** a variable preview opens in KX Results
- **THEN** it does not create or mutate live notebook output or saved notebook output
- **AND** KX Results rendering, q identity, grid/list/dictionary behavior, copy/export, charting, and chart sampling retain their existing contracts

### Requirement: Query History records the bounded user-issued execution set by default with explicit opt-out
Query History capture SHALL default to enabled. When enabled, KX SHALL record each actually issued user-authored editor line, selection, or script execution and each actually issued first-party direct-q notebook cell execution. Each entry SHALL contain only the query text, stable connection identity and recorded connection name, execution kind, issue timestamp, duration, and succeeded, failed, or locally canceled outcome; entries SHALL be newest first and pruned to the configured bound. An explicit `false` setting SHALL remain disabled across activation and configuration reconciliation.

KX SHALL NOT record rejected-before-issue executions, result values or payloads, credentials, connection secrets, background metadata requests, table/variable preview expressions, local-data-server requests, or Python-kernel-owned `%%q` execution. Recording SHALL remain backed by local VS Code workspace extension storage rather than Settings, Settings Sync, logs, diagnostics, or telemetry.

#### Scenario: Editor execution is issued
- **WHEN** enabled Query History observes a q editor line, selection, or script that is actually issued
- **THEN** it stores one bounded entry with the user-authored text, route identity, kind, timing, and final outcome
- **AND** does not store the result payload

#### Scenario: Direct-q notebook execution is issued
- **WHEN** enabled Query History observes a `.qnb` controller execution or **Run q Cell (KX)** execution that is actually issued
- **THEN** it stores one entry for the complete user-authored cell source and the final succeeded, failed, or locally canceled outcome
- **AND** output commit retries or renderer activity do not create additional entries

#### Scenario: Internal and Python-owned requests are excluded
- **WHEN** KX performs metadata refresh, table-column lookup, variable/table preview, connected-language lookup, or a Python kernel executes `%%q`
- **THEN** Query History stores no entry for that request

#### Scenario: Capture is disabled
- **WHEN** Query History capture is disabled before an execution is issued
- **THEN** no entry is written for that execution
- **AND** the visible History view explains that capture is disabled
- **AND** previously retained entries are neither exposed in the disabled view nor silently deleted

#### Scenario: No Query History preference has been configured
- **WHEN** KX activates without an explicit `vscode-kdb.features.queryHistory` value
- **THEN** Query History capture is enabled
- **AND** KX does not write a preference merely to apply that default

#### Scenario: Existing retained history is reopened
- **WHEN** capture is re-enabled in a workspace containing valid entries under the existing history storage contract
- **THEN** those entries remain readable in newest-first order and are pruned only according to the configured retention limit

### Requirement: Existing Query History controls and rerun safety survive
When capture is enabled, Query History SHALL preserve its current empty state, connection labeling, status icons, tooltips, newest-first order, same-pipeline rerun, copy, editor insertion, single-entry deletion, confirmed clearing, and retention-limit behavior. Rerun SHALL continue to require the globally active profile and SHALL require confirmation when its stable connection identity differs from the recorded target; changing the target while confirmation is open SHALL reject the rerun.

#### Scenario: Rerun against the same active target
- **WHEN** the recorded stable connection identity still matches the active target and the user reruns a history entry
- **THEN** KX issues the recorded user query through the normal Results-panel execution pipeline
- **AND** the rerun is itself recorded once when capture remains enabled

#### Scenario: Rerun target differs
- **WHEN** the active connection's stable identity differs from the recorded entry
- **THEN** KX identifies the mismatch and requires explicit confirmation before issuing the text on the active target
- **AND** a further target change invalidates that confirmation

#### Scenario: Clear retained history
- **WHEN** the user confirms Clear Query History while capture is enabled
- **THEN** all locally retained entries are removed and the view shows its current empty state
- **AND** canceling the confirmation removes nothing
