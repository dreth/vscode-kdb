## Context

The shared chart builder already excludes typed q nulls and non-finite Y, emitting aligned `gapBefore` for omitted null rows. Its strict X-only scan misses source occurrences at either endpoint timestamp. Grouped aligned slots can originate from different source rows per series. Temporal pan merging copies gap metadata only if the first piece already has it; later-piece gaps can vanish. A refill with no finite boundary context already falls back to a correct clean build; preserve that behavior. uPlot ignores zero-width clip gaps. Static notebook SVG separately converts text to numbers, omits nulls and draws one path per series.

## Goals / Non-Goals

Correct real null discontinuities without changing finite values, sampling selection, 7,000/3,000 budgets, cache reads, grouping semantics, saved MIME or query lifecycle. Null OHLC validation and family-specific aggregation remain unchanged. Existing structural holes from other groups continue to be skipped, not converted to real gaps.

## Decisions

- Track source occurrence identity for finite grouped aligned values only when line/step gap preservation is needed; ungrouped samples use their existing source row identity. Scan nulls in stable (normalized X, source occurrence) order, keeping a monotonic scan per series. An X-only interval is insufficient when timestamps normalize equally.
- Preserve gap metadata from every pan piece regardless of the first piece, retain the existing safe clean rebuild for missing boundary context, and propagate breaks across bounded merge thinning. Do this over retained samples, with no full source rescan. Preserve overlap selection and existing density.
- Use a shared pixel-gap helper for the two renderers; a real gap whose endpoints occupy the same pixel gets a small stroke-aware clip interval rather than a zero-width interval uPlot ignores. No marker or fabricated Y value is emitted. Main plot/navigator gap policies stay aligned.
- Avoid allocating formatted X-style value/text objects while decoding numeric Y values; keep the same scalar/null/non-finite normalization. This preserves chart meaning and offsets existing preparation overhead revealed by current-machine baseline comparisons.
- Share scalar chart coordinate normalization with static SVG. Retain its existing 240-point bound and finite-point geometry, split each series into runs and carry null breaks over omitted sampled rows. Genuine zero/negative zero remain valid; q null/non-finite/empty values never become zero. Static grouped/box/candlestick limitations remain explicit.
- Cover typed q nulls, duplicate temporal X, groups, per-series gaps, source-edge nulls, downsampled null runs, zeros, static v1/v2/v3/v4 reopening and real-browser line/step clipping on panel/notebook surfaces. Compare current chart benchmark with the pre-fix build; sampling caches and source-read counts must remain unchanged. Preserve historical baseline acceptance documented in the existing chart change.

## Risks / Trade-offs

Grouped source identity adds bounded per-point metadata only on null-bearing line/step charts. Verify group origin independently for each series. A zero-width discontinuity needs a tiny visible clip; verify at device pixel ratios 1 and 2 and retain adjacent finite observations. Static gap detection scans retained output once, rather than eagerly materializing rows.

## Migration Plan

No persisted migration or rerun is required for interactive chart derivation; existing saved tables derive correct gaps with the updated reader. Existing HTML snapshots require regeneration. Verify and document the fix, synchronize specifications and archive after completion. Build audited local release artifacts under the prior release authorization; no permanent install, publishing or user notebook overwrite.
