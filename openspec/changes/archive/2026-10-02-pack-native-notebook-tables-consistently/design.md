## Context

The native producer selects v4 only above one million outer cells. A 60k × 14 table falls below that boundary despite millions of nested values, while a 600k table gets packed. Session-cache mode cannot explain persisted MIME duplication; the current container notebook contains one 600k v4 result. Shared row/cell helpers already read all complete column formats.

## Goals / Non-Goals

Remove format selection by row/cell count for native tables with authoritative q columns. Intentionally change newly emitted small native table MIME to existing v4 while preserving exact identity, old readers and non-table/plain-row fallback v2. Do not change the packed codec, renderer, execution/retention/ownership, chart sampling or user notebook.

## Decisions

1. Select packed v4 whenever the lossless native-table adapter supplies typed q columns matching the schema. Remove the former cell-count threshold instead of lowering it, avoiding another count-based size discontinuity. Native small/empty tables may have slightly higher descriptor overhead; exact storage has no fixed compression-size guarantee.
2. Preserve v2 for standalone atoms/lists and plain-row fallback models, with existing standalone-symbol/list metadata and all prior compatibility. Never infer native column identity from displayed rows. Existing files do not migrate on open/save.
3. Update native controller tests to access cells through shared helpers rather than assume v2 `.data.rows`. Keep explicit v2 creator/reader tests and plain-row fallback expectations intact. Cover small/empty/attributed/keyed native tables, 60k/600k production and both retention/notebook routes.
4. Use the user's explicit control/reproduction authorization to run exactly the notebook query with 60k and 600k limits through the existing configured analytics-7008 profile in the running container. A temporary loopback inspector retrieves existing helper/service references without printing credentials, query text or returned data. Compare old and updated production, serialize/reopen/write temporary files, preserve source SHA and reuse the same q client for both queries, release all temporary references and close the inspector. Do not permanently install or replace user output.

## Risks / Trade-offs

- Small tables have new v4 storage: explicitly document and test small/empty, attribute/key, render/export and old v2 reader behavior.
- Large reproduction allocates memory: run sequentially, release completed raw results and intermediate output before the next query, print content-free timings/sizes only.
- Private/live-state effects: use the same current profile/namespace; no parallel q issue, settings/profile edits or notebook overwrite; inspector is temporary and loopback only.

## Migration Plan

Ship audited local 0.2.42 VSIX/ZIP after all tests and actual-container reproduction. Existing v4 readers from 0.2.40 can display newly packed tables; standalone-symbol metadata still requires 0.2.41+. Old saved 60k v2 output remains unchanged until rerun. Discovery: the running manager has zero clients; allow it to open the configured analytics-7008 connection for the authorized reproduction, then disconnect only the client created by this work. Leave active selection and settings unchanged.

No new MIME version, permanent installation, Git commit/tag or publication.
