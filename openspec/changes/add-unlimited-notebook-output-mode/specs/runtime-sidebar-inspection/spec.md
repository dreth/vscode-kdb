## MODIFIED Requirements

### Requirement: Query History records the bounded user-issued execution set only with opt-in
Query History capture SHALL be enabled by default. When the effective `vscode-kdb.features.queryHistory` value is true, KX SHALL record each actually issued user-authored editor line, selection, or script execution and each actually issued first-party direct-q notebook cell execution. Each entry SHALL contain only the query text, stable connection identity and recorded connection name, execution kind, issue timestamp, duration, and succeeded, failed, or locally canceled outcome; entries SHALL be newest first and pruned to the configured bound.

An explicit user or workspace value of `false` SHALL disable future capture and remain authoritative across extension reloads. KX SHALL NOT record rejected-before-issue executions, result values or payloads, credentials, connection secrets, background metadata requests, table/variable preview expressions, local-data-server requests, or Python-kernel-owned `%%q` execution. Recording SHALL remain backed by local VS Code workspace extension storage rather than Settings, Settings Sync, logs, diagnostics, or telemetry.

#### Scenario: No explicit Query History preference
- **WHEN** KX activates in a scope with no explicit `vscode-kdb.features.queryHistory` value
- **THEN** Query History capture is enabled and the discoverable History view can display newly issued eligible commands

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

#### Scenario: Capture is explicitly disabled
- **WHEN** Query History capture is explicitly disabled before an execution is issued
- **THEN** no entry is written for that execution
- **AND** the visible History view explains that capture is disabled
- **AND** previously retained entries are neither exposed in the disabled view nor silently deleted

#### Scenario: Explicit opt-out survives reload
- **WHEN** a user stores `vscode-kdb.features.queryHistory` as `false` and reloads the Extension Host or VS Code
- **THEN** capture remains disabled rather than falling back to the default-enabled value

#### Scenario: Existing retained history is reopened
- **WHEN** capture is enabled in a workspace containing valid entries under the existing history storage contract
- **THEN** those entries remain readable in newest-first order and are pruned only according to the configured retention limit
