## 1. Regression coverage and shared settings

- [x] 1.1 Add focused regressions for explicit autofit activation after manual resize, whole/visible scopes, headers/empty data, disabled scans, reload persistence and unrelated positions; verify they expose the current activation failure.
- [x] 1.2 Add table-decimal and scientific-threshold defaults, package settings, shared types, normalization and host/notebook transport support; verify default, boundary, invalid and older-message compatibility tests.

## 2. Table fitting and quick preferences

- [x] 2.1 Implement explicit autofit activation reset and asynchronous recalculation across Results and notebook surfaces; pass sizing regressions, including stale sizing and formatting invalidation.
- [x] 2.2 Implement display-only floating-point table precision through shared helpers and sizing consumers; test Auto, 0–12 precision, nested floats, integer/special/temporal/string preservation and exact copy/export/save/reopen behavior.
- [x] 2.3 Remove specified guardrail, warning, elapsed-format and separator controls from quick preferences while retaining extension settings, and expose independent table/chart decimals; verify rendered controls and configuration propagation on Results/live/saved surfaces.

## 3. Chart readability

- [x] 3.1 Implement shared numeric-axis scientific formatting with default 1e6 threshold; test positive/negative boundaries, custom/invalid thresholds, zero, numeric X/Y and unchanged time/category labels.
- [x] 3.2 Update axis and edge spacing in both chart consumers; verify unclipped labels at narrow panel widths, larger fonts, resize and zoom, with independent chart precision.

## 4. Integration and documentation

- [x] 4.1 Exercise Results, live notebook, complete saved MIME v2 and historical preview outputs; verify no q execution, exact identity/list cardinality, source ownership, guards, sampling density, hidden series and reset/stale-response behavior regressions.
- [x] 4.2 Update README, changelog and relevant results/chart/settings documentation and generated site; verify documented build and review only this change's additions against concurrent edits.
- [x] 4.3 Run npm test and applicable extension-host/visual regressions, record commands/outcomes and remaining environment limitations, and run strict OpenSpec validation; mark complete only when specified behavior is verified.

## 5. Autofit Reapply Regression

- [x] 5.1 Add focused Results/live/saved tests for **Fit now** while autofit is already enabled or disabled, current-versus-unrelated positional overrides, selected scope recalculation, and no-query behavior.
- [x] 5.2 Implement the shared Results and notebook **Fit now** interaction using existing bounded sizing and ordered positional-width persistence paths; update user-facing documentation and verification evidence.

## 6. Visible-screen Autofit Correction

- [x] 6.1 Add regressions for default visible scope, actual rendered-text width, stale manual-width precedence, and Results/live/saved scrolling or paging.
- [x] 6.2 Implement visible-text fitting in all three surfaces, make checked autofit authoritative, and turn it off on manual drag while preserving explicit whole-result mode.
- [x] 6.3 Update documentation/site, run focused and full verification, validate OpenSpec, and package a new installable VSIX.

Verification: `npm test` passed (48 focused groups plus language-server IPC smoke); `node test/results-display.js` passed after the final sizing adjustment; pinned MkDocs strict build and output cleanup passed; `openspec validate improve-results-display-settings --strict` passed; `npm run package:vsix` and its confidentiality audit passed for 0.2.33. Real browser/extension-host visual tests were unavailable because this environment has no Linux Chromium executable.
