## ADDED Requirements

### Requirement: First-party direct-q notebook execution participates in enabled Query History
When Query History capture is enabled, the extension SHALL create exactly one history entry for each `.qnb` controller or mixed-Jupyter **Run q Cell (KX)** execution that reaches the direct q IPC issue point. The entry SHALL use the complete user-authored cell source and the execution's actual stable connection identity, recorded connection name, issue time, execution kind, duration, and final succeeded, failed, or locally canceled outcome.

History recording SHALL remain observational: it SHALL NOT change execution ownership, target selection, source grouping, issue count, cancellation, output commit/retry, focus/move/insert behavior, live-result ownership, result conversion, or persisted notebook output. A history storage failure SHALL be reported without converting a successful q execution or output commit into a failure or reissuing q.

#### Scenario: qnb execution succeeds
- **WHEN** Query History is enabled and a `.qnb` controller run issues and completes successfully
- **THEN** one history entry records the complete cell source and successful outcome
- **AND** the controller still executes q exactly once and commits the same complete exact inline result

#### Scenario: Mixed-Jupyter direct-q execution fails or is canceled
- **WHEN** Query History is enabled and **Run q Cell (KX)** issues before failing or being canceled locally
- **THEN** one history entry records the failed or canceled outcome and measured issued duration
- **AND** the existing notebook error, cancellation, stale-response, and output behavior remains authoritative

#### Scenario: Execution never reaches q
- **WHEN** a notebook run is rejected, canceled, or becomes stale before its source is issued to q
- **THEN** Query History records no entry

#### Scenario: Output commit is retried after one q issue
- **WHEN** q completes once and the extension retries only the local output commit
- **THEN** Query History records exactly one execution entry
- **AND** neither recording nor the commit retry reissues q

#### Scenario: History storage fails
- **WHEN** q execution and notebook output succeed but the local history write fails
- **THEN** the successful result and notebook output remain successful and unchanged
- **AND** the extension reports the history-storage failure without executing the cell again

#### Scenario: Saved and live notebook result contracts survive
- **WHEN** notebook execution is recorded in Query History
- **THEN** current live output and reopened exact first-party saved output retain their existing q identity, durable output identity, rendering, copy/export, chart, and lifecycle behavior
- **AND** the history entry contains no result payload or transient live handle
