# Chart resampling benchmark

The maintained benchmark was run from the compiled output of each isolated tree with Node.js, 30,000 source rows, and seven measured repetitions per case:

```text
node scripts/benchmark-chart-resampling.js --module-root /tmp/vscode-kdb-v0.2.13 --label v0.2.13 --rows 30000 --repetitions 7 --output openspec/changes/restore-resampling-and-list-grid-contracts/evidence/chart-baseline-v0.2.13.json
node scripts/benchmark-chart-resampling.js --module-root /tmp/vscode-kdb-v0.2.22 --label v0.2.22 --rows 30000 --repetitions 7 --output openspec/changes/restore-resampling-and-list-grid-contracts/evidence/chart-baseline-v0.2.22.json
node scripts/benchmark-chart-resampling.js --module-root "$PWD" --label candidate-v0.2.23 --rows 30000 --repetitions 7 --output openspec/changes/restore-resampling-and-list-grid-contracts/evidence/chart-candidate-v0.2.23.json
```

The matrix covers numeric and temporal X, 1/4/8/16 Y series, initial preparation, deep refill, and 90%/70%/40% overlap pans. Times below are unweighted averages of the recorded case medians.

| Build | Full 40-case matrix | Initial preparation | Deep refill | Pan cases | Initial sampled points | 200 pointer moves |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| v0.2.13 | 36.265 ms | 41.804 ms | 18.044 ms | 40.493 ms | 2,561–2,700 | 200 scheduled / 200 applied |
| v0.2.22 | 42.053 ms | 47.044 ms | 18.786 ms | 48.145 ms | 1,874–7,000 | 200 scheduled / 200 applied |
| candidate v0.2.23 | 33.318 ms | 44.197 ms | 18.637 ms | 34.584 ms | exactly 7,000 | 3 scheduled / 2 applied |

The candidate is 8.1% faster than v0.2.13 and 20.8% faster than v0.2.22 across the maintained full workload. Pan preparation is 14.6% faster than v0.2.13 and 28.2% faster than v0.2.22. It also reduces the deterministic pointer workload from 200 viewport applications to two while synchronously preserving the final range.

Initial-only preparation is 5.7% slower than v0.2.13, while producing more than 2.5 times as many aligned points because v0.2.13 did not satisfy the required exact-7,000 density. It is 6.1% faster than v0.2.22, which still underfilled temporal cases. This is the explicit correctness/performance consequence of the approved requirement that ranges over 7,000 eligible observations return exactly 7,000 points per selected series; the aggregate interactive workload nevertheless exceeds the v0.2.13 performance target.

The candidate evidence contains 40 cases and has zero density violations: ranges at or below 7,000 retain every eligible observation and ranges above 7,000 return exactly 7,000 aligned samples.
