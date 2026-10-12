# Verification — 0.2.43 null time-series gaps

## Existing behavior and confirmed failures

Ordinary null gaps already existed; this change preserves that policy. The user's red-marked step-chart image shows apparent horizontal bridges. The owning container still has 0.2.40 installed; its saved notebook has a different 600k × 14 schema, so the screenshot's actual Y values and exact root cause were not verified. No container installation, query, user-data write or inspector change occurred in this task.

Independent local reproductions confirmed: typed q nulls sharing normalized timestamps with a finite neighbour lose `gapBefore`; static notebook SVG discards null rows then joins finite points; cached temporal pan output loses a later piece's gaps if the first piece has no gap metadata. The duplicate-time and cached-pan assertions failed before their corresponding fixes; the static defect was established from the previous one-path code and verified with focused finite-run regressions. Missing finite boundary context already produces a correct clean rebuild, which is explicitly preserved rather than replaced.

## Changes and preservation

Shared gap detection now compares stable source occurrences, with per-series origin metadata for null-bearing grouped line/step alignment. Both actual renderers use a shared stroke-aware nonzero pixel clip for coincident real gaps. Temporal merge includes gap metadata from every piece and carries breaks over omitted merge samples, using only retained records. Static line/step SVG uses shared scalar normalization, splits finite runs and carries gaps over its unchanged 240-source-sample thinning. Invalid X values are dropped consistently with interactive chart semantics.

Numeric Y decoding avoids constructing unused formatted X-style value/text objects. Scalar conversion, null/non-finite policy and finite values are unchanged. Genuine zero/negative-zero, all 7,000/3,000 density/refill rules, groups/structural holes, extrema, duplicate finite occurrences, pan overlap, cached source-read rules, stale/reset behavior, exact MIME/storage/keys/attributes and query ownership remain intact. No finite value is substituted to create a gap. Existing chart families retain their null/OHLC/aggregation contracts.

## Verification

- `npm test`: passed full repository confidentiality, TypeScript host/language/renderer compilation, Results display and packed-codec suites, all 54 runtime groups, constrained-heap legacy v2 and packed v4 save fixtures, and language-server IPC smoke at 0.2.43.
- `VSCODE_KDB_TEST_FILTER='null time-series' node test/run.js`: passed focused duplicate/equal temporal coordinates, independent series/groups, genuine zeros, omitted all-null rows, later-piece cached temporal pan, safe boundary-context fallback, eight-series bounded pan merge thinning, and v1/v2/v3/v4 static save/reopen compatibility. The final thinning assertion was added after the full gate and passed against the same compiled production code.
- Existing density/refinement/overlap/source-read, live/saved ownership, chart family/grouping and symbol presentation regressions all passed unchanged.
- `VSCODE_KDB_LIVE_REQUIRED=1 node test/live/run.js`: passed local q 5 IPC, including an actual time-vector table with float `0n` between finite values at repeated milliseconds. Line/step preserve `[0,null,2]` and the break; the other series remains continuous. This is not an old-q-runtime or installed-container chart acceptance claim.
- Real Chromium `test/results-display-browser.js`: passed production panel/notebook gap refiners under actual uPlot line/step paths for long and coincident gaps at DPI 1 and 2. Path clipping rejects a point inside each missing stretch and admits a point on a finite run. All 16 cases pass. Existing autofit/axis, saved v3/v4 scroll/settings/paging/sort/Results, and standalone-symbol qText/export checks also passed. Evidence `/tmp/kx-results-display-qpu0OO`.
- Cached pinned MkDocs strict build plus generated-output cleaning passed; chart docs and changelog synchronized.
- OpenSpec strict change and all nine main spec validations passed; new requirement appended without weakening old scenarios. `git diff --check` passed.

## Performance evidence

Same installed Node 24 binary, 30,000 rows and seven repetitions per case; isolated native builds of v0.2.13/v0.2.22 from Git tags, pre-fix compiled 0.2.42 snapshot, and completed current build. Each matrix has 40 numeric/temporal initial/refill/compatible-pan cases with 1/4/8/16 selected series. Earlier concurrent-build measurements were diagnostic only; final accepted results below were run after other verification jobs completed. Raw content-free JSON is in `evidence/`.

Command form: `node scripts/benchmark-chart-resampling.js --module-root <isolated-tree-or-repository> --label <version> --rows 30000 --repetitions 7 --output <report>`.

| Build | Mean of case medians (ms) |
| --- | ---: |
| v0.2.13 | 64.456 |
| v0.2.22 | 76.591 |
| pre-fix-0.2.42 | 67.052 |
| 0.2.43 | 32.228 |

All 40 final cases have identical X/Y source-read counts, eligible/sample counts, algorithm, interval and pan reused/built counts to the pre-fix snapshot. Final preparation exceeds both historical aggregate targets while retaining the required exact 7,000 density. The unchanged deterministic browser-frame model applies two of 200 moves using three scheduled frames; real renderer gap clipping is verified separately above. These are reproducible local measurements, not a latency guarantee on another machine.

## Release

Audited local full-working-tree 0.2.43 VSIX and one-member ZIP built successfully. `npm run package:vsix` passed repository, compiled-output and VSIX confidentiality audits. `python3 scripts/audit-release.py vscode-kdb-0.2.43.vsix vscode-kdb-0.2.43-vsix.zip` passed (20 VSIX files, two compiled modules, zero runtime package directories, exact raw VSIX in the single-member ZIP). No publishing, permanent install, Git commit/tag or user notebook overwrite.

- vscode-kdb-0.2.43.vsix: 1600451 bytes; SHA-256 `4d49fa816b9cc72858bdf602ec7fa8528ae504c9fee01783693c1e7010b1370e`.

- vscode-kdb-0.2.43-vsix.zip: 1600082 bytes; SHA-256 `de77f58917428ad11a1ff673397d82e1a1ed56692d03498c9b652e4479faa81c`.
