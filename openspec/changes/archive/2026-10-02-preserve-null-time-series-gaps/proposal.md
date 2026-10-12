## Why

Null time-series observations must leave gaps. The current gap scan uses only X comparisons, so nulls sharing a normalized timestamp with a neighbouring finite observation can be missed. Temporal pan merging can drop gaps from later pieces or lose a break at the refill boundary. Static notebook SVG also discards null rows then joins the remaining points.

## What Changes

- Preserve null/non-finite discontinuities by stable source occurrence, including duplicate/normalized temporal X, in Results, live and saved line/step charts.
- Keep missing values unplotted and split static line/step paths at missing values, including nulls skipped by bounded static sampling. Preserve genuine zero and negative-zero values.
- Preserve grouped structural-hole continuity, exact 7,000/3,000 density/refinement rules, per-series alignment, finite duplicates/extrema, source-domain and lifecycle policies.
- No query rerun, value substitution, rounding, storage migration, new MIME or dependency. Family aggregation and null OHLC error policies remain unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chart-resampling`: explicitly preserve temporal null gaps across duplicate occurrences and interactive/static surfaces.

## Impact

Shared chart gap detection, grouped occurrence source identity, pixel gap clipping, static notebook SVG numeric conversion/path segmentation, focused q-null/source and real-browser regressions, documentation. Native storage and retained source values remain unchanged.
