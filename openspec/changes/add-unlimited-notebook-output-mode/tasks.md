## 1. Lock the settings and persistence contracts with tests

- [x] 1.1 Add focused notebook-settings and manifest regressions proving `maxOutputRows` accepts safe integer `0`, retains the existing default and upper bound, rejects/normalizes invalid values deterministically, and uses a positive `20`-row fallback for Python-helper Tag/Prepare output when the setting is zero.
- [x] 1.2 Add portable-contract regressions proving zero-mode Direct IPC tables, standalone lists, and qText persist complete exact MIME v2 beyond the configured row/rich-payload byte values while static `text/plain` remains bounded, exact-representation failures stay explicit, and the serialized v2 limit fields remain readable by the existing validator.
- [x] 1.3 Add Query History configuration regressions proving the manifest and runtime fallback default to enabled, an explicit `false` remains disabled across reconciliation/reload, and storage/exclusion/retention behavior is unchanged.

## 2. Implement the shared zero/positive output policy

- [x] 2.1 Extend `src/notebook-settings.ts` with the validated zero/positive policy and a separate positive helper-preview limit, then update the configuration schema and setting descriptions without changing `maxOutputBytes` semantics.
- [x] 2.2 Keep complete MIME v2 schema-compatible by mapping zero to positive compatibility metadata during portable creation while leaving authoritative full table/list/qText serialization unbounded and static fallback creation byte-bounded.
- [x] 2.3 Split durable output-binding metadata from optional live-result metadata so a valid complete output can be matched, saved, reopened, and handed to KX Results without a live ID.

## 3. Apply the no-live-cache lifecycle to both notebook routes

- [x] 3.1 Refactor shared direct-q result preparation/materialization so positive mode preserves register/stage/rebind behavior and zero mode commits the same complete items/output identity without registering, staging, binding, or retaining the raw `QValue`.
- [x] 3.2 Cover dedicated `.qnb` and mixed-Jupyter execution, including text/command focus, local output retry, write rejection, cancellation, stale completion, and switching a cell from positive to zero mode; prove zero mode creates no record for the new result and every explicit run issues current q source exactly once.
- [x] 3.3 Preserve prior-record cleanup on successful rerun, output clear/removal, cell removal, notebook close, eviction, and deactivation; prove a former positive-mode live ID cannot reach a successfully committed zero-mode output, while a failed replacement keeps the still-displayed prior output's valid live binding.

## 4. Preserve renderer and KX Results behavior without a live record

- [x] 4.1 Update or confirm renderer state classification so a newly committed zero-mode output immediately renders as complete saved MIME v2, sends no live-result request, and retains supported grid, search, selection, sizing, copy/export, qText, and chart behavior under existing operational safeguards.
- [x] 4.2 Add current-session and save/close/reopen regressions proving zero-mode output remains complete, durable identity matching survives, no transient handle is persisted/revived, and historical v1/v2 previews plus positive-mode complete outputs remain compatible.
- [x] 4.3 Verify **Open in KX Results** reconstructs the complete zero-mode MIME v2 payload without live-store access or q execution, while **Rerun cell** makes one fresh direct-q request with current source and fresh output identity; preserve ordinary Results conversion, copy/export, charts, sampling, and stale-request guards.

## 5. Enable Query History by default and reconcile its active contract

- [x] 5.1 Set `vscode-kdb.features.queryHistory` to default true in `package.json` and every runtime fallback, without writing settings during activation or overriding an explicit false value.
- [x] 5.2 Preserve enabled history capture for actually issued editor and first-party notebook commands only, including exactly one entry across output retries and no entries for result payloads, zero-mode MIME data, credentials, internal metadata/preview work, rejected-before-issue runs, or Python-owned `%%q`.
- [x] 5.3 Reconcile the active `add-runtime-sidebar-views` proposal/spec/design/tasks/tests with the default-on explicit-opt-out contract, keep its remaining task checkbox accurate, and ensure the two active changes contain no contradictory archival intent.

## 6. Documentation and verification

- [x] 6.1 Update `mkdocs-src/notebooks.md`, settings/performance/troubleshooting guidance, and `CHANGELOG.md` with zero-mode cost, full persistence, no-live-cache behavior, explicit fresh reruns, positive/helper limits, exact failures, and default-on local Query History plus opt-out; regenerate `docs/` with strict MkDocs validation.
- [ ] 6.2 Run the focused deterministic notebook settings/contract/controller/integration/renderer and Query History tests, then run `npm run test:notebook-cross` and `npm run test:parity` for persisted-output and Results-surface compatibility.
- [ ] 6.3 Run `npm test`, the relevant real Extension Host notebook smoke, and `npm run test:notebook-results-visual`; record any environment-only coverage limitation rather than weakening the specified contract.
- [x] 6.4 Run `npm exec --no -- openspec validate add-unlimited-notebook-output-mode --strict` and `npm exec --no -- openspec validate --all --strict`, confirm every task and cross-change reconciliation item is accurate, and leave archival until implementation and verification are complete.

Verification note: focused deterministic suites, `npm test` (with only the pre-existing untracked `.codex-work-kdb-sqltools/` nested worktree temporarily placed in the local Git exclude so the confidentiality scanner does not treat its directory entry as a file), strict MkDocs build, packaging audits, and `test:notebook-cross` pass. The local exclude was restored afterward. Parity compiles both products and passes its support and complete standalone focused phases against a disposable pinned reference, but the installed q 5.0 Community runtime resets the required immediate live-q handshake. Extension Host cannot start because no compatible Linux VS Code runtime is installed, and notebook visual acceptance cannot start because `/usr/bin/Xvfb` is absent. These environment limitations leave 6.2 and 6.3 unchecked.
