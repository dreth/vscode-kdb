## Why

Direct IPC notebook execution currently treats a valid q table or keyed table with an attributed column (for example, a sorted `sym` key) as a failed cell. The row-oriented MIME v2 payload has no place for a whole-column attribute, so the controller rejects the result even though KX Results can display it; its generic connection-test hint also misidentifies this post-query encoding failure.

## What Changes

- Preserve whole-column q vector attributes in complete first-party MIME v2 table output, including keyed tables and empty columns, so `.qnb` and mixed `.ipynb` q cells display successful results and reopen with their exact column metadata.
- Keep the existing row and cell encoding, structural key ordinals, and display behavior; add narrowly validated, optional schema metadata for attributed columns. Existing v1/v2 output without that metadata remains readable.
- Distinguish a result-encoding failure from a connection failure in notebook error text. Values that still cannot be represented exactly continue to fail with a useful bounded technical reason.
- Cover the KX Results panel, current notebook output, and saved notebook output with focused regressions, and update the notebook/results documentation and changelog.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `notebook-q-execution`: Exact Direct IPC notebook output accepts table and keyed-table column attributes while preserving their q identity, both notebook routes, and honest failure behavior for genuinely unsupported values.

## Impact

- Affected code: `src/q-ipc.ts`, `src/notebook-contract.ts`, `src/notebook-controller.ts`, notebook renderer and saved-output handoff consumers where column metadata is needed, and focused tests in `test/`.
- Persisted contract: optional MIME v2 table schema metadata records source-column attributes; older v1/v2 payloads retain their existing interpretation and validation. No new IPC request, notebook migration, or Python companion format is required.
- Existing behavior to preserve: KX Results grid and structural key highlighting, exact typed row cells and standalone vectors, full-output identity and live binding policy, copy/export, sorting, charts and sampling, and explicit rejection of unsupported dictionary or cell identities.
- Non-goals: changing q execution or connection selection, changing chart sampling or list presentation, flattening attributed columns into rows, or claiming a lossy result is exact.

## Reconciliation with large-table persistence

The subsequent `support-columnar-notebook-results` change introduces a strict full v3 columnar format for native q tables/keyed tables above one million cells. Existing v2 format and compatibility metadata remain unchanged for ordinary output; statements above about v2 persistence apply to that original format. Complete output, optional column attributes, durable identity, zero/positive retention, ownership, passive actions, unsupported identity errors, and presentation/sampling invariants apply equally to supported full v3 output. New large-result files require the updated reader; existing v1/v2 output remains readable. No preview or Python-helper format changes.
