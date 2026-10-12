# Verification — 0.2.41 standalone symbol qText

## Diagnosis and change

The packaged 0.2.33 VSIX and current shared presentation code both exclude non-null symbol atoms from standalone qText preference. A symbol atom therefore reaches the generic one-cell `value` grid even when symbol vectors follow the user's qText list setting. The user's clarified example is `hola; vectors such as `hola`ciao should retain their existing setting.

The shared preference now includes standalone symbol atoms. Table, keyed-table, dictionary and list symbol cells retain their existing grid syntax and analyst export. Symbol vectors still obey selected list Grid/qText and cardinality. Other standalone scalar classes and functions are unchanged.

Complete v2 symbol output preserves the original exact q atom and adds strict `logicalPresentation: standalone-symbol`. It requires exactly one matching symbol atom cell under full persistence, with no chart/key/column attributes; malformed variants are rejected. Shared saved derivation creates a transient qText view; canonical bytes, atom identity, durable ID and ownership remain unchanged. Text export accepts this validated marker and authorizes the canonical original output before deriving text. Existing unmarked one-cell tables/output stay tables. New marked output needs 0.2.41+; older v1/v2/v3/v4 files remain readable. No file migration, user notebook modification, permanent install, Git commit/tag or publishing occurred.

## Commands and outcomes

- `npm test` — passed: compilation of host/renderer/language server; repository confidentiality; results formatting/settings; packed-column exact/malformed tests; **52 focused groups**, including the new symbol suite and canonical host action checks; both constrained-memory fixtures; language server IPC smoke.
- `node test/run.js` — symbol suite verifies plain/escaped/null symbol qText with either list setting, exact full-v2 save/reopen, invalid marker rejection, unchanged genuine table/dictionary/mixed-list cells, vector cardinalities/settings, and native/mixed execution in zero/positive modes. Positive mode uses the live qText policy; zero/reopened output derives identical text. Save/reopen/display issue no extra query. Runtime action tests accept canonical source text export and Results handoff and reject modified source values. Full gate passed after isolating the new panel-action fixture from existing exact-count assertions.
- `VSCODE_KDB_CHROME="<compatible-chromium-executable>" LD_LIBRARY_PATH="<browser-runtime-library-directory>" node test/results-display-browser.js` — passed real Chromium checks: new marked output renders a `pre` and no table, Export/Results actions send unchanged canonical source, passive actions do not rerun. Existing Results autofit/numeric-axis and saved v3/v4 scrolling/settings/paging/sort checks also passed. Libraries were linked from an existing cached environment; no system installation. Machine-specific paths are replaced with placeholders. Evidence: `/tmp/kx-results-display-F7BPsW`.
- `VSCODE_KDB_LIVE_REQUIRED=1 node test/live/run.js` — passed scratch local q 5 IPC, including actual `hola, escaped symbol and null symbol values, both list settings and exact typed save/reopen. Existing actual table/vector/attribute and complete-source cases also passed. This is not an installed-user-host test or an old-q-runtime claim.
- Cached pinned docs environment `python -m mkdocs build --strict`, then `python3 .github/scripts/clean-mkdocs-output.py docs` — passed and generated docs synchronized.
- `openspec validate render-standalone-symbols-as-qtext --strict` and `openspec validate --specs --strict` — passed; all nine main capabilities valid. Added standalone-symbol behavior/scenarios to `q-list-grid` without removing existing requirements.
- `git diff --check` — passed.

The unchanged 600,000 × 14 packed fixture remains **5.179319 MiB** under a 1 GiB JavaScript heap limit; save 122 ms, temporary disk write 3 ms. The 60k fixture still passes under 384 MiB heap. New symbol handling does not change packed v4 production, chart sampling, persistence limits or ownership lifetimes.

New-symbol installed Extension Host/Jupyter disk-writer acceptance remains manual after installing 0.2.41; automated route/ownership tests and real browser saved-output checks cover the affected code. No user file or container installation was touched this turn.

## Release

The entire previously authorized newer working tree is packaged locally as an audited 0.2.41 VSIX and single-member ZIP. `npm run package:vsix` passed source/compiled/VSIX confidentiality and built 20 files with zero runtime package directories. `python3 scripts/audit-release.py vscode-kdb-0.2.41.vsix vscode-kdb-0.2.41-vsix.zip` passed the artifact and single-member wrapper audit, verifying exact raw VSIX bytes.

- vscode-kdb-0.2.41.vsix: 1599408 bytes, SHA-256 `e729b7f6b727d4c066b4f459d83f43fd1faa24ff60929a0d1beab1100f6953ac`.

- vscode-kdb-0.2.41-vsix.zip: 1598997 bytes, SHA-256 `3d01f79b016b0202ec47dad2a9c54cca5e399a5f1ab2fb589beee8f9e207be8a`.
