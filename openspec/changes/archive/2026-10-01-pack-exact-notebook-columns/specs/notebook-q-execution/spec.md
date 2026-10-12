## MODIFIED Requirements

### Requirement: Large q tables use complete exact columnar notebook output
Supported q tables and keyed tables above one million cells SHALL use complete MIME v4 packed-column encoding without repeating q type envelopes for every scalar cell. Each column SHALL retain its source q type, vector attribute, cardinality, and every exact scalar or nested value. The durable output ID, full persistence metadata, structural key ordinals, and provenance SHALL remain strict. Older MIME v1/v2/v3 input and ordinary-size v2 output SHALL retain their existing contracts. MIME v3 SHALL remain readable; MIME v4 SHALL be an explicit new version whose rich output requires the updated reader.

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
- **WHEN** existing v1/v2/v3 .qnb or .ipynb output is opened or an ordinary-size result is executed
- **THEN** existing formats remain supported and ordinary-size Direct IPC output stays v2
- **AND** scalar, standalone-list, unsupported dictionary/function, cancellation, stale-generation, and controller routing semantics are unchanged

#### Scenario: Genuine encoding resource failure remains visible
- **WHEN** a result still cannot be represented or serialized within available runtime resources
- **THEN** the error distinguishes representation or runtime encoding failure from connection/query failure without exposing result content, truncating it, or reissuing q

## ADDED Requirements

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
