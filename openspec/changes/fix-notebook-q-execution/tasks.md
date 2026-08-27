## 1. Focused Regression Coverage

- [x] 1.1 Extend the deterministic notebook harness with controller-affinity, native notebook execution, active-cell edit focus, and bounded apply-edit retry observations; verify the new fixtures distinguish `.qnb` controller output from mixed `.ipynb` structural output.
- [x] 1.2 Add deterministic tests for defensive `.qnb` command dispatch, hidden mixed-route controls, exact single query issue, native inline MIME v2 output, mixed text-focused same-result retry, ambiguous commit verification, stale/foreign/canceled branches, focus restoration, and conditional move/insert; verify the focused notebook controller/integration test groups pass.
- [ ] 1.3 Add real Extension Host coverage that executes and save/reopens an actual `.qnb` through normal notebook execution with the Jupyter opt-in disabled, plus a text-focused mixed `.ipynb` run; verify one q request per gesture, inline output identity, no `.qnb` structural cell replacement, preserved source/siblings/controller, and successful persisted output.

## 2. Notebook Route Ownership

- [x] 2.1 Restrict the mixed runner entry point to `jupyter-notebook` cells and defensively route `.qnb` command invocations through normal notebook execution; verify programmatic and renderer rerun tests cannot send `.qnb` through `replaceCells`.
- [x] 2.2 Apply preferred affinity to existing and newly opened `.qnb` documents and clean up selection/abort state on close and disposal; verify normal Run and `Ctrl+Enter`-equivalent execution reaches the dedicated controller while `vscode-kdb.notebook.enableDirectController` remains false.
- [x] 2.3 Remove mixed-Jupyter run/status controls from `.qnb` while retaining the native controller route and correct active-profile guidance; verify manifest/source guards preserve mixed `.ipynb` shortcuts, Python/Markdown ownership, user keymap resolution, and the optional-controller boundary.

## 3. Focus-Safe Mixed Output Commit

- [x] 3.1 Refactor mixed output application into a bounded idempotent commit that checks for an already-committed expected identity, leaves edit mode only after a still-current text-focused failure, retries the same prepared output once, and never calls q execution; verify query issue counts and apply/verify failure details in deterministic tests.
- [x] 3.2 Rebind staged live ownership and restore run-and-stay cell selection/edit focus only after the replacement output identity is verified; verify cell source/language/metadata, sibling cells, selected Python controller, old-output-on-failure, cancellation, stale-result, clear, and live/saved MIME v2 invariants remain intact.

## 4. Documentation and Release Notes

- [x] 4.1 Update the changelog and notebook/troubleshooting source docs to explain `.qnb` native-controller execution, mixed `.ipynb` shortcut behavior, and safe handling after a local output failure; verify no instruction suggests rerunning a stateful query whose issue status is uncertain.
- [x] 4.2 Rebuild `docs/` with the pinned strict MkDocs workflow and run the Pages routing guard; verify generated documentation is clean and contains the updated notebook guidance.

## 5. Verification

- [x] 5.1 Run the focused deterministic notebook tests, TypeScript compilation, and `npm test`; verify all relevant test groups pass without weakening existing Results, notebook persistence, q-list grid, or chart-resampling assertions.
- [ ] 5.2 Run the real Extension Host notebook suite (and notebook visual/cross-contract gates if touched), then run `openspec validate fix-notebook-q-execution --type change --strict`; record any environment-only blocker without marking its task complete.

Verification blocker (2026-08-27): `npm run test:extension-host` compiled successfully but could not start because the pinned Linux VS Code runtime and `/usr/bin/Xvfb` are not installed in this environment. Strict OpenSpec validation passed.
