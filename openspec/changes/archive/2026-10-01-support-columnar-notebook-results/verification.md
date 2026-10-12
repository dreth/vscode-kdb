# Verification — 0.2.39

## Preserved behavior and coverage

- Ordinary results still write strict v2; v1/v2 inputs and bounded Python-helper output retain their prior contracts. The new format only selects native q table/keyed-table storage above one million cells.
- Exact regressions compare row and column representations for 19 q types, including nested mixed vectors, long/temporal precision, all special values, chars/bytes/symbols, keys, attributes and empty vectors. CSV, plain text, static HTML/chart output and cell conversion remain consistent. Malformed schema/vector/type/attribute/bounds/binding fields, sparse/decorated arrays, and mislabeled versions fail closed.
- Native `.qnb` and mixed `.ipynb` runtime tests exercise bound v3 output, both zero/positive policies, exactly-once explicit reruns, fresh durable identities, retirement of replaced records, and foreign notebook scopes. Existing authorization, stale/clear/close/cancellation and byte-proof tests remain in the complete 51-group suite.
- Real Chromium tests exercise the production v3 saved renderer, retained scroll through a settings refresh, paging, sorting, immutable payload, and canonical Results action. This supplements the existing live viewport, autofit, decimal and high-DPI browser checks; it is not a claim of 600k browser rendering or Jupyter's own filesystem writer.

## Constrained memory and actual container

`test/notebook-columnar-memory.js` creates 600,000 × 14 native typed columns through the actual producer in both positive and zero modes, disallows raw row materialization, verifies every scalar across all columns, and saves/reopens byte-identical rich MIME with durable ID and no transient metadata. It runs with a 1 GiB JavaScript heap limit. Its compact payload is approximately 159.54 MiB and saved qnb 159.55 MiB; the conservative old row-format estimate exceeds 729 million characters versus Node's 536,870,888-character single-string limit. Process RSS includes buffers outside the heap and reached approximately 1.8 GiB in this diagnostic.

The previous 60,000 × 14 qnb fixture remains under a 384 MiB heap limit and retains the compact writer/scanner. Separate ownership tests verify no-further-parse live proof reuse.

The existing VS Code Dev Container was tested through its actual active connection and the user's recognized read-only 600,000-row source. A temporary bundle supplied the updated producer/serializer and real VS Code output factories. Every source column matched exact canonical q-node digests; output ownership, file bytes, reopened MIME bytes, durable binding and transient-metadata stripping passed. A temporary file was used; the user's notebook remained clean and unchanged. Measured stage deltas: q 45,489 ms; columnar creation 16,153 ms; serialization 13,198 ms; filesystem write and read verification 2,240 ms; reopening and byte checks 8,373 ms. Additional whole-column verification and ownership work made the total diagnostic 128,849 ms and temporarily held multiple copies, reaching 3,052 MiB of JS heap. After completion the host returned to approximately 256 MiB heap. This is pipeline verification, not a permanent install or live renderer replacement.

The CDP client's 120-second deadline expired before the successful final stage; content-free stage evidence confirmed all assertions and exact reopen checks completed. An earlier diagnostic was terminated after its deadline; its cause was not established. All temporary bundles/files/global runner references were removed and the temporary inspector was closed.

## Gates

- Complete `npm test`: repository confidentiality, compilation, results display, 51 focused groups, both constrained-memory save tests, and language server tests.
- Final focused unit rerun includes strict dense-column and output-allocation failures.
- Python companion: 22 tests. Released `kx-notebook==0.1.0` cross-contract passes unchanged.
- Mandatory live direct q IPC tests: native q 5, no optional skip.
- Production Chromium renderer checks pass, evidence in a temporary local directory.
- Strict MkDocs build uses the existing pinned cached environment; generated output is cleaned.
- Strict new and reconciled OpenSpec change validation and `git diff --check` pass.

## Distribution

Audited local versioned VSIX and one-member ZIP are the release deliverables. No Marketplace/GitHub publish, permanent extension install, git commit or tag is performed. Newly written v3 output requires the updated reader; old saved v1/v2 output remains readable. Package audit and final hashes are recorded below once built.

### Final artifact audit

- `vscode-kdb-0.2.39.vsix`: version 0.2.39; 20 files; two compiled host modules; zero runtime packages; repository, compiled, VSIX confidentiality and full distribution audit pass. SHA-256 `f95150dc85d75df49a665e43522f2d69c7724d6066724a25b3b3fba83452bcde`.
- `vscode-kdb-0.2.39-vsix.zip`: exactly one member with raw VSIX bytes verified. SHA-256 `cd2049aacaa86be5aab3d6369c9e78c4d15e69ca9e49f15adccd2cd2337ee185`.
- The new notebook requirements were merged into the main capability with unrelated requirements/scenarios preserved and both main/delta strictly validated. Older completed/active working-tree changes remain separately reviewable.

### Commands and results

All exited successfully:

```sh
npm test
npm run compile:extension && node test/run.js
npm run test:notebook-python
node scripts/check-notebook-contract.js
VSCODE_KDB_LIVE_REQUIRED=1 node test/live/run.js
LD_LIBRARY_PATH="<browser-runtime-library-directory>" VSCODE_KDB_CHROME="<compatible-chromium-executable>" node test/results-display-browser.js
"<docs-venv>/bin/python" -m mkdocs build --strict
python3 .github/scripts/clean-mkdocs-output.py docs
npm run package:vsix
python3 scripts/audit-release.py vscode-kdb-0.2.39.vsix vscode-kdb-0.2.39-vsix.zip
git diff --check
```

OpenSpec CLI strict validation passed for `support-columnar-notebook-results`, `add-unlimited-notebook-output-mode`, `preserve-attributed-q-table-notebook-results`, and the synced `notebook-q-execution` main spec.
