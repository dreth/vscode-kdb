## Context

See `proposal.md` for the regression. The current code has two intentionally different output owners:

- A selected KX notebook controller creates a `NotebookCellExecution` and writes output through the native execution API.
- **Run q Cell (KX)** is used while another controller owns a mixed `.ipynb`; because the extension cannot mutate another controller's execution, it preserves old output during the query and commits the completed result with one structural notebook-cell replacement.

The 0.2.24 `.qnb` integration registers a dedicated controller, but it also registers the mixed-route status provider for `.qnb`, allows the mixed command to accept `.qnb`, and allows the runner's mixed `runCell` entry point to accept `.qnb`. That makes a q-only cell reach `WorkspaceEdit`/`replaceCells`; the reported error is the resulting `applyEdit` rejection. Conversely, contributed KX notebook shortcut rules are deliberately scoped to mixed `jupyter-notebook` cells, so `.qnb` relies on the normal notebook gesture reaching its dedicated controller. The current Extension Host suite covers `.qnb` serialization and command-mode mixed `.ipynb` output, but not native `.qnb` execution or a text-focused shortcut.

Compatibility boundaries are the active-profile session and namespace, exact MIME v2 payload/output identity, live-result ownership, saved output, cell source/language/metadata, sibling cells, selected Python controller, cancellation, and stale/foreign-output detection.

## Goals / Non-Goals

**Goals:**

- Enforce one execution/output owner per notebook type at UI, command-dispatch, and runner boundaries.
- Make `.qnb` normal run gestures reliably select/prefer and invoke the dedicated controller.
- Make the mixed structural output commit safe when the invoking q cell retains text focus, without executing q twice.
- Add real-runtime coverage at the missing gesture and controller boundaries.

**Non-Goals:**

- Do not unify the controller-owned and mixed output writers; their different ownership constraints are real.
- Do not keep the optional Jupyter KX controller registered when its setting is false merely to acquire an output API.
- Do not use Jupyter-private APIs, switch a mixed notebook's kernel, or change persisted result formats.

## Decisions

### 1. Classify the route before execution and enforce it in three layers

Notebook type is the shared source of truth:

- `.qnb` uses only the dedicated controller route.
- `jupyter-notebook` with the KX controller selected uses normal controller execution.
- `jupyter-notebook` with another controller selected uses **Run q Cell (KX)**.

The `.qnb` cell status provider will stop offering the mixed run command, the mixed command will delegate any defensive `.qnb` invocation to normal notebook execution rather than calling the mixed runner, and the mixed runner entry point will reject `.qnb`. Keeping all three guards prevents a stale UI contribution or programmatic command invocation from bypassing route ownership.

Alternative: fix only the visible status item. Rejected because commands, renderer reruns, and future callers could still enter the wrong writer.

### 2. Prefer the dedicated controller for every open qnb

The always-registered `.qnb` controller will mark existing and newly opened q notebooks with `NotebookControllerAffinity.Preferred`. Normal VS Code Run/`Ctrl+Enter` remains the gesture owner; KX will not contribute a competing `.qnb` keybinding. Controller selection events remain the authoritative execution-state signal, and close/dispose removes associated state.

Alternative: add another KX `Ctrl+Enter` keybinding for `.qnb`. Rejected because it would compete with the native notebook command, duplicate route logic, and obscure whether the dedicated controller is actually usable.

### 3. Keep qnb output on NotebookCellExecution

Dedicated `.qnb` execution continues through the same `prepareCellResult` and `materializeCellResult` source used by the optional direct Jupyter controller, then calls native output replacement. It must never call the structural mixed writer. The shared result materializer remains the source of truth for q conversion, MIME v2, output IDs, and live registration.

Alternative: make structural replacement work for the custom `.qnb` serializer. Rejected because controller-owned output APIs already provide the correct lifecycle and avoid cell-identity replacement.

### 4. Retry only the mixed local commit, never the q request

The mixed route keeps its current prepare/commit separation. Output application will:

1. verify whether a rejected/thrown edit nevertheless committed the expected identity;
2. stop on stale source, foreign output, close, cancellation, or read-only state;
3. when the invocation originated in the active cell text editor and the cell is still current, leave edit mode, re-resolve the cell, and retry the identical prepared structural edit once;
4. verify the exact expected output identity before publishing the staged live binding; and
5. restore the run-and-stay selection/edit focus against the replacement cell when safe.

No step returns to q execution. The retry is bounded to one local edit and reuses the same output/live IDs, making an ambiguous first commit idempotently verifiable.

Alternative: leave edit mode before the q query. Rejected because a long query would disrupt editing even when no output conflict exists. Alternative: show only a Results panel fallback. Rejected because it does not satisfy inline notebook persistence and changes the established surface contract.

### 5. Test route ownership in a real Extension Host

Deterministic tests will cover the route classifier, defensive `.qnb` command dispatch, bounded same-result retry, stale/foreign/cancellation branches, focus restoration, and no-second-query count. Real Extension Host coverage will open an actual `.qnb`, invoke the native cell execution command with the Jupyter opt-in disabled, verify one queued q request and native rich output/save-reopen, and assert no structural cell replacement. It will also invoke a text-focused mixed `.ipynb` shortcut path and verify inline output, controller stability, and source/sibling preservation.

The KX Results panel and saved notebook renderer are verification consumers only; their result contracts are unchanged.

## Risks / Trade-offs

- [Risk] Preferred affinity does not force selection when another extension contributes a `.qnb` controller. → Keep normal VS Code selection visible, test the single-controller supported configuration, and never silently fall back to the mixed writer.
- [Risk] Leaving and restoring cell edit mode can alter focus or selection. → Use it only after an initial local commit failure from the active cell editor, preserve the target index, and restore focus only if the same notebook/cell source remains current.
- [Risk] An edit can throw after partially committing. → Inspect the current cell for the expected identity before any retry; treat a matching identity as success and a foreign identity as stale/conflict.
- [Risk] The one-second identity verification window can still fail on a heavily loaded host. → Retain event-driven verification and the existing bounded deadline; add real-runtime coverage rather than increasing the deadline without evidence.
- [Risk] A stateful q expression may already have changed server state before local output failure. → Never reissue automatically and keep the issued/not-issued diagnostic explicit.

## Migration Plan

No persisted-data migration is required. Ship the routing guards, affinity, focus-safe mixed commit, tests, changelog, and regenerated docs together. Rollback is a normal code revert; existing `.qnb`, `.ipynb`, MIME v1/v2 output, connection settings, and saved results remain compatible.
