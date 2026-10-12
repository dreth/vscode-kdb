## Context

MIME v2 stores rectangular rows of individually typed cells. The actual container's Node has a 536,870,888-character string limit. q IPC already decodes actual table columns as typed vectors, which can be preserved compactly. Shared contract helpers feed live/saved notebooks and panel handoff; Jupyter owns ipynb persistence.

## Goals / Non-Goals

**Goals:** Avoid per-cell q wrappers for large actual q tables and keep complete exact cells through every supported surface and persistence route.

**Non-Goals:** Change q execution, non-table identity, ordinary-size v2 format, preview/helper policies, chart sampling, Results-panel live q representation, or install/publish automatically.

## Decisions

1. Add explicit v3 full table data `{encoding: "q-columns", columns: PortableQVectorNode[]}`. Use it for actual supported q tables/keyed tables above one million cells; preserve v2 for other outputs. Reuse q vector conversion/validation for exact scalar/nested identity, with strict schema/type/attribute/cardinality agreement and existing output/provenance/bounds/key validation. A threshold selects storage format, never limits result cardinality. A new version prevents quietly weakening strict v2 schema readers. Chunking the old verbose output would still require hundreds of MB and duplicate typed trees throughout save/reopen/renderer.
2. Extend the table data union and provide shared row-count, cell, row, and row-iteration helpers. Consumers read only needed cells from vectors; no Proxy, hidden serialization hooks, or eager conversion to row wrappers. Transport remains plain JSON suitable for browser messaging and either serializer. Reconcile active v2-specific plans to recognize the explicit large-table v3 exception while retaining all v2 semantics.
3. Use existing canonical ownership checks with valid v3 durable identities; retain byte-proof cache, duplicate claims, strict metadata, bounded scans, notebook/cell/session binding, clear/close/replacement rules, and existing zero/positive retention. Saved actions validate the same payload. All column data remains authoritative after reopening; no sidecar files or q reruns.
4. Preserve exact vector conversion ownership: portable columns own scalar arrays rather than retaining the raw q table in zero mode. Existing compact qnb writer/scanner handles the smaller plain JSON. Genuine runtime string/allocation errors get bounded content-free diagnostics; avoid suggesting Test Connection or claiming a preview is complete.

## Risks / Trade-offs

- New v3 files need the new reader → document compatibility and keep ordinary output/old reads on v2.
- Lazy access could diverge across surfaces → exercise shared typed-cell access, saved grid/model, selection/search/sort, exports, charts/panel handoff, live ownership, and both persistence routes.
- Large results still consume resources → constrained-heap 600,000 × 14 regression, exact full round trip, and actual container pipeline verification; do not promise arbitrary unlimited memory/string size.
- Mixed nested vectors have different validation costs → retain strict q node validation and precise unsupported-value errors; no lossy substitutions.

## Migration Plan

Build audited versioned local VSIX/ZIP after tests and docs. Install remains user's action. Existing files remain untouched on open. Rolling back cannot richly read newly written v3 output; preserve a copy and use the updated reader.
