## MODIFIED Requirements

### Requirement: Successful q execution produces verified inline output
For every supported writable notebook, a completed current q execution SHALL commit and verify its inline result using the output mechanism owned by that notebook route. A local output retry SHALL reuse the already computed result and SHALL NOT issue the q source again.

When `vscode-kdb.notebook.maxOutputRows` is a positive value, the current first-party Direct IPC output lifecycle SHALL remain unchanged: the authoritative supported MIME payload is complete and exact, and the current-session output also receives a session-bound live-result binding. When the setting is `0`, the authoritative supported MIME payload SHALL still contain every exactly representable row, column, and cell without applying the configured row limit or `maxOutputBytes` to that rich payload, but the extension SHALL NOT register, stage, bind, or retain the raw q value in the live notebook result store.

#### Scenario: qnb rich result
- **WHEN** dedicated-controller execution in `.qnb` returns a supported q value while `maxOutputRows` is positive
- **THEN** the cell receives the current complete exact supported MIME output through the native execution API, including its durable output identity and session-bound live binding, without replacing the notebook cell structurally

#### Scenario: text-focused mixed-Jupyter result
- **WHEN** **Run q Cell (KX)** is invoked from a text-focused q cell in a writable `.ipynb`, q returns a supported value, and `maxOutputRows` is positive
- **THEN** that same cell receives one verified inline complete exact supported MIME output with a session-bound live binding while its complete source, q language, metadata, sibling cells, notebook controller, and run-and-stay focus semantics survive

#### Scenario: Zero-limit qnb result
- **WHEN** dedicated-controller execution in `.qnb` returns a supported q value while `maxOutputRows` is `0`
- **THEN** the cell receives every exactly representable source row, column, and cell in one complete, untruncated supported MIME output with a durable output identity
- **AND** no raw q value or live-result record is retained for that output

#### Scenario: Zero-limit mixed-Jupyter result
- **WHEN** **Run q Cell (KX)** in a writable `.ipynb` returns a supported q value while `maxOutputRows` is `0`
- **THEN** the same current cell receives one verified complete exact supported MIME output without a live-result binding
- **AND** its complete source, q language, metadata, sibling cells, notebook controller, and requested focus/move/insert semantics survive

#### Scenario: Unlimited rich output exceeds the configured byte limit
- **WHEN** a supported Direct IPC result in zero mode serializes to more than `maxOutputBytes`
- **THEN** its authoritative supported MIME output remains complete and untruncated
- **AND** the byte limit continues to bound only static fallback text and separate helper output

#### Scenario: output edit initially rejected after issue
- **WHEN** q has already executed and VS Code initially rejects or throws while committing the still-current mixed-Jupyter cell output in either row-limit mode
- **THEN** the extension may retry only the same prepared output through a bounded focus-safe local commit, never executes q again, and succeeds only after the expected output identity is visible on the current cell
- **AND** zero mode does not stage or retain a live record merely to support the retry

#### Scenario: output cannot be committed safely
- **WHEN** the notebook is read-only or closed, the cell/source/output has become stale, a foreign output wins, or the bounded local commit cannot be verified
- **THEN** the extension does not overwrite newer state, does not re-execute q, removes any live ownership created for the unsuccessful attempt, preserves the prior cell/output and its valid pre-existing live binding where possible, and reports whether q had already been issued
- **AND** a zero-mode attempt never registers or retains its newly returned raw q value

#### Scenario: Exact portable representation is unavailable
- **WHEN** the returned q value cannot be represented exactly by portable supported MIME in either row-limit mode
- **THEN** the execution reports the existing bounded technical failure
- **AND** it does not label a lossy, stringified, or truncated substitute as a complete result

### Requirement: Existing notebook result and lifecycle contracts survive
The row-limit policy SHALL preserve the established direct-q evaluation, exact result identity, persistence, cancellation, stale-response, shortcut-override, and result-surface contracts. Setting `maxOutputRows` to `0` SHALL change only the first-party current-session live-result retention policy and the setting's accepted range; it SHALL NOT make saved output or passive renderer actions execute q.

#### Scenario: Active route and q session continuity
- **WHEN** either notebook route executes a q cell in zero or positive row-limit mode
- **THEN** it uses only the globally starred active profile's existing connection, namespace, timeout, and q session and never falls back to another saved profile

#### Scenario: Save and reopen zero-mode output
- **WHEN** a successfully executed zero-mode `.qnb` or `.ipynb` cell is saved, closed, and reopened
- **THEN** its supported complete exact supported MIME value and durable output identity remain available to the saved notebook renderer
- **AND** no transient live handle is persisted or revived

#### Scenario: Save and reopen output
- **WHEN** a successfully executed `.qnb` or `.ipynb` cell in either row-limit mode is saved, closed, and reopened
- **THEN** its supported complete exact supported MIME value and durable output identity remain available to the saved notebook renderer while transient live handles are not revived

#### Scenario: Results panel behavior is unchanged
- **WHEN** the same supported q value is displayed in KX Results or opened from valid notebook output in either row-limit mode
- **THEN** Results-panel rendering, q identity, grid/chart behavior, copy/export behavior, and chart sampling continue to follow their existing contracts

#### Scenario: Current zero-mode inline result
- **WHEN** the renderer displays a newly executed zero-mode result without a live-result binding
- **THEN** it uses the complete saved supported MIME payload for supported grid, search, selection, copy/export, chart, sizing, and status behavior
- **AND** it does not describe the result as truncated or attempt to request a missing live record

#### Scenario: Open zero-mode output in KX Results
- **WHEN** the user explicitly opens a current or reopened zero-mode output in KX Results
- **THEN** the panel receives the complete saved supported MIME value through the existing saved-result handoff
- **AND** opening the panel does not execute the cell source or retrieve a cached raw q value
- **AND** Results-panel q identity, rendering, copy/export, chart, and sampling behavior remain unchanged

#### Scenario: Explicit zero-mode rerun is fresh
- **WHEN** the user explicitly runs or reruns a zero-mode cell after an earlier result exists
- **THEN** the complete current cell source is issued to q exactly once and receives fresh output identity
- **AND** no earlier saved payload or raw live value is used as the new query result

#### Scenario: Positive-limit behavior survives
- **WHEN** `maxOutputRows` remains between `1` and `10000`
- **THEN** first-party Direct IPC output remains complete exact supported MIME with its current live-result lifecycle
- **AND** the value continues to control the optional Python-helper Tag/Prepare preview row marker

#### Scenario: Zero mode does not unbound the Python helper
- **WHEN** `maxOutputRows` is `0` and the user invokes the optional Tag/Prepare aid for a Python-owned `%%q` cell
- **THEN** the extension uses a documented positive helper-preview fallback rather than promising uncapped output from the separate Python companion
- **AND** the companion receives no extension live-result binding or first-party persistence guarantee

#### Scenario: Cancellation and stale completion
- **WHEN** execution is canceled, superseded, cleared, edited, deleted, or completes after the cell, notebook, connection, or output generation changes
- **THEN** no stale result replaces current notebook state, move/insert follow-up actions do not run, and any query already issued is not silently reissued
- **AND** zero mode adds no live-store record for the new attempt on success, failure, cancellation, or stale completion
- **AND** a prior committed output's valid live record remains available when the replacement does not commit

#### Scenario: Existing saved output remains compatible
- **WHEN** the renderer opens a previously persisted valid MIME v1 preview, MIME v2 historical preview, or complete supported MIME result created under a positive setting
- **THEN** it retains its existing saved/live classification, validation, rendering, rerun guidance, output identity, and lifecycle behavior without migration

#### Scenario: User keymap override
- **WHEN** a user or keymap extension defines a higher-priority notebook shortcut
- **THEN** VS Code's normal keybinding resolution remains authoritative and the visible appropriate run action remains available for the selected notebook route

### Requirement: Large-table format compatibility
Complete supported MIME SHALL mean full v2 output for non-table and plain-row fallback results and strict full v4 packed-column output for supported native q tables and keyed tables with authoritative typed columns at every cardinality, as specified by `pack-native-notebook-tables-consistently`. These formats SHALL preserve exact cells, attributes, structural keys, durable identity, and existing zero/positive retention and action rules. Previously valid v1/v2/v3 files SHALL remain readable.

#### Scenario: Large table in either retention mode
- **WHEN** a supported native q table with authoritative typed columns has any row/cell count in either zero or positive mode
- **THEN** full v4 packed columns preserve every value without a per-cell row tree or result truncation
- **AND** passive rendering, save/reopen, and panel handoff do not execute q
