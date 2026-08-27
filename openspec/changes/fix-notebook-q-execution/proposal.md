## Why

KX 0.2.24 introduced first-party `.qnb` support, but q-only cells can fall into the mixed-Jupyter structural cell-replacement path: `Ctrl+Enter` does not reliably reach the dedicated q controller and a successful q request can then fail to attach its inline result because VS Code rejects `applyEdit`. This leaves the query executed on the q process without visible notebook data and makes retrying dangerous for stateful q code.

## What Changes

- Make `.qnb` execution controller-owned end to end: normal notebook Run and `Ctrl+Enter` use the dedicated KX q controller and its native output API, never the mixed-notebook `replaceCells` writer.
- Keep mixed `.ipynb` q cells on **Run q Cell (KX)** while making text-focused and command-mode shortcuts target the current q cell and commit the already-issued result without issuing the q source again.
- Separate `.qnb` controller controls/status from mixed-Jupyter controls so the UI cannot dispatch a q-only cell through the wrong output path.
- Add deterministic and real Extension Host regression coverage for `Ctrl+Enter`-equivalent execution, inline rich output, output persistence, and the exact rejected-edit failure boundary.
- Preserve current active-profile/session/namespace routing, exact MIME v2 identity, live-result binding, cancellation, stale-result protection, sibling cells, Python/Markdown ownership, and keymap override behavior.

## Capabilities

### New Capabilities

- `notebook-q-execution`: Defines q-cell gesture routing, controller ownership, inline output commit, failure recovery, and cross-surface invariants for `.qnb` and mixed `.ipynb` notebooks.

### Modified Capabilities

None. The change strengthens and makes executable the existing `.qnb` and mixed-notebook guarantees without weakening the current language-intelligence contract.

## Non-goals

- Do not select or replace the Python/Jupyter controller for mixed `.ipynb` notebooks.
- Do not route Python or Markdown cells through q, add `%%q`, or change cell source/language as part of execution.
- Do not change q IPC evaluation, active-connection selection, q value conversion, Results-panel presentation, chart sampling, or persisted MIME schemas.
- Do not claim that a read-only, closed, externally replaced, or serializer-rejected notebook can always accept an inline output; such failures must remain explicit and must never cause a second q execution.

## Impact

- Affected extension code: `src/notebook-controller.ts`, `src/notebook-integration.ts`, and notebook/keybinding contributions in `package.json` as needed.
- Affected verification: deterministic notebook runner/integration tests in `test/run.js` and real VS Code notebook execution coverage in `test/extension-host/`.
- Affected documentation: notebook usage and troubleshooting in `mkdocs-src/`, regenerated `docs/`, and the changelog.
- No new runtime dependency, q requirement, persisted-data migration, command removal, or public MIME/API break is intended.
