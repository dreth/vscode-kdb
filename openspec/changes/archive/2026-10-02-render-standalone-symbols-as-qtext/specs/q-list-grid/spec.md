## ADDED Requirements

### Requirement: Standalone q symbol atoms use qText
A standalone q symbol atom SHALL render as type-preserving qText by default in KX Results, live first-party notebook output, zero-retention notebook output and reopened new exact output. List Grid/qText settings SHALL NOT turn a symbol atom into a one-cell table. Symbol vectors SHALL continue to follow their existing list display strategy and cardinality contracts. Symbols nested in real tables, keyed tables, dictionaries or lists SHALL retain their existing structured cell behavior, backtick display and analyst export semantics.

New exact notebook output SHALL preserve the unchanged symbol atom with an explicit validated standalone presentation marker. Consumers SHALL derive qText from that exact atom without mutating the authoritative output or inferring atom identity from a table's shape. Existing unmarked one-cell outputs SHALL retain their previous display; old files SHALL remain readable, and new marked output SHALL require a compatible reader. Existing durable/live ownership, rerun, stale/clear/close and passive-no-query rules SHALL remain unchanged.

#### Scenario: One symbol with either list setting
- **WHEN** q returns the symbol atom `hola with either Grid or qText selected for lists
- **THEN** KX Results and live notebook output show qText `hola without a table

#### Scenario: Symbol vector keeps its selected display
- **WHEN** q returns `hola`ciao, enlist `hola or an empty symbol vector
- **THEN** the existing selected list Grid/qText presentation, element order and vector identity remain unchanged

#### Scenario: Symbol table and dictionary cells survive
- **WHEN** a real table, keyed table, dictionary or mixed list contains symbol atoms
- **THEN** it keeps the existing selected structured presentation and symbol cell backticks
- **AND** table copy/export keeps analyst values without mutating symbols

#### Scenario: Exact saved symbol atom
- **WHEN** a standalone symbol is executed in native .qnb or mixed .ipynb under either retention mode and saved/reopened
- **THEN** its exact symbol identity, durable ID and presentation marker survive
- **AND** saved display, static text/HTML, text export and Results handoff derive the same qText without executing q

#### Scenario: Escaped and null symbols
- **WHEN** a standalone symbol requires escaping or is the q null symbol
- **THEN** the display uses the original symbol's valid q syntax without converting it to a character vector or plain text

#### Scenario: Existing one-cell table is not inferred as an atom
- **WHEN** a real one-cell table contains a symbol or an existing saved output has no standalone marker
- **THEN** it keeps the established table display without guessing standalone identity

#### Scenario: Invalid standalone marker
- **WHEN** presentation metadata is attached to a preview, vector, nonsymbol atom, multiple rows/columns, attributed/keyed schema or charted table
- **THEN** strict validation rejects it and its actions
- **AND** a valid saved action remains authorized against the unchanged canonical source output
