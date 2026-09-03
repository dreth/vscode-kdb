## Context

See `proposal.md` for motivation and the two delta specs for the behavior contract.

The chart work must be implemented on the `v0.2.22` lineage. That lineage introduced visible-count hysteresis and temporal overlap reuse in `a513c1f`, but the current checkout is `v0.2.18`; implementation must therefore begin from a new branch based on `v0.2.22` (or an explicitly approved equivalent integration) while carrying this OpenSpec change forward.

In `v0.2.22`, ordinary numeric sampling fills a shared aligned sample to 7,000 points, but temporal min/max buckets can return substantially fewer points. The temporal reuse path rebuilds boundary contexts and then performs a request-summary pass, causing about three complete X reads for one pan in the investigated fixture. Results-panel and notebook viewport code independently decides when to request refinement, and pointer movement continuously redraws X/Y scales and navigator state.

Typed q vectors became explicit runtime values in `v0.2.18`. The normal grid conversion then treated a vector as one `value` cell so exact notebook persistence could retain outer vector identity. Before that release, list-like values expanded to zero-based `index`/`value` rows. Portable MIME v2 currently has an exact typed-cell representation but does not retain a distinct logical presentation marker for a standalone vector.

## Goals / Non-Goals

**Goals:**

- Establish one shared sampling plan and zoom decision for Results and live notebooks.
- Produce the exact aligned density defined by `chart-resampling/spec.md` while retaining per-series extrema and gaps.
- Reuse compatible pan work without repeated full-source scans.
- Reduce preparation cost toward or below the measured `v0.2.13` baseline and bound continuous interaction work to one browser frame.
- Separate q vector presentation from q vector persistence so cardinality-aware grids and exact round trips coexist.
- Make the archived capability specs the durable source of truth consulted by future agents.

**Non-Goals:**

- Raising chart source-row or rendered-point ceilings.
- Changing q execution, IPC wire decoding, or the meaning of q values.
- Replacing uPlot or redesigning chart controls.
- Applying ordinary point-count semantics to bar, box, or candlestick aggregation.
- Expanding character vectors that represent q strings into character rows.

## Decisions

### 1. Implement from the `v0.2.22` lineage

Create the implementation branch from `v0.2.22` and transfer the OpenSpec/agent setup without dropping unrelated `v0.2.20`-`v0.2.22` result and connection behavior. Verify the branch ancestry and a clean baseline test run before editing.

This is preferred to reimplementing selected `v0.2.22` behavior on `main` because the requested regression exists specifically in the later sampling lifecycle and its tests. Cherry-picking only chart hunks would risk omitting notebook-contract and result changes on which the later tests depend.

### 2. Make one shared sampling policy object authoritative

Introduce a host-neutral sampling plan carried with chart data and viewport cache state. It records:

- source/configuration identity;
- X kind and absolute source domain;
- target 7,000 and refill threshold 3,000;
- temporal epoch interval/phase or non-temporal observation bucket level;
- stable candidate ordering and gap/extrema policy;
- eligible and sampled counts.

`src/charting.ts` remains the authoritative data-preparation implementation and `src/chart-zoom.ts` remains the authoritative viewport decision helper. Results and notebook hosts call those shared helpers; renderer code reports interactions and renders returned data rather than defining another density policy.

The alternative—patching the Results and notebook conditions separately—is rejected because it recreates the parity risk that OpenSpec is intended to prevent.

### 3. Build and reuse an X-range index per source identity

Normalize X once for a result version and X column into a bounded index of `(x, sourceRow, xText)` entries. Preserve original row identity, and sort the index by `(x, sourceRow)` only when required. Store invalid-X counts and sort metadata with the index. Use binary searches to locate absolute ranges.

Y values remain lazily decoded for the selected range/configuration. This avoids a potentially huge `rows × selected-series` cache while eliminating complete X rescans on every zoom. Index state is invalidated when the result version/source, X column, source guardrail, or normalization contract changes.

The alternative—keeping the `v0.2.22` edge rebuild plus full summary scan—is rejected because measured reuse performed roughly three X-source traversals and was slower than a clean build even with sixteen Y series.

### 4. Use stable hierarchical bucket summaries with deterministic filling

For an ordinary range, produce ordered candidate row identities per stable bucket:

1. applicable first/last boundary observations;
2. each selected/generated series' finite minimum and maximum;
3. real source-gap anchors;
4. deterministic evenly distributed fillers.

Select candidates into one shared X index set, then fill deterministically to `min(eligibleCount, 7_000)`. Construct every series from that shared ordered set, retaining null/gap values rather than fabricating finite observations.

Temporal plans use epoch-anchored time buckets. The interval is selected from the source span/density and becomes part of the sampling level. Non-temporal plans use buckets anchored to stable sorted observation ordinals. A same-span compatible pan retains summaries and selected identities for complete overlapping buckets, drops exited buckets, builds only boundary/new buckets from indexed source slices, and fills remaining target slots using the same candidate ordering. Boundary buckets may be rebuilt because their viewport membership changes; retained point identities and values are never recomputed from a prior sample.

This hierarchical plan reconciles exact target filling with stable pan density: extrema and gaps have priority, ordinary candidates fill unused capacity, and a fixed bucket level prevents the temporal strategy from choosing a new resolution merely because the viewport moved.

### 5. Keep 7,000/3,000 as a count-based state machine

On a completed viewport interaction, count retained X samples inside the absolute range:

- `visible >= 3_000`: render locally and do not request source data;
- `visible < 3_000`: query the indexed authoritative range, returning all eligible observations at or below 7,000 or exactly 7,000 otherwise.

The state machine does not count gestures and does not require an artificial intermediate count. A user's `7,000 → 5,000 → 3,000` sequence is one expected consequence of local subsets, not a prescribed decrement.

Deduplication, active request IDs, stale response rejection, immutable full-data reset, and absolute ranges continue through the existing zoom lifecycle reducer.

### 6. Bound browser interaction work to animation frames

Coalesce pointer-driven plot scale changes, visible-Y recomputation, and navigator DOM synchronization through one pending `requestAnimationFrame` update per chart. Completion still settles the exact final range and enters the shared 7,000/3,000 decision. Precompute or incrementally retain the extent metadata needed by custom chart families so a frame does not repeatedly traverse more data than the returned sample.

This preserves live panning while addressing the redraw cost introduced after `v0.2.13`. Disabling live panning is rejected because it removes requested behavior rather than optimizing it.

### 7. Make performance evidence a regression gate

Add a deterministic benchmark harness, separate from correctness assertions, with fixed generated numeric and temporal data. It reports medians after warm-up for initial render preparation, deep zoom refill, 90%/70%/40% overlap pans, and one/four/eight/sixteen selected Y series. It also records X/Y accessor counts, sampled counts, cache reuse, and a browser interaction trace for redraw/frame work.

Compare the candidate against isolated `v0.2.13` and `v0.2.22` builds. The implementation may not claim completion when the `v0.2.13` preparation target is missed unless a documented exception records the measured trade-off. Correctness tests remain deterministic and mandatory regardless of benchmark variance.

### 8. Separate standalone-vector presentation from exact storage

For live conversion in Grid mode, use a cardinality-aware presentation adapter. A typed vector/general list with two or more elements becomes a virtual columnar result with `index` and `value` columns and one row per element. A singleton becomes one `value` data cell containing the sole element, without a separate index data cell. An empty list/vector retains the two-column schema with no rows. Element access preserves q-aware display and source order, while the adapter always retains the unchanged source list/vector. qText conversion continues to format that unchanged source value.

For portable MIME v2, continue storing the standalone typed vector once as an exact portable q cell. Add a backward-compatible optional logical-presentation marker identifying an exact standalone list/vector intended for list-grid display. On reopen, validate and decode the exact vector first, then expose the same cardinality-aware adapter for rendering, copy, selection, and export. Payloads without the marker retain their historical interpretation, so a real one-cell table containing a vector is not misclassified.

The alternative—persisting the expanded rows as the authoritative value—is rejected because it loses outer type, attribute, singleton `enlist`, and other exact q identity. Guessing from a one-cell payload without a marker is rejected because it cannot distinguish a standalone vector from a vector-valued table cell.

### 9. Keep capability details single-sourced

After validation and implementation, archive this change so `openspec/specs/chart-resampling/spec.md` and `openspec/specs/q-list-grid/spec.md` become the main requirements. Update `AGENTS.md` only with a concise instruction to read applicable main and active-change specs before modifying chart sampling or result presentation and never silently weaken them. Do not copy numeric thresholds or algorithm prose into `AGENTS.md`; duplication would allow the files to drift.

## Risks / Trade-offs

- **[Risk] Exact 7,000 filling and fixed temporal density can compete on highly irregular/sparse time distributions.** → Use stable hierarchical bucket candidates, preserve existing overlap identities first, and fill remaining capacity deterministically without changing the temporal interval; add adversarial sparse/bursty fixtures.
- **[Risk] An X index adds memory to already large results.** → Store only normalized X, source row identity, bounded text/metadata, measure retained bytes, and keep one index per active result/X identity with explicit invalidation.
- **[Risk] Lazily decoded Y values can still dominate wide charts.** → Decode only selected series and indexed range rows, reuse complete bucket summaries, cap selected series using existing limits, and report accessor counts by series count.
- **[Risk] Animation-frame coalescing can lose the final pointer position.** → Keep the latest pending range, synchronously flush it on pointer completion, and test pointer-up/cancel/reset races.
- **[Risk] Portable-v2 validation is strict and a new marker could break old readers.** → Make the field optional, preserve existing payload semantics when absent, update strict validators and compatibility tests, and retain a rollback path that ignores the marker while keeping exact data readable.
- **[Risk] Branching from `v0.2.22` can conflict with current uncommitted OpenSpec setup.** → Verify status, create a non-destructive branch/worktree strategy, transfer only the known planning/setup files, and never reset or overwrite user changes.

## Migration Plan

1. Establish a new implementation branch from `v0.2.22`, preserve the current OpenSpec/agent additions, and run the unmodified `v0.2.22` suite and benchmark baseline.
2. Land regression tests and benchmark/read-count fixtures before or alongside shared sampler/index changes.
3. Migrate Results and live notebook hosts to the shared plan/index and then coalesce renderer interaction work.
4. Add the optional portable-v2 list presentation marker and migrate live/saved list adapters together with backward-compatibility coverage.
5. Update documentation and `AGENTS.md`, run focused/parity/portable/Extension Host gates as applicable, then run full `npm test` and benchmark comparisons.
6. Roll back by reverting the implementation commits; the optional portable marker remains safely ignorable and no q source data or notebook value needs destructive migration.
