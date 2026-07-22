# Running q

The `.q` editor commands execute q text; they do not parse SQL, split SQL statements, or infer a SQLTools-style session. Notebook `%%q` cells use the separate explicit helper path described in [Jupyter/IPython Notebooks](notebooks.md).

## Commands and keybindings

| Command | Windows/Linux | macOS | Behavior |
| --- | --- | --- | --- |
| **KX: Run Selection / Current Line** | `Ctrl+Enter` | `Cmd+Enter` | Run the exact non-empty selection, or the exact current physical line. Reuse the active/available KX result panel. |
| **KX: Run Selection in New Result** | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` | Use the same extraction semantics and open an independent result panel. |
| **KX: Run q Script** | `Ctrl+Alt+Enter` | `Cmd+Alt+Enter` | Run the complete active `.q` document and reuse the active/available result panel. |

A code lens at the top of a q document also runs the whole script.

These keybindings are gated to normal q text editors. KX for VS Code does not bind or intercept notebook `Ctrl+Enter` / `Ctrl+Shift+Enter`; ordinary Jupyter and Python execution remain in control.

## Notebook commands

| Command | Behavior |
| --- | --- |
| **KX: Tag Notebook Cell as q** | Adds a durable `%%q --max-rows ... --max-bytes ...` marker when absent and refreshes versioned `vscode-kdb` cell metadata. It does not execute the cell. |
| **KX: Open Saved Notebook Preview in Results Panel** | Opens only a valid bounded KX MIME preview already saved on the selected cell. It never reruns q or recovers omitted rows. |

Run tagged cells through the notebook's normal Python/IPython controller after installing and configuring `kx_notebook`. The extension does not contribute a controller, monkey-patch Jupyter, or route notebook selections through its direct IPC connection.

## Exact execution semantics

- A non-empty selection is preserved exactly.
- With no selection, only the current physical line is used. There is no current-block inference.
- A single-line selection and current-line execution are sent as raw q expressions.
- A selection containing a line break is treated as a script.
- **Run q Script** treats the entire document as a script.

Multiline selections and documents are normalized to line-feed endings and grouped by q's `.Q.ld` script-line grouping. Groups execute in order and the final value is returned. This requires q 4.0 dated 2023-03-28 or newer, or q 4.1t dated 2022-11-01 or newer. Older q versions receive a clear script-version error; single-line raw execution does not use `.Q.ld`.

Whitespace, q indentation, and script termination rules still belong to q. Select the intended text when a partial document should run.

## Syntax scope

The existing first-party TextMate grammar was audited for 0.1.4 and left unchanged because no reliable token-coverage defect was found. The extension continues to associate q with `.q` files only. It does not claim `.k`: adding that association without a demonstrated, testable requirement could conflict with other VS Code language support.

## Active connection and namespace

All three normal `.q` editor paths use the active standalone connection. If one is configured but not open, the extension connects on demand.

The connection's **Database / Namespace** value is applied consistently:

- `.` evaluates raw current-line/single-line text as sent;
- a non-root namespace evaluates it after temporarily switching q namespace; and
- script and multiline paths apply the same namespace around `.Q.ld` grouping.

The wrapper restores the server's previous namespace after success or failure. A q error is rethrown and shown as an error, not converted into an ordinary result row.

## Result placement

The normal current-line/selection and script commands replace the active, last active, visible, or first KX result panel in that order. If no panel exists, one is created in the configured initial editor group.

**Run Selection in New Result** creates another panel. It does not route through SQLTools and does not create `.session.sql` files. Notebook panel handoff is separate and contains only the saved bounded preview.

## Query History

`vscode-kdb.features.queryHistory` defaults to `false`. When enabled, **KX Query History** records editor line, selection, and script executions only after the exact text is actually issued to q. A run rejected before issue is not stored. Entries are newest first and contain the query text, stable connection ID and recorded label, timestamp, execution kind, status (`succeeded`, `failed`, or `canceled` after an issued run's local wait is canceled), and duration. Result payloads and passwords are never included.

Storage is the current VS Code workspace's local extension `Memento`. History is not placed in user/workspace settings, registered for Settings Sync, or transmitted as telemetry. The entry cap is `vscode-kdb.queryHistory.maxEntries`, default `100`, with a valid range of `1` through `1000`; lowering it removes the oldest excess entries.

Use an entry's context menu to rerun, copy, insert its exact text into the active editor, or delete it. **KX: Clear Query History** confirms before removing all local entries. Disabling the feature stops new writes and hides the view and commands, but retained entries are not silently destroyed; re-enable it and use Clear to remove them.

Rerun goes through the same exact editor pipeline, including normal connection selection, the configured namespace wrapper, query/script transport choice, timeout, cancellation, q-error handling, diagnostics, and normal KX Results panel. After selection resolves the target, KX identifies both labels and confirms every stable-ID mismatch—including when no profile was active or the recorded profile was removed—before sending the text. Renamed and removed profiles remain safely described without storing or displaying passwords.

## Cancellation boundary

Use the result panel's **Cancel** button or cancel the VS Code progress notification. This stops that panel waiting and protects it from a late result. It is a local wait cancellation: q computation or side effects already sent to the server may continue, and other queued work on the same connection is not canceled.

Use **KX: Disconnect** when you intentionally need to close the connection and fail its outstanding IPC work. Diagnostics distinguish local result-wait cancellation from transport disconnect/cancel transitions.
