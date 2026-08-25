## Why

The `v0.2.22` chart path can render fewer than 3,000 sampled temporal points even when a selected range contains well over 7,000 eligible source observations, while its overlap cache can perform more work than a clean rebuild. Separately, multi-element typed q vectors stopped appearing as index/value rows in grid mode in `v0.2.18`, weakening a previously useful result-view contract.

## What Changes

- Define one shared 7,000/3,000 chart-density contract for the KX Results panel and live notebook charts: retain all eligible observations at or below 7,000; otherwise produce exactly 7,000 aligned samples for every selected series.
- Keep zooming local while at least 3,000 retained samples remain visible, then refill the selected range to all available observations or exactly 7,000 samples from the authoritative source.
- Preserve a compatible temporal sampling level across same-span pans, reuse the retained overlap exactly, and sample only newly exposed source regions at the same time density.
- Define a deterministic observation-based equivalent for non-temporal X axes.
- Make chart preparation and pan refinement bounded and benchmarked, avoiding repeated full-source scans and targeting `v0.2.13` preparation performance or better without weakening the density or correctness contract.
- Restore standalone q lists/vectors in Grid mode as zero-based `index` and `value` rows when they contain multiple elements, while presenting a singleton such as `enlist 4` as one data cell containing `4`; preserve typed-vector identity in exact saved notebook output in every case.
- Strengthen repository guidance so agents must consult the applicable OpenSpec capability before changing these behaviors; detailed requirements remain single-sourced in `openspec/specs/` rather than duplicated in `AGENTS.md`.
- Preserve existing chart extrema/gap semantics, absolute-range/stale-response/reset behavior, chart-family constraints, q value identity, portable MIME compatibility, and saved-notebook round trips.
- Non-goals: changing q query execution, increasing the 7,000-point chart ceiling, fabricating values for null source observations, or changing table/dictionary/keyed-table presentation.

## Capabilities

### New Capabilities

- `chart-resampling`: Shared density, zoom-refill, stable-pan, multi-series alignment, correctness, and performance requirements for chart sampling.
- `q-list-grid`: Grid presentation and exact-persistence requirements for standalone q lists and typed vectors.

### Modified Capabilities

None. This repository does not yet contain main capability specs for these behaviors.

## Impact

- Chart source preparation and viewport lifecycle in `src/charting.ts`, `src/chart-zoom.ts`, `src/kx-results-panel.ts`, and the notebook live-result host/renderer paths.
- Chart regression, parity, lifecycle, and performance tests in `test/`.
- q IPC-to-panel conversion, live notebook result conversion, saved portable-v2 representation/rendering, and their parity/round-trip tests.
- `AGENTS.md`, chart/result documentation sources, and generated documentation where required.
- Implementation must target the `v0.2.22` lineage (`68be68b`, whose chart implementation originates in `a513c1f`); the current checkout is `v0.2.18`, so the apply phase must first use or establish the intended `v0.2.22`-based branch without discarding existing OpenSpec work.
