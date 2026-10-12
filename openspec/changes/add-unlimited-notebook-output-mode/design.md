## Context

First-party `.qnb` and mixed-Jupyter Direct IPC execution share `KxQNotebookRunner`. Today the runner always converts a successful supported q value into complete exact portable MIME v2 and then registers the original `QValue` in `LiveNotebookResultStore`. The portable payload is durable notebook state; the live record is a second, process-local representation used for viewport slices, search, copy, chart refinement, and live KX Results handoff until rerun, clear, close, eviction, or Extension Host shutdown.

`vscode-kdb.notebook.maxOutputRows` currently accepts `1`-`10000`. It supplies compatibility metadata to complete v2 output and bounds the optional Python-helper Tag/Prepare marker, but it does not truncate first-party rich output. `maxOutputBytes` similarly bounds static fallback/helper output rather than complete Direct IPC MIME v2. Portable v2 validators intentionally require positive legacy limit metadata even in `full` mode.

Query History is contributed as a discoverable view by the active `add-runtime-sidebar-views` change, but `package.json` and the feature controller currently default capture to false. Its entries are bounded workspace-local extension state and exclude results, credentials, internal queries, variable previews, and Python-owned execution.

This change crosses the configuration schema, shared notebook settings, both direct-q notebook routes, output metadata, live-store lifecycle, renderer/host handoff, Query History feature reconciliation, tests, and documentation. The persisted MIME contract, exact q identity, results behavior, exactly-once query issue, and current active-route/stale-output safeguards are compatibility boundaries.

## Goals / Non-Goals

**Goals:**

- Make `maxOutputRows: 0` the single source of truth for unlimited first-party notebook persistence with no retained raw live-result record.
- Continue to write every exactly representable Direct IPC value into portable MIME v2 even when it exceeds the configured static byte limit.
- Let zero-mode inline and KX Results surfaces consume the complete saved payload without hidden q execution.
- Ensure an explicit later run/rerun executes the complete current source exactly once and cannot reuse an earlier value.
- Preserve positive-limit Direct IPC live behavior and bounded Python-helper behavior.
- Default Query History capture on while retaining an authoritative explicit opt-out and all existing privacy/storage exclusions.
- Avoid a portable MIME version change or migration.

**Non-Goals:**

- Removing browser/host safeguards for search, copy, sorting, charts, formatting, or viewport work.
- Re-executing stateful q source on notebook open, render, KX Results handoff, or any other passive action.
- Making the external Python companion unlimited or giving it a first-party live binding.
- Extending exact portable v2 to currently unsupported q container identities.
- Changing ordinary KX Results, editor execution, connection routing, cancellation, or history retention formats.

## Decisions

### 1. Resolve one explicit notebook output policy from shared settings

Extend the shared row-limit parser to accept safe integer `0`, and derive a policy equivalent to:

- `rowLimit === 0`: `persistence = complete`, `retainLiveResult = false`;
- `1 <= rowLimit <= 10000`: existing complete first-party persistence, `retainLiveResult = true`.

The package schema minimum becomes `0`. Invalid, fractional, negative, and out-of-range values continue through the existing deterministic validation/fallback behavior. Both `.qnb` controller execution and mixed-Jupyter **Run q Cell (KX)** must use this same policy; renderer code must not independently infer it from global configuration because the committed output metadata/payload is authoritative for that output.

The optional Tag/Prepare command requires a positive helper preview limit. When the shared value is `0`, it writes the documented default `20` into `%%q --max-rows` rather than forwarding zero or promising an unlimited external-helper result. Positive values remain unchanged.

Alternative considered: make zero mean an empty preview or normalize it to one. That contradicts the requested unlimited semantics and would conceal whether live retention should be disabled.

### 2. Keep portable MIME v2 byte-for-byte schema-compatible

Zero is a runtime/configuration policy, not a new persisted persistence mode. Complete v2 creation already walks every source cell and deliberately does not apply `rowLimit` or `byteLimit` to its authoritative payload. Keep `persistence.mode = "full"`, `result.truncated = false`, the durable `outputId`, exact typed cells, and the current positive compatibility metadata required by v2 validators. Use the documented helper/default positive limit for `previewRowLimit`/`rowLimit` fields when the effective configuration is zero; do not serialize zero into fields that older readers reject.

`maxOutputBytes` continues to bound only `text/plain` and helper/static fallbacks. Exact-conversion failures remain errors, not previews. Host or filesystem exhaustion may still fail normally; the extension must not silently truncate and claim completeness.

Alternative considered: add an `unlimited` persistence mode or permit zero in v2 limit fields. That would require a contract version/migration, cause older extension versions to reject newly saved output, and encode a runtime cache preference into otherwise self-contained saved data.

### 3. Separate durable output binding from optional live binding

Refactor output materialization conceptually into two independent products:

1. complete MIME v2 items plus durable output-binding metadata; and
2. an optional live registration containing the raw `QValue`.

Positive mode keeps the existing register/stage/rebind lifecycle and live metadata. Zero mode emits only durable output-binding metadata, never calls live `register`, `stage`, `bind`, or `rebind` for the newly returned value, and does not place a live ID in the replacement cell output. A prior committed output keeps its valid live binding while mixed-Jupyter replacement is pending or fails; only after the zero-mode replacement commits and verifies does the runner retire the previous cell/output binding. This preserves the established failure behavior without caching the new zero-mode result. Cancellation, stale completion, rejected output commit, cell removal, clear, close, and deactivation keep their current cleanup behavior.

For mixed-Jupyter output retries, zero mode reuses the already serialized items and durable output identity only. It does not temporarily stage the raw result. This preserves the existing rule that local output retries never issue q again.

Alternative considered: register the result until output commit and remove it immediately afterward. Even transient registration duplicates the heaviest value, complicates races, and violates the explicit no-cache policy.

### 4. Treat zero-mode output as complete saved data on every notebook surface

The renderer already validates and renders complete MIME v2 when a live handle is absent, including after reopen. Zero-mode output takes that path immediately: it must not send `requestLiveResult`, and its status/action wording must describe a complete result rather than a truncated or expired preview.

Opening zero-mode output in KX Results uses the existing output-ID-checked saved-result handoff and reconstructs the panel value from MIME v2. It does not access `LiveNotebookResultStore` and does not execute q. An explicit cell run or **Rerun cell** continues through `KxQNotebookRunner`, validates the current source/route, issues q once, and assigns fresh output identity.

This creates an intentional surface distinction:

| Surface | Zero mode source | Positive mode source |
| --- | --- | --- |
| Current inline output | Complete MIME v2 in the cell | Complete MIME v2 plus live raw value |
| Reopened inline output | Complete MIME v2 in the cell | Complete MIME v2 in the cell; live handle is not revived |
| KX Results handoff | Reconstructed complete MIME v2 | Live raw value while valid, otherwise complete MIME v2 |
| Explicit rerun | One fresh q execution | One fresh q execution |

Saved-data rendering retains its own operational bounds (paged wide columns, bounded displayed qText, chart source rules, copy/search/sort guardrails). Those do not truncate the authoritative payload.

Alternative considered: automatically rerun q when the panel or renderer needs a live operation. q source can be stateful or mutating, the active route may have changed, and passive UI actions must not create server work.

### 5. Change the Query History default at both manifest and runtime fallbacks

Set the contributed configuration default to true and change all defensive `WorkspaceConfiguration.get(..., fallback)` calls in feature reconciliation to use true. VS Code's effective configuration remains authoritative, so an explicit `false` continues to disable writes and shows the disabled view state. Do not migrate or rewrite user settings: existing explicit choices survive, while scopes with no stored value adopt the new default.

The storage key, maximum-entry pruning, eligible execution boundary, outcome handling, rerun/copy/insert/delete/clear actions, and exclusions remain unchanged. No result payload from unlimited notebook output enters history.

Alternative considered: write `true` into user/workspace settings during activation. That would override configuration inheritance, create unnecessary settings mutations, and make opt-out behavior harder to reason about.

### 6. Reconcile the active sidebar capability before archive

`runtime-sidebar-inspection` is currently introduced by the separate active `add-runtime-sidebar-views` change. Implementation may proceed against that code, but its default-off wording and tests must be updated coherently. Before archive, either complete/archive the sidebar change first and apply this delta to the resulting main spec, or update/rebase the active artifacts so the final main requirement has default-on plus explicit opt-out semantics. Neither change may archive a contradictory contract.

## Risks / Trade-offs

- **Very large MIME v2 payloads can increase execution latency, renderer memory, notebook file size, save time, and source-control churn** → Document zero as an explicit high-cost choice, avoid the duplicate raw Extension Host record, retain honest failures, and test that no configured truncation is mislabeled as complete.
- **Portable conversion still temporarily observes the returned `QValue` while serializing** → Keep ownership scoped to execution/materialization and release references after output commit; no long-lived live-store record is created in zero mode.
- **Saved-payload operations can be slower or have different operational limits than live-store operations** → Preserve explicit complete-saved status and existing renderer safety bounds; do not fake live availability.
- **Removing live binding could accidentally break output matching or panel handoff** → Preserve durable output-binding metadata independently and add both current-session and reopen regression coverage.
- **A stale positive-mode record could survive after switching successfully to zero** → Retire prior cell ownership immediately after the replacement identity commits and assert the old live ID becomes unavailable; preserve it when replacement fails because the prior output remains displayed.
- **Default-on history stores query text for users who never made a prior choice** → Keep storage local, bounded, excluded from Settings Sync/telemetry, expose the setting prominently, honor explicit false, and call out the default change in release notes.
- **Two active changes describe Query History defaults differently** → Treat reconciliation as an implementation/archival gate and validate all active deltas together.

## Migration Plan

1. Land or reconcile the active sidebar/history change so its capability is available with default-on wording.
2. Change configuration validation and shared policy helpers without altering persisted MIME v2 validation.
3. Split durable output metadata from optional live metadata, then route both notebook execution owners through the shared zero/positive policy.
4. Update renderer status/actions only where no-live complete output currently implies a reopened result rather than a deliberate current-session zero-mode result.
5. Change the manifest and runtime Query History defaults together.
6. Update focused tests, full gates, documentation, generated docs, and changelog before packaging.

No notebook-output migration is required. Rollback can restore the prior setting minimum/default behavior; notebooks already written in zero mode remain ordinary valid complete MIME v2 and continue to open in older compatible releases. Explicit Query History settings and retained entries require no rewrite.

## Open Questions

None. The design intentionally interprets “query the full thing again” as an explicit fresh cell execution, never as a passive panel/open/render side effect.

## Reconciliation with large-table persistence

The subsequent `support-columnar-notebook-results` change introduces a strict full v3 columnar format for native q tables/keyed tables above one million cells. Existing v2 format and compatibility metadata remain unchanged for ordinary output; statements above about v2 persistence apply to that original format. Complete output, optional column attributes, durable identity, zero/positive retention, ownership, passive actions, unsupported identity errors, and presentation/sampling invariants apply equally to supported full v3 output. New large-result files require the updated reader; existing v1/v2 output remains readable. No preview or Python-helper format changes.

## Native-table packing reconciliation (2026-10-02)

`pack-native-notebook-tables-consistently` removes cardinality-based format selection. Eligible native tables/keyed tables now use full v4 even when small or empty; the original v2 compatibility statements apply to non-table/plain-row fallbacks and existing saved files. Zero/positive retention, typed identity, attributes, keys, ownership and actions remain unchanged.
