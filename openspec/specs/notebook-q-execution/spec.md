# notebook-q-execution Specification

## Purpose

Defines reliable, exactly-once q-cell execution and inline result behavior for first-party q notebooks and mixed Jupyter notebooks.

## Requirements

### Requirement: Notebook type determines the q execution owner
The extension SHALL route a q cell according to its notebook type and SHALL NOT use a mixed-notebook output path for a controller-owned q-only notebook.

#### Scenario: qnb normal run and stay
- **WHEN** a q code cell in an open `.qnb` notebook is focused and the user invokes normal Run or `Ctrl+Enter` on Windows/Linux or `Cmd+Enter` on macOS
- **THEN** the dedicated KX q controller executes the complete current cell source exactly once through the globally active direct-q profile, retains focus on that cell, and uses the controller-owned output lifecycle

#### Scenario: qnb controller is available without the Jupyter opt-in
- **WHEN** a `.qnb` notebook opens while `vscode-kdb.notebook.enableDirectController` is false
- **THEN** its dedicated KX q controller remains available and preferred for that notebook without registering or selecting the optional mixed-Jupyter KX controller

#### Scenario: mixed Jupyter run and stay
- **WHEN** a q-language code cell in a mixed `.ipynb` notebook has text focus or command-mode selection and the user invokes `Ctrl+Enter` or `Cmd+Enter`
- **THEN** **Run q Cell (KX)** executes the complete current cell source exactly once through the globally active direct-q profile, retains the selected cell, and does not change the selected Python/Jupyter controller

#### Scenario: move and insert gestures remain conditional
- **WHEN** a tracked mixed-Jupyter q cell is invoked with `Shift+Enter` or `Alt+Enter` / `Option+Enter`
- **THEN** the same q route executes once and moves to or inserts the next cell only after execution and inline output commit succeed

#### Scenario: non-q cells remain notebook-owned
- **WHEN** the focused notebook cell is Python, another non-q code language, or Markdown, or the optional KX direct controller already owns the Jupyter notebook
- **THEN** the mixed-q keybindings do not intercept the gesture and the existing notebook/controller behavior remains authoritative

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

### Requirement: Large q tables use complete exact columnar notebook output
All supported native q tables and keyed tables with authoritative typed q columns SHALL use complete MIME v4 packed-column encoding without repeating q type envelopes for every scalar cell. Each column SHALL retain its source q type, vector attribute, cardinality, and every exact scalar or nested value. The durable output ID, full persistence metadata, structural key ordinals, and provenance SHALL remain strict. Existing MIME v1/v2/v3/v4 input SHALL retain its read contracts. New native table output SHALL use v4 regardless of row/cell count; non-table output and row-table fallbacks without authoritative typed q columns SHALL retain v2. MIME v3 SHALL remain readable; MIME v4 SHALL be an explicit new version whose rich output requires the updated reader.

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
- **WHEN** a v4 payload has invalid q types/values/attributes, missing or unequal vector lengths, mismatched schema attributes or key ordinals, conflicting result bounds, unsupported fields, or an invalid durable binding
- **THEN** its output and actions are rejected with existing strict ownership/lifecycle safeguards

#### Scenario: Existing format compatibility
- **WHEN** existing v1/v2/v3 .qnb or .ipynb output is opened or a non-table result or row-table fallback without authoritative typed q columns is executed
- **THEN** existing formats remain supported and non-table and row-table fallback Direct IPC output stays v2
- **AND** scalar, standalone-list, unsupported dictionary/function, cancellation, stale-generation, and controller routing semantics are unchanged

#### Scenario: Genuine encoding resource failure remains visible
- **WHEN** a result still cannot be represented or serialized within available runtime resources
- **THEN** the error distinguishes representation or runtime encoding failure from connection/query failure without exposing result content, truncating it, or reissuing q


#### Scenario: Native table packing has no cardinality cutoff
- **WHEN** an eligible native q table or keyed table has zero, one, 60,000 or 600,000 rows, including results on either side of the former one-million-cell cutoff
- **THEN** it uses the same complete v4 column encoding and shared saved cell access
- **AND** the 60k result is not inflated by per-cell wrappers solely because it is below a format cutoff

#### Scenario: Other result shapes keep their current format
- **WHEN** q returns a standalone symbol atom, standalone list/vector, ordinary scalar, function/no-value result or row-table fallback without authoritative native q columns
- **THEN** its existing exact storage format, standalone presentation marker and display/ownership behavior remain unchanged

### Requirement: Packed nested q columns remain complete and exact
First-party large-table output SHALL reduce repeated nested-vector metadata and compress eligible exact numeric columns without reducing precision, cardinality, vector shape, types or attributes. Every original value SHALL remain available to saved grids, exports, charts and Results handoff in both retention modes. Shapes not eligible for packing SHALL use an existing exact representation. Storage encoding SHALL NOT impose a result-size cap, introduce sidecars, rerun q, or truncate rich output.

#### Scenario: Actual nested-vector result becomes smaller
- **WHEN** the existing 600,000 × 14 saved result with 2.4 million nested numeric vectors is encoded with the updated writer
- **THEN** the notebook is smaller than its 32.7 MiB compressed-JSON baseline with every source cell preserved exactly
- **AND** saving and reopening recover the same complete output and durable identity

#### Scenario: Floating values require binary fallback
- **WHEN** decimal integer scaling cannot reconstruct every original finite floating value exactly
- **THEN** the encoder preserves original floating values with a lossless binary representation rather than rounding
- **AND** null/infinity/negative-zero sentinels remain distinct and valid for their original q types

#### Scenario: Ragged and empty vectors survive
- **WHEN** a mixed column contains homogeneous typed vectors with variable lengths, empty vectors, singleton vectors or differing attributes
- **THEN** every row reconstructs its original vector type, length, attribute and exact elements
- **AND** other nested/mixed shapes retain their exact fallback representation

#### Scenario: Corrupt packed output is rejected
- **WHEN** packed output contains unknown fields, invalid base64/compression, excess or truncated decoded bytes, invalid numeric values, unsafe sizes, inconsistent row/element bounds, invalid nested attributes or a mismatched schema/durable binding
- **THEN** validation rejects the output and its actions before accepting it as complete
- **AND** repeated validation cannot reuse decoded data for a changed encoded payload

#### Scenario: Persistence and ownership surfaces remain compatible
- **WHEN** packed output is committed through native .qnb or mixed .ipynb, rendered live or from saved data, cleared, rerun or opened in Results
- **THEN** existing controller, stale-response, session/durable ownership, export and chart sampling contracts remain in force
- **AND** older v1/v2/v3 notebooks and the separate bounded Python-helper contract remain supported
