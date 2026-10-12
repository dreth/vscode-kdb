# Verification — 0.2.40 exact packed notebook columns

## Behavior and compatibility

Large native q tables/keyed tables (>1,000,000 outer cells) now emit strict complete v4 `packed-q-columns`. Ordinary outputs stay v2. Existing v1/v2/v3 readers, Python-helper v1 previews, standalone lists/qText, column/key attributes, full output identity, transient zero/positive retention, stale/foreign/clear/close rules, Results handoff, exports and chart sampling remain intact. Unsupported packing shapes keep exact portable q columns. Existing output is not migrated on open/save; new v4 rich output requires 0.2.40+.

The codec preserves ragged vector boundaries and attributes, constants, canonical 64-bit values, reversible decimal scaling and exact floating IEEE residuals/binary fallback, and explicit q specials. Strict base64/inflation, numeric bounds, complete byte consumption and mutation-cache regressions reject corrupt output. No truncation, fixed file byte cap, sidecar or passive q execution was introduced.

## Actual saved-file test

An isolated Node test read the existing 600,000 × 14 notebook in the user's running Dev Container, converted its v3 complete output using the current v4 codec, and compared every scalar, nested vector type/length/attribute, schema, keys, result metadata and provenance. It exercised current `.qnb` serializer save/write/reopen on a temporary file and validated byte-identical rich MIME, unchanged durable ID and canonical ownership after reopen. It used standalone notebook factory mocks, not the installed Extension Host/Jupyter writer. Source SHA-256 was unchanged before/after; q executions: 0. Temporary container scripts/output were removed. No permanent installation, user-file overwrite or external publish occurred.

| Measurement | Outcome |
| --- | --- |
| Scalar values checked exactly | 20,340,848 |
| Nested numeric vectors | 2,400,000 |
| Original notebook | 292,389,037 bytes / 278.843915 MiB |
| Updated complete notebook | 21,097,682 bytes / 20.120317 MiB |
| Prior gzip-JSON baseline | 32.694697 MiB |
| Existing-output conversion | 22,760 ms |
| Subsequent `.qnb` serialization | 222 ms |
| Complete diagnostic including original read/validation/comparison/reopen | 49,330 ms |
| Diagnostic RSS including multiple comparison buffers | 1,678 MiB |

The actual floats scale exactly to three decimal places, so the added lossless prediction mode did not further reduce this file. Content-free int64 measurements found delta-of-delta worse than ordinary deltas and fixed/XOR encoding offered little total benefit; those modes were not added. These are measurements of this data/machine, not guaranteed sizes or installed-host timing.

## Automated gates

- `npm test` — passed: repository confidentiality regression, TypeScript host/renderer/language compilation, results display/number/settings checks, packed codec, all 51 focused runtime/contract/ownership groups, both constrained-memory fixtures and language-server IPC smoke. A sandbox-only EPERM creating temporary git repositories was resolved by running the same gate with approved escalation.
- `node test/notebook-packed-column.js` — passed exact all-type numeric/special/ragged/native-vs-portable round trips, unsupported-shape fallback, malformed bytes/descriptors, warmed-cache mutation rejection, v4 contract and CSV/plain-text/static/chart parity.
- `node --max-old-space-size=1024 --expose-gc test/notebook-columnar-memory.js` — passed all 8.4 million outer scalar cells through producer/save/reopen under 1 GiB heap: 5.179319 MiB file (previous v3 approximately 160 MiB), creation of positive and zero mode outputs 12,275 ms combined, save 79 ms, write 3 ms, RSS 291 MiB. The ordinary 60k fixture still passes under 384 MiB heap.
- `node test/results-display-browser.js` — passed real Chromium panel checks plus both saved v3 and v4 scrolling, settings refresh, paging, sorting and Results-action identity/payload checks. Browser evidence was generated in `/tmp`; no user notebook browser state was changed.
- `npm run test:notebook-python` — passed 22 tests.
- `node scripts/check-notebook-contract.js` — passed released `kx-notebook==0.1.0` table/chart/qText cross-contract compatibility.
- `VSCODE_KDB_LIVE_REQUIRED=1 node test/live/run.js` — passed actual local q 5 IPC fixture regressions; complete-source cases used poisoned `.Q.ld`. This does not claim an old-q runtime or execute the user's query.
- Cached pinned documentation environment: `python -m mkdocs build --strict`, then `python3 .github/scripts/clean-mkdocs-output.py docs` — passed; generated documentation is synchronized.
- `openspec validate --specs --strict` — passed all 9 main capabilities. Strict validation of `pack-exact-notebook-columns`, `add-unlimited-notebook-output-mode`, and `preserve-attributed-q-table-notebook-results` — passed; older active compatibility clauses were reconciled without changing their original retention/presentation invariants.
- `git diff --check` — passed.

Native/mixed route integration loops exercise positive/zero modes, fresh rerun IDs, foreign/stale rejection, clearing and close. Real saved-grid browser checks exercise scroll retention and actions without q. Actual installed-host execution/scroll/autosave on v4 and Jupyter-owned disk writing remain manual acceptance after installing the release; the large-file diagnostic deliberately leaves the installed extension and original notebook untouched.

## Release

Local audited VSIX and single-member ZIP are built from the entire authorized newer working tree. `npm run package:vsix` passed source and compiled confidentiality gates, built 20 files with bundled compression and no runtime package directories, and passed VSIX confidentiality. `python3 scripts/audit-release.py vscode-kdb-0.2.40.vsix vscode-kdb-0.2.40-vsix.zip` passed the artifact/wrapper audit; the ZIP contains exactly the raw VSIX bytes. No Git commit, tag, permanent installation or publication is part of this release.

- VSIX: 1,595,785 bytes; SHA-256 `214ae2fcf12a97a6471ec28516751f498495f1952ba53fc4e40afa4c9b02c6e1`.
- ZIP: SHA-256 `5d9843db6947ea79f075f4aeb991b20c6bcddf115025ccfe4f68e99e820022eb`.

Main `notebook-q-execution` requirements were synced and validated: modified large-table encoding to strict v4 while retaining v3 input, added lossless nested packing/corruption/exact actual-file scenarios, and preserved all other requirements. All tasks are complete.
