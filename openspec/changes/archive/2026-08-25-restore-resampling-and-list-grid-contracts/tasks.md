## 1. Establish the Target Baseline and Regression Evidence

- [x] 1.1 Establish a non-destructive implementation branch/worktree based on `v0.2.22`, carry the OpenSpec/agent setup without overwriting user changes, and verify `git merge-base --is-ancestor v0.2.22 HEAD`, `git status --short`, and the expected planning files.
- [x] 1.2 Run the unmodified `v0.2.22` `npm test` gate and capture reproducible numeric/temporal preparation, source-read, and pan-overlap baselines against isolated `v0.2.13` and `v0.2.22` modules.
- [x] 1.3 Add failing focused chart tests for exact 7,000 shared-X/multi-series output, retain-all behavior at or below 7,000, null/gap alignment, and the 3,000-point zoom threshold; verify the new assertions fail against the unmodified baseline for the intended temporal underfill cases.
- [x] 1.4 Add failing instrumented tests for temporal and numeric same-span pan reuse, asserting stable overlap and sampling level plus no full-source summary scan; verify they expose the `v0.2.22` repeated-X-read behavior.
- [x] 1.5 Add failing Results/live/saved list tests for `1 2 3`, `enlist 4`, empty/temporal typed vectors, general lists, qText choice, character-vector treatment, copy/export, and exact save/reopen identity; verify they expose the `v0.2.18+` multi-element one-cell Grid regression while locking the approved singleton one-cell exception and preserving existing portable tests.

## 2. Implement the Shared Resampling Core

- [x] 2.1 Implement a bounded source/X identity index with stable `(x, sourceRow)` ordering, invalid-X/sort metadata, binary range lookup, and explicit invalidation; verify focused tests cover sorted, unsorted, duplicate, temporal, invalid-X, and source/configuration changes.
- [x] 2.2 Implement the shared sampling-plan model and hierarchical candidate selection so ordinary ranges return all eligible observations at or below 7,000 and exactly 7,000 aligned samples otherwise; verify one, two, four, eight, and sixteen series preserve extrema, gaps, endpoints, deterministic output, and equal X/Y lengths.
- [x] 2.3 Implement epoch-anchored temporal levels with deterministic target filling and an observation-anchored non-temporal equivalent; verify dense, sparse, bursty, repeated-X, boundary, null-run, and epoch-sized fixtures satisfy the exact density and source-faithfulness scenarios.
- [x] 2.4 Replace temporal-only overlap rebuilding with bounded viewport bucket-summary reuse for compatible temporal and non-temporal pans; verify complete overlap buckets remain stable, only boundary/new indexed slices decode Y values, output stays within the density contract, and incompatible state falls back cleanly.
- [x] 2.5 Centralize the 7,000/3,000 viewport decision in shared helpers and integrate Results and live notebook hosts; verify 5,000 and 3,000 visible samples stay local, 2,999 triggers an authoritative refill, at-most-7,000 source ranges retain all observations, and panel/notebook decisions match.
- [x] 2.6 Preserve request deduplication, absolute nested ranges, source recovery, stale/failure/reset handling, hidden-series state, source guardrails, and saved-source limitations through the new plan/index lifecycle; verify the existing hosted nested zoom lifecycle and new stale/reset/cache-invalidation regressions pass.
- [x] 2.7 Update chart status and diagnostic payloads to distinguish eligible observations, aligned sampled points, family-specific visual items, and active temporal/observation sampling level; verify panel and notebook parity assertions cover the displayed semantics.

## 3. Optimize Interactive Rendering and Measure It

- [x] 3.1 Coalesce pointer-driven X scale, visible-Y, selection, and navigator synchronization to at most one pending animation-frame update while synchronously flushing the final pointer range; verify deterministic pointer move/up/cancel/reset tests retain the final range and avoid duplicate frame work.
- [x] 3.2 Add a maintained chart benchmark harness covering initial builds, deep refills, and 90%/70%/40% overlap pans for numeric/temporal X with one/four/eight/sixteen Y series; verify it reports medians, X/Y reads, density, cache reuse, retained bytes, and browser redraw/frame counts in machine-readable output.
- [x] 3.3 Run the candidate benchmark against isolated `v0.2.13` and `v0.2.22` baselines, record the exact commands/results, and do not mark this task complete if preparation misses the `v0.2.13` target unless a documented exception is approved.

## 4. Restore List Grid Presentation Without Losing Exact q Identity

- [x] 4.1 Restore cardinality-aware Grid conversion of standalone non-character typed vectors/general lists: use virtual zero-based `index`/`value` rows for two or more elements, exactly one value data cell with no index data cell for a singleton such as `enlist 4`, and an empty two-column schema for empty values; leave qText and character-vector behavior intact and verify focused q IPC/result conversion tests cover element types, source order, every cardinality case, and unrelated result shapes.
- [x] 4.2 Extend portable MIME v2 with an optional validated standalone-list presentation marker while retaining the exact vector as one authoritative portable q value; verify older payloads still validate unchanged and malformed/ambiguous markers are rejected safely.
- [x] 4.3 Derive reopened saved-notebook cardinality-aware rendering, selection, copy, export, and sizing from the decoded exact vector plus marker; verify the singleton one-cell exception, multi-element index/value layout, live/saved/Results parity, and exact type/attribute/cardinality/null/infinity/temporal-precision round trips.
- [x] 4.4 Run notebook contract and compatibility coverage with `npm run test:notebook-cross` and relevant historical payload fixtures, verifying one-cell vector-valued tables without the marker are not misclassified.

## 5. Document and Lock the Contracts

- [x] 5.1 Update chart and result-display documentation sources with the approved density/refill/pan and list-grid behavior, regenerate derived docs through the repository workflow, and verify source/generated documentation consistency checks pass.
- [x] 5.2 Update `AGENTS.md` with a concise requirement to read applicable main and active OpenSpec capability specs before changing chart sampling or result presentation, without duplicating thresholds/algorithm prose; verify it points to `openspec/specs/` as the post-archive source of truth.
- [x] 5.3 Add a changelog entry describing the corrected resampling density/performance and restored list grid, including preserved exact notebook identity; verify version/history documentation names both user-visible regressions accurately.

## 6. Complete Cross-Surface Verification

- [x] 6.1 Run `npm test` and resolve every focused chart, list, portable, lifecycle, parity-contract, and manifest failure without weakening an approved scenario.
- [x] 6.2 Run `npm run test:notebook-cross`, `npm run test:parity:self`, and the relevant Extension Host/live-q/visual gates available in the environment; record exact commands, outcomes, and any environment-only blocker.
- [x] 6.3 Validate the OpenSpec change strictly, review the final diff for unrelated or generated-file drift, and confirm every task and specified scenario has automated coverage or an explicit manual verification record before requesting archive.
