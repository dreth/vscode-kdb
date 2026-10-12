## Context

The packaged 0.2.33 and current shared q IPC presentation function send numeric standalone atoms and functions to qText, but non-null symbol atoms fall through to a `value` grid. Symbol vectors already obey list settings. Exact notebook atoms are intentionally stored as typed v2 cells rather than qText strings; inferring atom identity from a one-cell table would break real tables.

## Goals / Non-Goals

Render standalone symbols as qText consistently in Results/live/saved output. Keep exact atom identity, vectors/list settings, table/dictionary cells, analyst table export, ordinary scalar classes, packed v4 storage and ownership unchanged. Do not migrate old files, infer standalone identity, change chart sampling, or issue passive queries.

## Decisions

1. Extend the shared standalone atom preference only for q symbol atoms. Retain the exact q literal formatter, including escaped and null symbols. Both Results and live notebook host messages already consume this policy.
2. Add strict `logicalPresentation: standalone-symbol` to complete v2 row-table storage only when the producer knows the original result is a symbol atom. Reuse standalone-list structural guards: one column/row/exact q cell, full output, no key ordinals, column attributes or chart; additionally require symbol schema and atom type. Exact q cell remains authoritative. No MIME version change; compatible readers are required for the new optional marker.
3. Extend shared saved presentation derivation to produce a transient qText view for the marker. Renderer keeps original `sourcePayload` for binding/action proofs; static text/HTML and Results handoff use the same derived view. Saved text export authorizes the canonical source first, then derives display text. Existing unmarked files and actual one-cell tables keep their old layout. No source bytes, IDs, persistence counts or q values are changed by display.
4. Test symbol atoms, escaped/null symbols, vector cardinalities/strategies, real symbol tables/dictionary/list cells, all native/mixed retention paths, save/reopen identity, malformed markers and text-export authorization. Browser tests verify absence of a table for new marked symbol output and preserve existing grids.

## Risks / Trade-offs

- Treating a real table as an atom: prevent with explicit source marker, not shape inference.
- Losing q identity to a qText string: keep typed exact atom in canonical MIME.
- Derived display payload failing ownership: send original source for actions and derive text only after authorization.
- Older reader rejecting marker: document 0.2.41+ for new marked output, preserve all previous formats.

## Migration Plan

Build audited local 0.2.41 VSIX/ZIP after targeted/full checks and synced docs/specs. Existing saved outputs stay unchanged until rerun. No permanent installation, user file modification, Git commit/tag or external publication.
