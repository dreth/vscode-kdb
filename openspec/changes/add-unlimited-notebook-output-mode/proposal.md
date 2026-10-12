## Why

`vscode-kdb.notebook.maxOutputRows` currently rejects `0`, even though first-party Direct IPC output already persists its complete exactly representable rich result independently of the positive helper-preview limit. At the same time, each current-session Direct IPC output also retains the raw q value in the Extension Host live-result registry, duplicating potentially large data that is already durable in the notebook; users need an explicit unlimited-persistence mode that avoids that duplicate cache while preserving fresh execution semantics.

## What Changes

- Accept `0` for `vscode-kdb.notebook.maxOutputRows` and define it as **unlimited first-party notebook output**: a successful `.qnb` or mixed-Jupyter Direct IPC execution writes the complete exactly representable MIME v2 result into the cell without applying an extension row or rich-payload byte cap.
- In that `0` mode, do not register or retain the newly returned raw q value in the session-bound live notebook result store. Inline rendering and KX Results handoff use the complete saved MIME v2 payload, and rerunning the cell issues its complete current source to q exactly once instead of recovering or reusing a prior result. A previously committed output keeps its existing live binding until a replacement commits successfully, so a failed local output edit does not degrade the still-displayed result.
- Preserve positive `maxOutputRows` behavior: the setting continues to bound only optional Python-helper Tag/Prepare preview metadata, while first-party Direct IPC rich output remains complete and retains its current live-result integration. `maxOutputBytes` continues to bound only static fallbacks and helper output, not authoritative Direct IPC MIME v2.
- Keep existing exact-representation failures explicit. Unlimited means no configured row/rich-payload truncation; it does not stringify unsupported q identity, revive IPC/session objects, or promise success beyond host/filesystem resource limits.
- Enable `vscode-kdb.features.queryHistory` by default. Users can still disable capture, an explicit stored `false` remains authoritative, retained history remains workspace-local and bounded, and no result payload, credentials, background request, or Python-owned `%%q` execution is recorded.
- Add focused regression coverage and documentation for setting validation, zero/positive mode selection, persisted/live/saved notebook behavior, KX Results handoff, fresh reruns, cache lifecycle, query-history defaulting, and compatibility with existing output identities and privacy boundaries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `notebook-q-execution`: Adds the zero-row-limit unlimited/no-live-cache mode while preserving exact saved output, fresh exactly-once execution, positive-limit behavior, and explicit differences among KX Results, current inline output, and reopened saved output.
- `runtime-sidebar-inspection`: Changes Query History capture from default-off to default-on without changing its explicit opt-out, local-storage, retention, exclusion, or rerun-safety contracts. This delta builds on the active `add-runtime-sidebar-views` change and must be reconciled with it before either change is archived.

## Impact

- Affected settings and extension-host code: the `package.json` configuration schema, `src/notebook-settings.ts`, `src/notebook-controller.ts`, the notebook live-result lifecycle/store integration, renderer-to-host action routing, and Query History feature enablement.
- Affected browser renderer behavior: zero-mode output must operate as a complete saved result without requesting a live record, while preserving grid, search, selection, copy/export, chart, sizing, and status behavior supported by complete MIME v2.
- Affected persisted contract: MIME v2 remains version-compatible and complete; output IDs remain durable, transient live IDs are absent or non-authoritative in zero mode, and previously saved v1/v2 output remains readable without migration.
- Affected tests and documentation: deterministic settings/contract/controller/renderer/integration/history tests, notebook cross-contract and relevant Extension Host coverage, `mkdocs-src/notebooks.md`, settings/performance/troubleshooting guidance, generated docs, and `CHANGELOG.md`.
- Dependencies: no new runtime dependency is expected. The Query History default change depends on the active `add-runtime-sidebar-views` capability definition being completed or reconciled.

## Non-goals

- Re-executing q automatically when a user merely opens a saved result, opens KX Results, reloads VS Code, or reopens a notebook; stateful q source runs only through an explicit execution action.
- Changing positive-limit first-party persistence into a truncated preview, removing bounded Python-helper output, or changing the separate `kx_notebook` package contract.
- Persisting Extension Host IPC handles, connection sessions, credentials, raw live q objects, sort caches, or chart sampling caches in notebook files.
- Removing renderer safety bounds for display text, copy/export, sorting, chart source sampling, or viewport requests; those operational safeguards remain distinct from authoritative result persistence.
- Changing KX Results q identity, conversion, copy/export, chart sampling, or ordinary editor-query execution behavior.

## Reconciliation with large-table persistence

The subsequent `support-columnar-notebook-results` change introduces a strict full v3 columnar format for native q tables/keyed tables above one million cells. Existing v2 format and compatibility metadata remain unchanged for ordinary output; statements above about v2 persistence apply to that original format. Complete output, optional column attributes, durable identity, zero/positive retention, ownership, passive actions, unsupported identity errors, and presentation/sampling invariants apply equally to supported full v3 output. New large-result files require the updated reader; existing v1/v2 output remains readable. No preview or Python-helper format changes.
