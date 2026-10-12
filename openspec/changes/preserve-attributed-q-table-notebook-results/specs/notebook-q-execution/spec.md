## ADDED Requirements

### Requirement: Attributed q table columns persist exactly in first-party notebook output
The extension SHALL accept supported q table and keyed-table results whose column vectors carry q attributes 1 through 4. For both `.qnb` and mixed `.ipynb` Direct IPC routes, complete supported MIME output SHALL preserve each attributed column's source ordinal, q type, attribute, and exact row values, including when the table has zero rows. A keyed table SHALL also preserve its structural key-column ordinals independently of the attributes. The saved supported MIME payload SHALL remain the authoritative complete result in both positive and zero `maxOutputRows` modes.

#### Scenario: Attributed keyed result in qnb
- **WHEN** a `.qnb` q cell returns a keyed table whose `sym` key column is a sorted symbol vector
- **THEN** the query succeeds and the current inline grid displays all returned columns and rows with the existing key-column cue
- **AND** complete supported MIME output retains the `sym` column's sorted attribute and key ordinal

#### Scenario: Attributed ordinary table in mixed Jupyter
- **WHEN** **Run q Cell (KX)** in a writable mixed `.ipynb` returns an ordinary table with one or more attributed columns
- **THEN** the current cell receives one verified complete inline result without changing its source, language, metadata, sibling cells, controller, or requested focus behavior
- **AND** each attributed source column retains its q type, attribute, and exact values in supported MIME

#### Scenario: Save and reopen with or without a live result
- **WHEN** an attributed table or keyed-table result is saved, closed, and reopened after execution in either positive or zero `maxOutputRows` mode
- **THEN** the saved renderer displays the same complete row values and structural key cues using the persisted payload alone
- **AND** its validated schema still identifies each original column attribute, including attributes on value columns
- **AND** opening the saved output in KX Results displays that output without executing q or mutating the persisted schema metadata

#### Scenario: Attributed zero-row table
- **WHEN** a q table or keyed table has zero rows and one or more attributed typed columns
- **THEN** notebook execution succeeds with zero grid rows and the original column schema, q types, attributes, and key ordinals intact after save and reopen

#### Scenario: Older portable output remains readable
- **WHEN** saved v1 or v2 output lacks the new optional attribute metadata
- **THEN** validation and rendering retain their prior behavior and do not infer an attribute from a column name, sort order, or key status

#### Scenario: Malformed attribute metadata is rejected
- **WHEN** an untrusted MIME payload supplies duplicate, out-of-range, unordered, non-integer, zero, sparse, or otherwise malformed column-attribute entries, or supplies the extension on an unsupported payload version or mode
- **THEN** strict validation rejects it rather than silently dropping or changing the attribute

### Requirement: Notebook result failures identify their cause
After q has returned, an exact-output encoding failure SHALL be reported as a result-persistence failure with a bounded q type/value detail when available. It SHALL NOT suggest testing the KX connection. Connection and IPC failures SHALL retain their existing connection diagnostics, and unsupported q identities SHALL NOT be flattened, stringified, or labelled complete to avoid an error.

#### Scenario: Unsupported exact identity
- **WHEN** Direct IPC returns a value whose exact q identity remains unsupported by supported MIME, such as a top-level dictionary
- **THEN** notebook output reports a bounded encoding reason without a connection-test instruction or a lossy success output
- **AND** the already issued q query is not run again

#### Scenario: Connection failure
- **WHEN** the Direct IPC query fails before returning a q value
- **THEN** notebook output retains the connection-specific failure diagnostic and connection-test guidance

### Requirement: Result surfaces and existing presentation contracts remain consistent
Adding column-attribute persistence SHALL NOT change the KX Results panel's live q value, table row presentation, grid actions, copy/export, chart data or sampling, standalone list identity, and notebook execution, cancellation, stale-output, or live-binding rules. Live and saved notebook grids SHALL derive visible rows from the same exact cells while preserving the schema metadata in the authoritative output.

#### Scenario: Same result on three surfaces
- **WHEN** a supported attributed keyed table is shown directly in KX Results, as current notebook output, and as reopened saved notebook output
- **THEN** all three show the same rows, typed values, column order, and structural key cues
- **AND** notebook persistence retains the whole-column attribute without changing chart sampling or copy/export values

#### Scenario: Stale completion and explicit rerun
- **WHEN** an attributed result completes after the cell or output has been superseded, or a saved result is merely opened
- **THEN** no stale output replaces the current cell and no q query is issued by passive rendering
- **AND** only an explicit rerun issues the current q source according to the existing exactly-once rule

### Requirement: Large-table format compatibility
Complete supported MIME SHALL mean full v2 output for non-table and plain-row fallback results and strict full v4 packed-column output for supported native q tables and keyed tables with authoritative typed columns at every cardinality, as specified by `pack-native-notebook-tables-consistently`. These formats SHALL preserve exact cells, attributes, structural keys, durable identity, and existing zero/positive retention and action rules. Previously valid v1/v2/v3 files SHALL remain readable.

#### Scenario: Large table in either retention mode
- **WHEN** a supported native q table with authoritative typed columns has any row/cell count in either zero or positive mode
- **THEN** full v4 packed columns preserve every value without a per-cell row tree or result truncation
- **AND** passive rendering, save/reopen, and panel handoff do not execute q
