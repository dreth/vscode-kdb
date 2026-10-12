## Context

The IPC decoder already retains q vector attributes on `QTable.columnData`, including the key and value halves of a `QKeyedTable`. `qValueToColumnarPanel` can display their rows in KX Results. `qValueToLosslessPortablePanel` instead sets `exactPersistenceIssue` for every attributed table column, and `directQPortableResult` converts that into a failed notebook execution. This is intentional under today's row-only MIME v2 table schema: row cells cannot record metadata attached to a whole column. Tests and docs currently codify that rejection.

The first-party `.qnb` controller and mixed `.ipynb` q route share Direct IPC result preparation and MIME v2 validation. Current notebook output may use a live result record, but saved output and zero `maxOutputRows` mode use the persisted payload. KX Results opened from saved output projects its rows into a columnar panel. Key-column ordinals already demonstrate the optional source-ordinal schema pattern. The separately packaged Python helper emits a bounded v1 format and is outside this change.

## Goals / Non-Goals

**Goals:**

- Make supported attributed q tables and keyed tables successful, complete Direct IPC notebook results in both routes and both live-retention modes.
- Keep their row cells, q types, attribute codes, column order, structural key ordinals, and zero-row schemas exact through JSON save/reopen.
- Preserve KX Results, current inline, and saved inline presentation, chart sampling, copy/export, and existing execution lifecycle rules.
- Report output-encoding errors without telling users to test a connection that already returned a value.

**Non-Goals:**

- Changing q execution, IPC decoding, chart or standalone-list presentation, the Python helper contract, or dictionary/function support beyond existing exact cells.
- Automatically rerunning q to recover a saved result or converting unsupported identities into approximate output.

## Decisions

### Store sparse column attributes in the MIME v2 table schema

Add optional `schema.columnAttributes` as an ascending list of `{ ordinal, attribute }` records. Each ordinal identifies an original source column and each attribute is a nonzero q vector attribute code from 1 through 4. The existing `schema.columns[ordinal].type` identifies its q vector type; the exact row cells supply its elements. This also represents attributed empty columns. Key ordinals remain independent and may overlap. Omit the extension when no column is attributed, preserving the existing output shape.

This follows the existing key-ordinal extension and avoids duplicating every column vector in the payload. A full portable q vector beside every row would double large results and introduce two authorities for values. Dropping the attribute would repeat the reported bug. The new field is accepted only on complete first-party v2 table output; v1 and preview schemas retain their current contract.

Validate the metadata at creation and untrusted payload read: dense undecorated list; plain records with exactly the two expected keys; strictly increasing unique in-range integer ordinals; attribute codes 1–4; a compatible q type in the referenced column; and no schema extension on v1 or preview output. Reuse one validator for creation and loading. Reject invalid input before normalization or JSON serialization can erase sparse/extra properties. Preserve the validated records in the returned payload. Older v1/v2 output without the field remains valid.

### Capture attributes at the decoded q boundary

Read the original `columnData` vectors before row projection in `qValueToLosslessPortablePanel`. For a keyed table, concatenate key and value column data in source order; for an ordinary table, use its column data directly. Carry only the sparse attributes through the portable panel result into `directQPortableResult` and `createPortableKxResultV2`. Remove the current attributed-column rejection only after the complete payload and validator can store the metadata. Keep the top-level dictionary rejection and per-cell exact encoding checks.

KX Results' direct q path continues to display the decoded q value. Current notebook output continues to derive rows from live data when bound; saved output and zero mode derive rows from MIME v2. Saved-result handoff to KX Results continues to project exact cells and key ordinals for display without mutating its source payload or executing q. Neither renderer needs an attribute badge for this fix; the attribute is authoritative persisted q metadata, not a new visual sort indicator.

### Distinguish encoding errors from IPC errors

Represent a failure from portable result construction as a typed result-encoding error at the controller boundary. The controller's catch path uses that type to report that q returned a result but complete notebook output could not be encoded, without the generic connection-test sentence. The existing connection/IPC diagnostic path retains the connection guidance. Preserve the issued-query state, output commit guards, cancellation, and no-retry rules.

## Risks / Trade-offs

- **Older extension versions reject newly attributed v2 payloads** → The format extension is optional and only produced for results that previously failed; old v1/v2 payloads remain readable in the updated extension. Document this forward-compatibility limit.
- **Attribute metadata could be attached to the wrong source column** → Use source ordinals before display reorder, strict creation/read validation, keyed and ordinary multi-column fixtures, and JSON round-trip tests.
- **Zero-row tables have no cell evidence for their type** → Retain the decoded column type in `schema.columns` and test zero-row ordinary and keyed tables explicitly.
- **Generic catches can still mislabel failures** → Test both a post-query encoding failure and an actual connection/IPC failure through the controller, including the connection-test hint boundary.

## Migration Plan

No saved-file migration is needed. The updated validator reads existing v1/v2 output without `columnAttributes`; newly successful attributed results write the optional v2 extension. Rollback to an older extension can still read prior output but cannot read newly written attributed results. Docs and changelog will state the supported output shape.

## Open Questions

None for the specified behavior. The implementation should verify the existing column-type mapping for every supported attributed q vector type before accepting its metadata.

## Reconciliation with large-table persistence

The subsequent `support-columnar-notebook-results` change introduces a strict full v3 columnar format for native q tables/keyed tables above one million cells. Existing v2 format and compatibility metadata remain unchanged for ordinary output; statements above about v2 persistence apply to that original format. Complete output, optional column attributes, durable identity, zero/positive retention, ownership, passive actions, unsupported identity errors, and presentation/sampling invariants apply equally to supported full v3 output. New large-result files require the updated reader; existing v1/v2 output remains readable. No preview or Python-helper format changes.

## Native-table packing reconciliation (2026-10-02)

`pack-native-notebook-tables-consistently` removes cardinality-based format selection. Eligible native tables/keyed tables now use full v4 even when small or empty; the original v2 compatibility statements apply to non-table/plain-row fallbacks and existing saved files. Zero/positive retention, typed identity, attributes, keys, ownership and actions remain unchanged.
