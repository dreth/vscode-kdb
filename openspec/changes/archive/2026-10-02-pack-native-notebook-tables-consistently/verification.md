# Verification — 0.2.42 consistent native-table packing

## Diagnosis and implementation

The installed container extension is 0.2.40. Its one-million-outer-cell format cutoff sends 60k × 14 (840k cells) through verbose v2 typed-cell storage and 600k × 14 through packed v4. Nested vectors greatly amplify the v2 wrappers. The user's current notebook contains one large result, not duplicate cached output.

Removed only the native-table cardinality test and unused internal constant. All native tables/keyed tables with authoritative matching typed q columns now use the existing exact v4 writer; codec and renderer are unchanged. Non-table output, standalone symbol/list markers, plain-row fallback v2, old v1/v2/v3/v4 readers, keys/attributes, action ownership, zero/positive retention and chart sampling remain intact. Existing files do not migrate until rerun.

## Actual Dev Container reproduction

User explicitly authorized controlling/reproducing in the running container. The running Extension Host had no open clients, so its existing analytics-7008 profile was opened through the real ConnectionManager, preserving active selection/settings. Exactly two notebook-source queries ran sequentially: 60k then 600k, on the same client. Source and result values were never printed. Query times were 13.501 s and 24.003 s.

Used real VS Code NotebookCellOutput factories and the installed QnbNotebookSerializer; loaded the updated bundled producer temporarily in that same Extension Host. For each result, both producers saved only temporary files, reopened through the serializer and compared every outer cell's canonical q node deeply against the native result, including every nested element and vector attribute.

| Rows × columns | Producer | MIME | Complete file bytes | MiB | Encoding ms | Serialization ms | Disk write ms | Reopen/validate ms | Exact cells checked |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 60000 × 14 | installed | v2 | 80775721 | 77.033731 | 12679 | 5694 | 285 | 10055 | 840000 |
| 60000 × 14 | updated | v4 | 2147889 | 2.048387 | 3202 | 48 | 3 | 644 | 840000 |
| 600000 × 14 | installed | v4 | 21043817 | 20.068948 | 15410 | 682 | 12 | 5422 | 8400000 |
| 600000 × 14 | updated | v4 | 21043817 | 20.068948 | 14974 | 676 | 33 | 5399 | 8400000 |

60k rich MIME bytes fell from 80,767,025 to 2,139,193. Both 600k producers produced 21,035,118 rich bytes. Timing includes real encoding, validation, serialization and a local container temporary disk write; it does not claim Jupyter file-writer UI acceptance or installation of the new extension. Measurements are one run, not a benchmark guarantee. Exact full-cell checks passed for all 840,000/8,400,000 cells under both producers.

The original user notebook SHA-256 remained `69ffb92b3fb3a4e7f8b04061dc83250d54f01811eb6b240bcb8e2d93720bfa8f`. Active selection was unchanged and both queries reused the same client. Closed only the reproduction-created connection, removed all container scripts/output files and global references, and closed the loopback inspector without restarting VS Code. Container installation and user notebook were untouched.

## Gates

- `npm test`: passed repository confidentiality, compile host/language/renderer, Results display and packed-codec suites, all 53 focused runtime groups, constrained-heap v2/v4 save/reopen fixtures and language-server IPC smoke.
- New producer regressions exercise 0/1/60k/71,428/71,429 × 14 native tables in zero and positive modes, forbid native row materialization, preserve exact long/nested-vector/attribute cells after validation and retain plain-row fallback v2. Existing attributed keyed controller assertions use shared cell accessors and still preserve exact symbol cells and keys. Existing standalone-symbol/list contracts pass unchanged.
- Real Chromium `test/results-display-browser.js`: passed Results settings/axis/autofit and saved v3/v4 grid scroll, settings refresh, paging, sorting and Results handoff; saved standalone-symbol qText/export/Results actions also passed. Evidence `/tmp/kx-results-display-TVrZZ5`.
- `VSCODE_KDB_LIVE_REQUIRED=1 node test/live/run.js`: passed real local q 5 IPC and existing typed values, attributes, qText/list and complete-source cases. This is not an old-q-runtime claim.
- Constrained heap fixtures: legacy v2 60k save still passes under 384 MiB heap; packed 600k × 14 remains 5.179319 MiB under 1 GiB heap (save 109 ms, write 5 ms). The legacy fixture is retained for old-format compatibility, not current native producer selection.
- Strict MkDocs generation passed using existing cached environment; generated docs cleaned/synchronized.
- OpenSpec strict change validation and all nine main capability specs passed. Main requirement merge preserved every earlier scenario; active compatibility deltas/designs explicitly reconcile all-cardinality native packing.
- `git diff --check`: passed.

## Release

Local full-working-tree 0.2.42 VSIX and one-member ZIP built successfully. `npm run package:vsix` passed repository, compiled-output and VSIX confidentiality gates; `python3 scripts/audit-release.py vscode-kdb-0.2.42.vsix vscode-kdb-0.2.42-vsix.zip` passed (20 VSIX files, two compiled modules, zero runtime package directories, exact single-member raw VSIX wrapper). No permanent install, publishing, Git commit or tag.

- vscode-kdb-0.2.42.vsix: 1599534 bytes; SHA-256 `a692f96edcbcf00f65123a65d319eaf0c87236d7fc18b7654377c5a2effa0f9a`.

- vscode-kdb-0.2.42-vsix.zip: 1599131 bytes; SHA-256 `57708ea455361e0e3d3d5710a5fd40a966cde7b2c5611da54dd3428c6036291b`.
