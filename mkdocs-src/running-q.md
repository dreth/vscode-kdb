# Running q

The `.q` editor commands execute q text; they do not parse SQL, split SQL statements, or infer a SQLTools-style session. The native **KX q (Direct IPC)** notebook controller executes complete q cells through the same active connection. Python `%%q` cells use a separate explicit helper path described in [Jupyter/IPython Notebooks](notebooks.md).

## Commands and keybindings

| Command | Windows/Linux | macOS | Behavior |
| --- | --- | --- | --- |
| **KX: Run Selection / Current Line** | `Ctrl+Enter` | `Cmd+Enter` | Run the exact non-empty selection, or the exact current physical line. Reuse the active/available KX result panel. |
| **KX: Run Selection in New Result** | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` | Use the same extraction semantics and open an independent result panel. |
| **KX: Run q Script** | `Ctrl+Alt+Enter` | `Cmd+Alt+Enter` | Run the complete active `.q` document and reuse the active/available result panel. |

A code lens at the top of a q document also runs the whole script.

These keybindings are gated to normal q text editors. KX for VS Code does not add or intercept notebook `Ctrl+Enter` / `Ctrl+Shift+Enter`. VS Code delegates normal notebook Run to the selected controller: direct q when **KX q (Direct IPC)** is selected, or Python when a Python controller is selected.

## Notebook commands

| Command | Behavior |
| --- | --- |
| **Notebook: Select Notebook Kernel** | VS Code's native selector includes **KX q (Direct IPC)**. With it selected, normal Run sends the complete q cell through the active KX profile/session and namespace. |
| **KX: Set Notebook Cell Language to q** | Sets actual `TextDocument.languageId` to q through VS Code's supported API for every selected code cell, skips Markdown, and reports changed/already-q/failure counts. Available from the q cell toolbar, notebook cell context, and Command Palette. |
| **KX: Restore Notebook Cell Language** | Restores selected code cells to the registered notebook default resolved from Jupyter metadata. It preserves source, `%%q`, KX metadata, and output. |
| **KX: Tag Notebook Cell as q** | Sets actual q language first, then preserves/inserts one durable `%%q --max-rows ... --max-bytes ...` marker and merges versioned `vscode-kdb` metadata without wiping unrelated metadata. It does not execute the cell. |
| **Prepare this q cell for the active Python kernel** | Contextual action for a q-language cell without `%%q`; adds only the marker/KX metadata. It does not restore or execute the cell. |
| **KX: Open Saved Notebook Preview in Results Panel** | Opens only a valid bounded KX MIME preview already saved on the selected cell. It never reruns q or recovers omitted rows. |

For direct q, select **KX q (Direct IPC)**, use q-language cells, and Run normally. A leading `%%q` is rejected; remove it or select the Python controller. Every direct notebook cell uses complete-cell `.Q.ld` script grouping and therefore has the newer-q requirement below. For a normal Python/IPython controller, keep or prepare `%%q`, restore the notebook default/Python language, then use normal Run after installing and configuring `kx_notebook`. Tag/Prepare actions are hidden while the direct controller is selected to keep the two routes distinct. The extension does not monkey-patch Jupyter or intercept Python-controller Run.

## Exact execution semantics

- A non-empty selection is preserved exactly.
- With no selection, only the current physical line is used. There is no current-block inference.
- A single-line selection and current-line execution are sent as raw q expressions.
- A selection containing a line break is treated as a script.
- **Run q Script** treats the entire document as a script.

Multiline selections and documents are normalized to line-feed endings and grouped by q's `.Q.ld` script-line grouping. Groups execute in order and the final value is returned. This requires q 4.0 dated 2023-03-28 or newer, or q 4.1t dated 2022-11-01 or newer. Older q versions receive a clear script-version error; single-line raw execution does not use `.Q.ld`.

Whitespace, q indentation, and script termination rules still belong to q. Select the intended text when a partial document should run.

## Syntax scope

The extension owns its first-party TextMate q grammar. Version 0.2.2 recognizes a top-line `%%q` as a notebook directive while retaining the ordinary q rules and highlighting below it. The extension continues to associate q with `.q` files only. It does not claim `.k`: adding that association without a demonstrated, testable requirement could conflict with other VS Code language support.

This is basic syntax grammar and editor-command support, not a q language server, lint engine, source-document formatter, or full editor-parity claim. The optional qText syntax highlighting and conservative formatting settings affect result-view presentation only; they do not change `.q` source documents. In notebooks, the cell language selects highlighting and the selected controller owns execution. Standalone q editor keybindings and code lenses are suppressed for notebook-cell documents; the native notebook controller uses VS Code's normal Run UI.

## Active connection and namespace

All three normal `.q` editor paths use the active standalone connection. If one is configured but not open, the extension connects on demand.

The connection's **Database / Namespace** value is applied consistently:

- `.` evaluates raw current-line/single-line text as sent;
- a non-root namespace evaluates it after temporarily switching q namespace; and
- script and multiline paths apply the same namespace around `.Q.ld` grouping.

The wrapper restores the server's previous namespace after success or failure. A q error is rethrown and shown as an error, not converted into an ordinary result row.

## Result placement

The normal current-line/selection and script commands replace the active, last active, visible, or first KX result panel in that order. If no panel exists, one is created in the configured initial editor group.

**Run Selection in New Result** creates another panel. It does not route through SQLTools and does not create `.session.sql` files. A direct-controller notebook result can hand off its live in-memory value while the bound live record exists; reopened/Python-helper output contains only the saved bounded preview.

## Query History

`vscode-kdb.features.queryHistory` defaults to `false`. When enabled, **KX Query History** records editor line, selection, and script executions only after the exact text is actually issued to q. A run rejected before issue is not stored. Entries are newest first and contain the query text, stable connection ID and recorded label, timestamp, execution kind, status (`succeeded`, `failed`, or `canceled` after an issued run's local wait is canceled), and duration. Result payloads and passwords are never included.

Storage is the current VS Code workspace's local extension `Memento`. History is not placed in user/workspace settings, registered for Settings Sync, or transmitted as telemetry. The entry cap is `vscode-kdb.queryHistory.maxEntries`, default `100`, with a valid range of `1` through `1000`; lowering it removes the oldest excess entries.

Use an entry's context menu to rerun, copy, insert its exact text into the active editor, or delete it. **KX: Clear Query History** confirms before removing all local entries. Disabling the feature stops new writes and hides the view and commands, but retained entries are not silently destroyed; re-enable it and use Clear to remove them.

Rerun goes through the same exact editor pipeline, including normal connection selection, the configured namespace wrapper, query/script transport choice, timeout, cancellation, q-error handling, diagnostics, and normal KX Results panel. After selection resolves the target, KX identifies both labels and confirms every stable-ID mismatch—including when no profile was active or the recorded profile was removed—before sending the text. Renamed and removed profiles remain safely described without storing or displaying passwords.

## Cancellation boundary

Use the result panel's **Cancel** button or cancel the VS Code progress notification. This stops that panel waiting and protects it from a late result. It is a local wait cancellation: q computation or side effects already sent to the server may continue, and other queued work on the same connection is not canceled.

Use **KX: Disconnect** when you intentionally need to close the connection and fail its outstanding IPC work. Diagnostics distinguish local result-wait cancellation from transport disconnect/cancel transitions.
