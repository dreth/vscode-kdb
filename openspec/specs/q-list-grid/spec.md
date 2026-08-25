# Q List Grid Specification

## Purpose

Defines how standalone q lists and typed vectors appear in grid mode while preserving exact q identity across live and persisted notebook result boundaries.

## Requirements

### Requirement: Standalone q lists use a cardinality-aware grid presentation
When Grid display is selected, the system SHALL represent a standalone q general list or non-character typed vector containing two or more elements as a two-column grid named `index` and `value`. It SHALL produce one row per list element, use zero-based integer indexes, preserve source order, and expose each element through the existing type-aware cell display rules.

A singleton list/vector such as `enlist 4` SHALL instead produce exactly one data cell containing its sole element (`4`) through the same type-aware cell display rules, with no separate index data cell. This presentation exception SHALL NOT collapse or otherwise mutate the underlying q list/vector into an atom. An empty list/vector SHALL retain the `index` and `value` schema with zero data rows. Character vectors that are semantically q strings SHALL retain their established string presentation unless the value is a general list of character values.

#### Scenario: Numeric q vector
- **WHEN** q returns `1 2 3` and Grid display is active
- **THEN** the result grid has columns `index` and `value`
- **AND** its rows are `(0, 1)`, `(1, 2)`, and `(2, 3)` in that order

#### Scenario: Singleton typed vector
- **WHEN** q returns `enlist 4` and Grid display is active
- **THEN** the result has exactly one data cell containing `4`
- **AND** it has no separate index data cell
- **AND** the underlying q result remains a singleton vector rather than becoming the atom `4`

#### Scenario: Empty typed vector
- **WHEN** q returns an empty non-character typed vector and Grid display is active
- **THEN** the result retains `index` and `value` columns with zero rows

#### Scenario: General list
- **WHEN** q returns a heterogeneous general list and Grid display is active
- **THEN** each top-level element occupies one ordered index/value row
- **AND** nested values use the existing bounded type-aware cell representation

#### Scenario: Character vector
- **WHEN** q returns a character vector that represents a q string
- **THEN** the established string presentation is retained rather than treating each character as an independent list row

### Requirement: Grid and qText remain explicit presentation choices
The list-grid expansion SHALL apply only when Grid display is active. When qText display is selected, the system SHALL render the standalone list/vector as type-preserving q text. Changing presentation SHALL NOT mutate the underlying q value.

#### Scenario: qText list display
- **WHEN** qText display is selected for a standalone numeric vector
- **THEN** the vector is rendered as one type-preserving q expression rather than index/value rows

#### Scenario: Presentation switch
- **WHEN** the same result switches between Grid and qText display
- **THEN** both presentations derive from the same unchanged q value

### Requirement: List-grid behavior is consistent across result surfaces
The KX Results panel, current live notebook output, and reopened exact first-party notebook output SHALL apply the same cardinality-aware Grid presentation to equivalent standalone lists/vectors. Copy, selection, and export SHALL operate on the presented cell or explicit grid columns using the existing result-table rules.

#### Scenario: Results and live notebook parity
- **WHEN** the same standalone typed vector is shown in Results and live notebook output with Grid display active
- **THEN** both surfaces expose the same cardinality-aware schema, cell count, indexes when applicable, and element values

#### Scenario: Grid copy or export
- **WHEN** the user copies or exports an expanded standalone list grid
- **THEN** the output includes the explicit `index` and `value` columns according to the selected result export format

### Requirement: Exact vector identity survives notebook persistence
Adapting a typed vector for Grid presentation SHALL NOT weaken exact notebook persistence. First-party exact output SHALL preserve the vector's outer q type, attribute, cardinality, singleton `enlist` identity, null/infinity semantics, temporal precision, and element values. Reopening that output SHALL reconstruct the exact vector first and derive the cardinality-aware Grid presentation from it; the persisted representation SHALL NOT treat independently displayed cells or rows as the authoritative q value.

#### Scenario: Save and reopen typed vector
- **WHEN** a typed vector is saved in exact first-party notebook output and reopened
- **THEN** its q type, attribute, cardinality, and values round-trip exactly
- **AND** Grid display reconstructs the same cardinality-aware presentation as the live result

#### Scenario: Singleton enlist round trip
- **WHEN** a singleton typed vector is saved and reopened
- **THEN** it remains a vector rather than becoming an atom
- **AND** Grid display still shows exactly one data cell containing its sole element and no separate index data cell

#### Scenario: Temporal precision round trip
- **WHEN** a temporal vector containing precision beyond JavaScript milliseconds is saved and reopened
- **THEN** its exact persisted q values remain unchanged
- **AND** the grid uses the established concise display without replacing the exact values

### Requirement: Other q result shapes remain unchanged
Restoring standalone list rows SHALL NOT change table, keyed-table, dictionary, scalar, function, plain-object, nested-cell, or q-string presentation except where those values already contain a standalone list governed by the selected display strategy.

#### Scenario: Table result
- **WHEN** q returns an ordinary or keyed table
- **THEN** its existing table schema, key identity, and row presentation remain unchanged

#### Scenario: Dictionary result
- **WHEN** q returns a dictionary
- **THEN** its existing key/value presentation and exact identity remain unchanged
