## MODIFIED Requirements

### Requirement: Successful q execution produces verified inline output
For every supported writable notebook, a completed current q execution SHALL commit and verify its inline result using the output mechanism owned by that notebook route. A local output retry SHALL reuse the already computed result and SHALL NOT issue the q source again.

#### Scenario: qnb rich result
- **WHEN** dedicated-controller execution in `.qnb` returns a supported q value
- **THEN** the cell receives the current complete exact supported MIME output through the native execution API, including its durable output identity and a live binding only in positive retention mode, without replacing the notebook cell structurally

#### Scenario: text-focused mixed-Jupyter result
- **WHEN** **Run q Cell (KX)** is invoked from a text-focused q cell in a writable `.ipynb` and q returns a supported value
- **THEN** that same cell receives one verified inline complete exact supported MIME output while its complete source, q language, metadata, sibling cells, notebook controller, and run-and-stay focus semantics survive

#### Scenario: output edit initially rejected after issue
- **WHEN** q has already executed and VS Code initially rejects or throws while committing the still-current mixed-Jupyter cell output
- **THEN** the extension may retry only the same prepared output through a bounded focus-safe local commit, never executes q again, and succeeds only after the expected output identity is visible on the current cell

#### Scenario: output cannot be committed safely
- **WHEN** the notebook is read-only or closed, the cell/source/output has become stale, a foreign output wins, or the bounded local commit cannot be verified
- **THEN** the extension does not overwrite newer state, does not re-execute q, removes uncommitted live ownership, preserves the prior cell/output where possible, and reports whether q had already been issued

### Requirement: Existing notebook result and lifecycle contracts survive
The routing repair SHALL preserve the established direct-q evaluation, exact result, persistence, cancellation, stale-response, and shortcut-override contracts on every affected surface.

#### Scenario: Active route and q session continuity
- **WHEN** either notebook route executes a q cell
- **THEN** it uses only the globally starred active profile's existing connection, namespace, timeout, and q session and never falls back to another saved profile

#### Scenario: Save and reopen output
- **WHEN** a successfully executed `.qnb` or `.ipynb` cell is saved, closed, and reopened
- **THEN** its complete exact supported MIME value and durable output identity remain available to the saved notebook renderer while transient live handles are not revived

#### Scenario: Cancellation and stale completion
- **WHEN** execution is canceled, superseded, cleared, edited, deleted, or completes after the cell, notebook, connection, or output generation changes
- **THEN** no stale result replaces current notebook state, move/insert follow-up actions do not run, and any query already issued is not silently reissued

#### Scenario: Results panel behavior is unchanged
- **WHEN** the same supported q value is displayed in KX Results or opened from a valid notebook output
- **THEN** Results-panel rendering, q identity, grid/chart behavior, copy/export behavior, and chart sampling continue to follow their existing contracts

#### Scenario: User keymap override
- **WHEN** a user or keymap extension defines a higher-priority notebook shortcut
- **THEN** VS Code's normal keybinding resolution remains authoritative and the visible appropriate run action remains available for the selected notebook route

## ADDED Requirements

### Requirement: Large q tables use complete exact columnar notebook output
Supported q tables and keyed tables above one million cells SHALL use complete MIME v3 column-vector encoding without repeating q type envelopes for every scalar cell. Each column SHALL retain its source q type, vector attribute, cardinality, and every exact scalar or nested value. The durable output ID, full persistence metadata, structural key ordinals, and provenance SHALL remain strict. Older MIME v1/v2 input and ordinary-size v2 output SHALL retain their existing contracts. MIME v3 SHALL be an explicit new version; old readers are not promised rich v3 support.

#### Scenario: 600000 row table executes
- **WHEN** a supported 600,000-row, 14-column q table returns through either Direct IPC notebook route in positive or zero row-limit mode
- **THEN** complete output is emitted and validates without allocating a typed cell object tree or string proportional to repeated per-cell q metadata
- **AND** every source value survives rather than being truncated to a configured row/byte preview

#### Scenario: Exact special and nested q values survive
- **WHEN** columns include exact 64-bit longs, temporal values, null/infinity/negative-zero specials, symbols, bytes/chars, or mixed nested vectors
- **THEN** every supported q identity, source column attribute, and keyed-table ordinal survives the columnar encoding and save/reopen

#### Scenario: All result surfaces use the same cells
- **WHEN** columnar output is viewed live or reopened in .qnb/.ipynb, scrolled, searched, sorted, selected, copied/exported, sized, charted, or opened in KX Results
- **THEN** existing grid and q presentation, copy/export, chart source/sampling, and action/ownership rules derive from the exact same source cells without eagerly expanding the full table
- **AND** passive actions never execute q; zero mode retains no live raw value and positive mode preserves its current live lifecycle

#### Scenario: Malformed columnar output fails closed
- **WHEN** a v3 payload has invalid q types/values/attributes, missing or unequal vector lengths, mismatched schema attributes or key ordinals, conflicting result bounds, unsupported fields, or an invalid durable binding
- **THEN** its output and actions are rejected with existing strict ownership/lifecycle safeguards

#### Scenario: Existing format compatibility
- **WHEN** existing v1/v2 .qnb or .ipynb output is opened or an ordinary-size result is executed
- **THEN** existing formats remain supported and ordinary-size Direct IPC output stays v2
- **AND** scalar, standalone-list, unsupported dictionary/function, cancellation, stale-generation, and controller routing semantics are unchanged

#### Scenario: Genuine encoding resource failure remains visible
- **WHEN** a result still cannot be represented or serialized within available runtime resources
- **THEN** the error distinguishes representation or runtime encoding failure from connection/query failure without exposing result content, truncating it, or reissuing q
