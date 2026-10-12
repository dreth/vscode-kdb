## Why

In 0.2.33 and the current code, a standalone symbol such as `hola falls through to a one-cell value grid, even when symbol vectors use qText through the selected list setting. The user expects the atom itself to appear as qText. Changing generic symbol cell formatting would risk table, dictionary, vector and export behavior.

## What Changes

- Render standalone q symbol atoms as type-preserving qText in Results and live/saved first-party notebooks, independently of list Grid/qText settings.
- Preserve symbol vectors' existing selected list strategy, cardinality-aware Grid, symbol table/dictionary cells and analyst copy/export semantics.
- Retain exact symbol atom storage in complete v2 notebook output, with explicit standalone presentation metadata; never infer standalone identity from a one-cell table. Existing unmarked payloads retain their previous display.
- Compatibility: the new standalone-symbol presentation metadata requires the updated reader; prior v1/v2/v3/v4 payloads remain readable. No new MIME version or query/ownership policy is introduced.
- Non-goals: change numeric/temporal/character/function presentation, packed large-table storage, chart sampling, persistence limits, Python-helper schema, execution or stale/clear/close behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `q-list-grid`: standalone symbol atom qText policy with explicit preservation of vector and nested-cell presentation.

## Impact

Shared q IPC presentation policy, exact notebook presentation marker validation and display derivation, Results/live/saved consumers, focused runtime/browser tests, docs and audited local release. No data migration or user-notebook overwrite.
