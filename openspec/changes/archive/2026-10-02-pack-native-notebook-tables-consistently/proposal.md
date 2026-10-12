## Why

A 60,000 × 14 native q table uses verbose v2 typed cells because it has 840,000 outer cells; a 600,000-row table crosses the one-million-cell cutoff and uses lossless packed v4 columns. This causes an avoidable size inversion, unrelated to cache retention. The actual current container file contains one packed 600k result and no duplicate large output.

## What Changes

- Remove the outer-cell-count cutoff for native q tables and keyed tables with authoritative typed q columns. Use complete exact v4 columns at every size, including small/empty tables.
- Intentionally change newly produced ordinary-size native table MIME from v2 to v4; preserve existing v1/v2/v3/v4 reading. Non-table output, standalone symbol/list markers, plain JavaScript row-table fallback and Python-helper formats stay unchanged.
- Keep exact cells, attributes, structural keys, durable identity, zero/positive retention, Results/live/saved presentation, export/chart sampling and execution ownership intact. No output cap, truncation, new caching policy or automatic file migration.
- Reproduce 60k/600k using the user's container and existing configured q profile as explicitly authorized, with temporary outputs/files and unchanged user notebook. Build audited local 0.2.42 artifacts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `notebook-q-execution`: consistent packed native-table production across cardinalities while preserving all previous readers and non-native/scalar contracts.

## Impact

Producer selection, former cutoff constant, controller/regression assumptions about native v2 rows, exact small/empty/attributed-keyed and 60k/600k tests, container reproduction, docs/spec reconciliation and audited release. The existing packed codec and rendering/action ownership policies do not change.
