# Verification

## Autofit reapply regression — 2026-09-24

- Added **Fit columns now** to Results, live notebook, and saved notebook settings. It clears only current source-position overrides, enables autofit when needed, recomputes the selected scope from already-owned data, and emits no query/rerun action.
- `node test/results-display.js`, focused chart/Results groups, and the complete `npm test` gate pass with the new interaction and repeated-X grouping regression.
- Strict OpenSpec validation passes for both `improve-results-display-settings` and `enable-group-by-all-charts`; the strict MkDocs build also passes.

Implementation and verification are complete for 0.2.31. The earlier working-tree gate failures have been resolved by their owners; the full repository gate now passes. This change has not been archived.

## Passed

- `npm run compile`: extension, language server, renderer and assets.
- `node test/results-display.js`: autofit activation regression (confirmed failing before the fix), independent precision, q float/real and nested cells, exact export/portable identity, integer/temporal/special-value preservation, numeric threshold boundaries and invalid settings, and quick-control classification.
- `VSCODE_KDB_TEST_FILTER=result node test/run.js`: 9 focused groups.
- `VSCODE_KDB_TEST_FILTER=notebook node test/run.js`: 12 focused groups, including older settings-message defaults and invalid numeric settings, live ownership and complete/historical saved output.
- `VSCODE_KDB_TEST_FILTER=chart node test/run.js`: 4 groups, including density, pan reuse, executable panel/notebook zoom and reset/stale-response behavior.
- `node test/language/run.js`: language-server IPC smoke passed.
- `UV_CACHE_DIR=/tmp/results-uv-cache UV_PYTHON_INSTALL_DIR=/tmp/results-python node scripts/check-notebook-contract.js`: released Python companion v1 table/chart/qText payloads validate and render through TypeScript.
- `uv --cache-dir /tmp/results-uv-cache run --no-project --with-requirements mkdocs-src/requirements.txt mkdocs build --strict`, followed by `python3 .github/scripts/clean-mkdocs-output.py docs`: documentation built and normalized.
- Strict OpenSpec validation and `git diff --check`.

## Browser checks

`test/results-display-browser.js` uses Chromium's DevTools protocol with the production Results HTML, real host-side settings/slices, the bundled uPlot runtime and the compiled notebook renderer. Set `VSCODE_KDB_CHROME` to a Chromium executable; supply its runtime libraries through `LD_LIBRARY_PATH` if necessary. Run after compilation or use `npm run test:results-display-browser`.

Verified at device scale factor 2:

- Explicit autofit changes previously manual column widths, with formatted table values visible and no browser errors.
- Automatic widths read the rendered font instead of assuming the Auto setting means 13px. Whole-result length hints retain conservative glyph measurements and existing width bounds.
- Production Y sizing reserves sufficient space for 24px labels with 12 decimal places and magnitudes of one trillion. Numeric X end padding also accommodates those labels.
- Saved complete notebook output exposes separate decimal controls, excludes separator preferences, clears current manual widths on autofit activation, rerenders changed precision, and preserves its exact payload without a rerun.

The final browser run wrote screenshots and JSON evidence to `/tmp/kx-results-display-nKBBvQ`.

## Earlier full-gate limitations (resolved for 0.2.31)

- `npm test` stops in repository confidentiality checks because the existing untracked nested checkout is listed as a directory. A run using a temporary Git exclusion for that checkout then reported existing confidentiality violations in four planning files under `openspec/changes/track-runtime-namespaces/`. Those files were not edited by this change.
- The initial `node test/run.js` run passed all 48 groups. After concurrent server-explorer edits appeared, a fresh broader run failed the unrelated server-explorer model expectation for qualified namespace names. The focused Results, notebook, chart and numeric-display checks above passed against the updated tree.
- `node scripts/run-notebook-results-visual.js` cannot launch because Xvfb is absent. The targeted headless browser checks above provide actual DOM/canvas coverage for this change; the complete VS Code visual/restart suite has not passed in this environment.

The release verification below supersedes the earlier full-gate failures. The complete VS Code visual/restart suite remains an environment limitation; the real headless Results/notebook browser checks were rerun successfully.

## 0.2.31 release verification — 2026-09-11

- `npm test`: repository hygiene, compilation, numeric-display tests, all 48 focused groups, and language-server IPC smoke passed without exclusions or workarounds.
- `VSCODE_KDB_LIVE_REQUIRED=1 node test/live/run.js`: required live Direct IPC passed using q 5; old-q execution is not claimed.
- Headless Results/notebook browser suite passed again at device scale factor 2; evidence: `/tmp/kx-results-display-mIcSRp`.
- Strict documentation build and generated-output normalization passed.
- Existing unrelated working-tree files were preserved; version-bearing files received only release-version substitutions, and the namespace changelog entry remains under Unreleased.
- Released Python companion cross-contract check passed again.
- `npm run package:vsix`: repository, compiled-output and VSIX confidentiality audits passed; packaged 20 files.
- `python3 scripts/audit-release.py vscode-kdb-0.2.31.vsix vscode-kdb-0.2.31-vsix.zip`: passed, including manifest/version validation and byte-for-byte wrapper content.
- VSIX SHA-256: `ceb96c9c7f5725a0625daae149c24c33ca0304e5280b167addce42d5ed5bef2e`.
- ZIP SHA-256: `4fb9d4def4caa1f2ff1a71e2ae70e7b54a6872629bb22349879cc4730f74a991`.
