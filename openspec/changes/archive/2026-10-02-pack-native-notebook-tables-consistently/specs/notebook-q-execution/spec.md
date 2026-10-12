## MODIFIED Requirements

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
