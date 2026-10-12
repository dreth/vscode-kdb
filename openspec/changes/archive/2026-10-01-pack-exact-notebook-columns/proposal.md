## Why

The actual 600,000 × 14 notebook is 279 MiB: four ragged numeric columns hold 2.4 million nested vectors and repeat about 126 MiB of q-node metadata. Even gzip of its current JSON is 32.7 MiB; the user wants materially smaller complete saved results.

## What Changes

- Add complete MIME v4 packed columns for large native q tables/keyed tables, with lossless constant, numeric delta, exact reversible floating-point scaling or binary fallback, and homogeneous ragged-vector storage. Compress binary blocks and encode them inside ordinary notebook JSON.
- Preserve every q value/type/special, vector attribute, nested vector boundary, structural key, durable identity and result count. Shared cell access derives requested cells without a whole-table node tree.
- Keep existing v1/v2/v3 readers and ordinary-size v2 writers. Unsupported packing shapes retain exact portable q columns rather than being flattened or truncated.
- **BREAKING for older readers of newly packed output:** v4 requires the updated extension; no existing file is changed merely by opening it.
- Preserve live and saved notebooks, standalone Results presentation, copy/export/chart semantics and sampling, zero/positive retention, strict ownership, native/Jupyter output ownership, cancellation/stale/clear/close, and passive-action/no-q rules.
- Build an audited local release after automated and actual-container verification. No automatic permanent installation or external publishing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `notebook-q-execution`: complete lossless packed-column persistence and compatible live/saved consumers.

## Impact

Host-neutral packed-column codec and compression dependency, notebook contract/controller/ownership, browser rendering through shared accessors, exact/malformed/memory/browser regressions, container file verification, documentation and versioned VSIX/ZIP. No changes to the q query, database, Python-helper contract, chart sampling or user's current notebook.
