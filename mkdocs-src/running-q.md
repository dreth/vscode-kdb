# Running q

The `.q` editor commands execute q text; they do not parse SQL, split SQL statements, or infer a SQLTools-style session. In notebooks, Python remains selected by default and **Run q Cell (KX)** executes complete q cells through an explicitly chosen Direct IPC target. Python `%%q` cells use a separate explicit helper path described in [Jupyter/IPython Notebooks](notebooks.md).

## Commands and keybindings

| Command | Windows/Linux | macOS | Behavior |
| --- | --- | --- | --- |
| **KX: Run Selection / Current Line** | `Ctrl+Enter` | `Cmd+Enter` | Run the exact non-empty selection, or the exact current physical line. Reuse the active/available KX result panel. |
| **KX: Run Selection in New Result** | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` | Use the same extraction semantics and open an independent result panel. |
| **KX: Run q Script** | `Ctrl+Alt+Enter` | `Cmd+Alt+Enter` | Run the complete active `.q` document and reuse the active/available result panel. |

A code lens at the top of a q document also runs the whole script.

These editor keybindings are gated to normal q text editors. VS Code delegates normal notebook Run to the selected Python/Jupyter controller. Separately, only while a q code-cell editor has text focus, KX binds `Ctrl+Enter` / `Cmd+Enter` to run and stay, `Shift+Enter` to run and move next, and `Alt+Enter` / `Option+Enter` to run and insert below. Move/insert occurs only after an executed result. The guards do not match Python, Markdown, output/cell-container focus, or ordinary editors. User/keymap bindings may override defaults, so the leading q-cell action remains available from the toolbar, context menu, and Command Palette. If the optional q-only controller is enabled and selected, normal notebook Run belongs to that controller and the mixed actions stand down.

## Notebook commands

| Command | Behavior |
| --- | --- |
| **Notebook: Select Notebook Kernel** | VS Code/Jupyter owns this selector. KX is absent from its candidates by default; explicitly enabling `vscode-kdb.notebook.enableDirectController` adds **KX q (Direct IPC)**. The selector itself is not removed. |
| **Run q Cell (KX)** | With Python selected, runs one q-language cell through the globally starred active KX connection. Focused q-cell shortcuts retain run/stay (`Ctrl`/`Cmd`), run/move-next (`Shift`), and run/insert-below (`Alt`/`Option`) Enter semantics. |
| **Make q Cell (KX)** | Sets actual `TextDocument.languageId` to q through VS Code's supported API without changing the selected Python kernel. It skips Markdown and preserves complete source, metadata, and output. |
| **KX: Activate q Connection** | Activates and stars the global KX connection used by editor and notebook Direct IPC. Legacy per-notebook target metadata is ignored and never overrides it. |
| **KX: Restore Notebook Cell Language** | Restores selected code cells to the registered notebook default resolved from Jupyter metadata. It preserves source, `%%q`, KX metadata, and output. |
| **KX: Tag Notebook Cell as q** | Sets actual q language first, then preserves/inserts one durable `%%q --max-rows ... --max-bytes ...` marker and merges versioned `vscode-kdb` metadata without wiping unrelated metadata. It does not execute the cell. |
| **Prepare this q cell for the active Python kernel** | Contextual action for a q-language cell without `%%q`; adds only the marker/KX metadata. It does not restore or execute the cell. |
| **KX: Open Saved Notebook Preview in Results Panel** | Opens only a valid bounded KX MIME preview already saved on the selected cell. It never reruns q or recovers omitted rows. |

For the default workflow, keep Python selected, use **Make q Cell (KX)** for q language/highlighting, star one active KX connection, and use **Run q Cell (KX)**. Python cells still use normal Jupyter Run. Every Direct IPC run resolves only the active profile; legacy per-notebook target metadata is ignored, connected non-active profiles never become fallback routes, and no active profile prompts for explicit activation. Mixed output is a normal undoable notebook edit after q finishes, not a native KX kernel execution; it marks the notebook dirty and is abandoned if that q cell changes during the wait.

For an explicitly requested q-only workflow, enable `vscode-kdb.notebook.enableDirectController`, select **KX q (Direct IPC)**, and use normal Run through the active profile. Both extension Direct IPC paths reject a leading `%%q` and use the same client-side complete-source grouping as editor scripts. For the separate Python-kernel route, install `kx-notebook==0.1.0`, leave a Python-language cell as Python, load `kx_notebook`, connect with `%kx connect`, and run a leading `%%q` through normal Jupyter Run. Do not switch one durable Direct IPC q cell back and forth between the routes. The extension does not monkey-patch Jupyter or intercept Python-controller Run.

## Exact execution semantics

- A non-empty selection is preserved exactly.
- With no selection, only the current physical line is used. There is no current-block inference.
- A single-line selection and current-line execution are sent as raw q expressions.
- A selection containing a line break is treated as a script.
- **Run q Script** treats the entire document as a script.

Multiline selections, documents, and complete direct cells normalize CRLF/CR to line-feed endings and use a client-side q script-line grouper. An unindented source line starts a group; following indented lines continue it. Blank lines and comments preserve source order. `/` ... `\` block comments, top-level q system-command lines, and a bare `\` that starts q's trailing script comment retain their script meaning. Groups execute in order through ordinary q `value`, and the final executed group is returned.

Whitespace, q indentation, source validity, and system-command behavior still belong to q. A system command in the source can therefore affect later groups in the same run. Select the intended text when a partial document should run.

Generated script and cell requests do not depend on `.Q.ld` and are not rejected by q release date. The extension does not enforce a minimum q version; source syntax and server capabilities still determine whether q accepts a request.

## Syntax scope

The extension owns its TextMate q grammar. A top-line `%%q` is recognized as a notebook directive while ordinary q rules and highlighting continue below it. The extension associates q with `.q` files only; `.k` is left to other VS Code language support.

This is syntax grammar and editor-command support, not a q language server, lint engine, or source-document formatter. The optional qText syntax highlighting and conservative formatting settings affect result-view presentation only; they do not change `.q` source documents. In notebooks, the cell language selects highlighting; normal Run belongs to the selected Jupyter controller, while the explicit KX action owns Direct IPC q execution. Standalone q editor keybindings and code lenses are suppressed for notebook-cell documents.

## Active connection and namespace

All three normal `.q` editor paths use the active standalone connection. If one is configured but not open, the extension connects on demand.

The connection's **Database / Namespace** value is applied consistently:

- `.` evaluates raw current-line/single-line text as sent;
- a non-root namespace evaluates it after temporarily switching q namespace; and
- script, multiline, and complete-cell paths save the current process namespace, enter the configured namespace, and evaluate the client-produced groups there.

The wrapper restores the server's previous namespace after success or failure, including after a source system command changed it during the run. A q error is rethrown and shown as an error, not converted into an ordinary result row. Assignments and definitions still persist in the namespace in which q evaluates them.

## Result placement

The normal current-line/selection and script commands replace the active, last active, visible, or first KX result panel in that order. If no panel exists, one is created in the configured initial editor group.

**Run Selection in New Result** creates another panel. It does not route through SQLTools and does not create `.session.sql` files. A Direct IPC notebook result can hand off its live in-memory value while the bound live record exists; reopened/Python-helper output contains only the saved bounded preview.

## Query History

`vscode-kdb.features.queryHistory` defaults to `false`. When enabled, **KX Query History** records editor line, selection, and script executions only after the exact text is actually issued to q. A run rejected before issue is not stored. Entries are newest first and contain the query text, stable connection ID and recorded label, timestamp, execution kind, status (`succeeded`, `failed`, or `canceled` after an issued run's local wait is canceled), and duration. Result payloads and passwords are never included.

Storage is the current VS Code workspace's local extension `Memento`. History is not placed in user/workspace settings, registered for Settings Sync, or transmitted as telemetry. The entry cap is `vscode-kdb.queryHistory.maxEntries`, default `100`, with a valid range of `1` through `1000`; lowering it removes the oldest excess entries.

Use an entry's context menu to rerun, copy, insert its exact text into the active editor, or delete it. **KX: Clear Query History** confirms before removing all local entries. Disabling the feature stops new writes and hides the view and commands, but retained entries are not silently destroyed; re-enable it and use Clear to remove them.

Rerun goes through the same exact editor pipeline, including normal connection selection, the configured namespace wrapper, query/script transport choice, timeout, cancellation, q-error handling, diagnostics, and normal KX Results panel. After selection resolves the target, KX identifies both labels and confirms every stable-ID mismatch—including when no profile was active or the recorded profile was removed—before sending the text. Renamed and removed profiles remain safely described without storing or displaying passwords.

## Cancellation boundary

Use the result panel's **Cancel** button or cancel the VS Code progress notification. This stops that panel waiting and protects it from a late result. It is a local wait cancellation: q computation or side effects already sent to the server may continue, and other queued work on the same connection is not canceled.

Use **KX: Deactivate Connection** when you intentionally need to clear the star, close the active connection, and fail its outstanding IPC work. Diagnostics distinguish local result-wait cancellation from transport disconnect/cancel transitions.
