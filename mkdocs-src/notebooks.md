# Jupyter/IPython Notebooks

KX for VS Code 0.2.8 is Python-first by default. Keep the normal Python Jupyter kernel selected, use KX to make only the intended cells q, choose a saved KX profile explicitly, and run those q cells through Direct IPC. KX does not register its optional q-only controller by default, so **KX q (Direct IPC)** is absent from VS Code's kernel candidates. The notebook's top-right Jupyter kernel selector itself remains visible and owned by VS Code/Jupyter.

| Selected notebook kernel + cell | Use |
| --- | --- |
| Python selected + Python cell | normal Run |
| Python selected + q cell | **Run q Cell (KX)** / `Ctrl` or `Cmd`+`Enter` / `Shift+Enter` / `Alt+Enter` |
| Optional KX q selected + q cell | normal Run, only after enabling `vscode-kdb.notebook.enableDirectController` |

VS Code selects one controller for the notebook. KX does not patch Jupyter or pretend built-in Run can dispatch cells through multiple selected controllers. **Run q Cell (KX)** is an explicit Direct IPC gesture for q-language cells; it leaves the Python controller and Python cells untouched.

## Default Python-first mixed workflow

Keep the normal Python Jupyter controller selected. Python cells continue to use Jupyter's Run commands, execution order, variables, and outputs. KX never changes their language, controller, or source.

For each intended q cell:

1. Click the leading **Make q Cell (KX)** action. It changes the complete code cell's language to q without changing the selected Python kernel.
2. Use the visible notebook-level `q default` item or **KX: Choose Notebook q Target** to select one saved KX profile.
3. Use the leading **Run q Cell (KX)** play action, or use focused-cell `Ctrl+Enter` / `Cmd+Enter` to run and stay, `Shift+Enter` to run and move next, or `Alt+Enter` (`Option+Enter` on macOS) to run and insert below.
4. Read the route from status: `KX: <profile> · Ctrl+Enter` (`Cmd+Enter` on macOS).

The action sends the complete cell source through the selected notebook target's direct KX session. It does not require `%%q`, select the KX controller, or mutate the Python controller. **KX: Restore Notebook Cell Language** restores the notebook's declared default language.

Only safe `{id, name}` profile identity/display metadata is saved in the `.ipynb`; host, port, namespace, username, password, credentials, and connection objects are excluded. Every run resolves that stable ID against current `ConnectionStore` data. If the same profile is edited from port `5005` to `5000`, the next run uses `5000`; the connection manager disconnects a client whose runtime endpoint is stale and reconnects as needed. A rename still resolves by ID. Changing the globally active profile does not override the notebook target.

The globally active profile is offered first as a labelled convenience, never used as an invisible fallback. An unselected, removed, or otherwise missing target shows **Select connection** and prompts for explicit selection, so mixed q never routes to list order or another profile by accident.

Because Python remains the selected controller, public APIs do not let KX own a native cell execution in mixed mode. **Run q Cell (KX)** leaves the old output visible while q runs, then commits the finished KX output as one normal undoable notebook edit. The edit marks the notebook dirty until saved and gives that q cell a new internal VS Code cell handle. It preserves the q source, q language, cell metadata, and every sibling Python/Markdown cell; it does not copy an old native execution order/timing summary onto the new KX output. If the q cell source, language, output, or execution state changes while KX is waiting, KX refuses to overwrite the newer state.

### Focused q-cell shortcuts

While the q cell editor itself has text focus, KX preserves the normal notebook meanings:

- `Ctrl+Enter` on Windows/Linux or `Cmd+Enter` on macOS runs the complete q cell and stays;
- `Shift+Enter` runs it and moves to the next cell; and
- `Alt+Enter` (`Option+Enter` on macOS) runs it and inserts a code cell below.

Move/insert occurs only after the Direct IPC runner returns an executed result. A canceled, busy, stale, or failed run leaves the cell position unchanged. Every public manifest guard requires all of:

- notebook cell editor and editor text focus;
- notebook type `jupyter-notebook`;
- code cell type;
- language exactly `q`;
- resource scheme `vscode-notebook-cell`; and
- the optional **KX q (Direct IPC)** controller not selected.

They cannot match Python, Markdown, an ordinary source editor, output focus, or a cell container without editor focus. In those other focus states VS Code's normal notebook shortcuts remain in charge; use the visible KX action for q execution. Extension default bindings outrank the built-in notebook rules when these exact guards match, while later user/keymap rules can still override any default shortcut. If a shortcut was customized, use the toolbar/context/Command Palette action or inspect **Developer: Toggle Keyboard Shortcuts Troubleshooting**. Clicking normal Python Run on a q-language cell remains standard Jupyter behavior and is not secretly duplicated by KX.

## Optional q-only Direct IPC controller

Set the application-scoped `vscode-kdb.notebook.enableDirectController` setting to `true` only when a q-only native-controller workflow is wanted. KX then registers:

- controller ID `vscode-kdb.q-notebook-controller`;
- notebook type `jupyter-notebook`;
- label **KX q (Direct IPC)**; and
- `supportedLanguages = ["q"]`.

The controller is created dynamically through the public `vscode.notebooks.createNotebookController` API and appears in VS Code's normal kernel picker. With it selected, normal **Run Cell**, **Run All**, or notebook shortcuts send the complete q cell through the active KX profile. Markdown is ignored. A non-q code cell is not dispatched to q, and a leading `%%q` is rejected because it belongs to the separate Python helper route.

Turning the setting off disposes the controller. A notebook that previously saved KX as its selected controller cannot keep forcing or restore that selection while KX is unregistered. This setting controls only the KX candidate; it does not remove or modify VS Code's top-right Jupyter selector. The manifest's `onNotebook:jupyter-notebook` event still activates the mixed runner for ordinary notebooks. No proposed/private affinity API, private Jupyter API, `ms-toolsai.jupyter` runtime import, or hidden command interception is used.

## Active connection and shared q session

Mixed cells use the notebook's explicit q target. The optional q-only controller uses the active profile only while it is enabled and selected. Both Direct IPC routes reuse the profile-keyed `ConnectionManager` client and q process/session; they do not open a connection per cell. Assignments, q variables, process configuration, and namespace state remain visible across q cells that choose the same target.

Every direct q cell uses the same complete-source path as **Run q Script**. The extension groups physical q lines on the client, including indentation continuations, comments, top-level system commands, and q's bare-`\` trailing-script-comment convention, then evaluates the groups in order through ordinary q `value`. It saves the process's current namespace, enters the profile's configured namespace, and restores the saved namespace after success or q error. A source system command retains normal q semantics and can affect later groups within that run; the outer wrapper still restores the pre-run namespace afterward.

This path has no `.Q.ld` or q release-date gate. Deterministic tests simulate missing `.Q.ld` through the full direct-cell request, while the available live test uses the installed modern q runtime. Version 0.2.8 does not state an exact minimum q version or claim a live historical-q run.

A saved but disconnected target may connect on demand after an explicit KX execution gesture. Its profile/global connect and query timeouts apply. A missing mixed target stays actionable rather than falling through. Connect, timeout, q, and decode failures become sanitized notebook error output; credentials are not included.

Cancellation before dispatch prevents the query. Cancellation after a synchronous IPC request was sent ends the local wait; mixed mode writes a cancellation result only if the q cell is still unchanged, while the optional selected controller completes its native execution. q work or side effects already sent may continue on the server. Version 0.2.8 does not claim server-side interruption.

## Live KX result and saved snapshot

A successful Direct IPC result from the default mixed runner or optional controller has two representations:

1. an extension-host live result backed by the decoded q value; and
2. a safe bounded `application/vnd.kx.result+json` version 1 snapshot plus `text/plain` fallback stored in notebook output.

While the live record exists, the notebook renderer uses the same first-party KX result model and display policies as the standard KX Results panel. A newly completed mixed-runner edit binds its replacement cell/output back to the staged live record, so the first render can immediately page, export, chart, and hand off the full value instead of falling through to **Saved preview**. The optional selected KX controller binds its native output through the same live registry. q general null/no-value responses produced by assignments, declarations, and calls such as `hopen`, plus generic empty values, render as compact qText. A genuine typed zero-row q table stays a table and retains its schema.

The renderer and standard panel consume one KX Results UI contract for toolbar labels, formats, chart families, settings definitions, state summaries, focus behavior, and theme tokens. A live table exposes **Output:**, CSV/XLSX/TSV/JSON/NDJSON/HTML/Markdown, **Headers**, **Row #**, **Copy**, **Export**, **Chart**, **Columns**, and **Settings**. XLSX is export-only. With no selected rectangle, Copy or Export uses every visible column in its current order; otherwise it uses the selected range. The toolbar wraps or overflows at narrow cell widths without removing working actions.

Live tables size naturally for small results and use a bounded default for larger results. The viewport can be resized vertically; horizontal and vertical scroll positions remain stable while virtual rows and columns update; headers and row numbers stay fixed without covering cells. Three-state sort, bounded Search with explicit **Prev**/**Next**, drag selection, Shift-range selection, and keyboard navigation remain available. Columns can be shown, hidden, reset, moved, and resized; drag a header edge to set one positional width or double-click it to reset that position. Live slice, search, sort, copy, export, and chart requests honor the visible order. Inline clipboard work is capped at 20,000 cells. File export is performed by the extension host and uses the shared copy/export confirmation threshold.

Notebook and panel grids share one sparse map of persistent zero-based original/source-position widths plus the **Auto-fit columns** checkbox and **Whole result**/**Visible rows** scope. The map is not limited by the notebook transport's bounded live-column count, and legacy array-shaped state is normalized on read. Hide/reorder operations do not retarget source slots. Whole-result fitting is the stable default: a live record measures all rows in its full in-memory result, including off-screen array/list values, while a saved preview can measure only its persisted rows. Visible-row mode adapts to the current virtual slice/page. Unchecking auto-fit runs no automatic measurement. Manual widths override auto-fit; **Reset column widths**, **Cell width**, and density preset changes clear every positional override consistently.

The full panel retains interactions tied to its editor-sized host: the draggable table/chart splitter, running-query controls, and the local data server. Those host-specific controls do not justify a different notebook toolbar or data/display model. **Open in KX Results** hands the same decoded live value to that exact panel without rerunning q.

Inline charts use the same real capability model as the panel:

| Type | Required controls | Group By |
| --- | --- | --- |
| Line, scatter, step, bar | X and one or more Y series | Available for a categorical column |
| Box | X and one or more numeric Y series | Unavailable |
| Candlestick | X and distinct Open, High, Low, Close fields | Unavailable |

Decoded q numeric types (`byte`, `short`, `int`, `long`, `real`, `float`) are valid Y/OHLC values. q `timestamp`, `month`, `date`, `datetime`, `timespan`, `minute`, `second`, and `time` columns are temporal X choices for every chart family above and are not offered as numeric Y/OHLC fields. Saved portable schema uses the same classification.

The notebook does not expose a redundant Point cap control. Shared `vscode-kdb.results.viewer.chartMaxSourceRows` and chart sampling defaults still bound work, and live inline chart requests have a hard 10,000-point safety ceiling. Compact status text reports sampling or validation. Configuration changes leave the old rendered chart visible until **Render** is pressed. The chart stays below the table. Multi-series charts keep a visible color-keyed legend; its pointer and **Enter**/**Space** buttons expose accurate pressed/hidden state, and the Y-series selector repeats the same swatches beside selected and available names. The selector stays contained and scrollable at narrow widths. Axis labels/ticks remain readable while gridlines stay secondary because both use VS Code theme tokens rather than fixed light/dark colors. Legend-hidden series remain hidden through zoom, Reset zoom/double-click, explicit rerender, resize, renderer settings messages, and compatible configuration updates.

Every distinct completed live-handle zoom, including a second zoom nested inside a refined response, requests its absolute range from the retained full source after the debounce. Identical scale notifications are deduplicated, while programmatic reconstruction/settings/resize/hide-show scales do not recursively request data. A refined range keeps every eligible row through 7,000 (including below 3,000 without upsampling) and reduces larger ranges to about 7,000. **Reset zoom** invalidates stale replies and restores the original full sample/domain without another request. **Export PNG** uses the extension save dialog.

`vscode-kdb.results.*` is the common durable settings source for notebook output and the standard panel. Supported density/sizing, positional column widths, auto-fit controls, copy/export threshold, array formatting, qText and value-display strategies, elapsed-time display, and chart precision/source/sampling changes use a validated renderer/extension message path. A supported setting or manual width changed inline updates the same global VS Code configuration used by other KX notebook outputs and open KX panels, and survives VS Code restart. Stored font size `0` still means the VS Code default and remains numeric in messages/configuration; notebook Settings shows it as **Auto**. The overlay is constrained and scrollable within the result, has a visible **Close** action, closes with **Escape**, and returns keyboard focus to its summary. Selection, visible-column order, sort, search, result height, chart configuration, legend-hidden state, and zoom remain transient per-output UI state.

### Exact live lifetime

The live registry exists only in memory for the current extension-host session:

- every opaque record is bound to its notebook URI and current cell URI (mixed mode rebinds it after the output edit replaces the q cell handle);
- rerunning a cell replaces that cell's record;
- removing a cell removes that cell's record;
- closing a notebook removes all records for that notebook;
- deactivation clears the registry; and
- a maximum of 512 records is retained, with the oldest evicted first.

The opaque live ID persisted beside the snapshot is not an IPC handle and cannot recreate a result. Output metadata also carries an opaque binding ID so extension-host actions can target the exact cell output; direct output may reuse the live ID as that targeting value. It contains no result or connection data and grants no reopened live access. If a record is absent because the notebook was reopened, the extension host ended, the cell was rerun, the notebook closed, or the cap evicted it, the renderer falls back to the saved bounded snapshot.

### Portable snapshot limits

| Limit | Default | Accepted range |
| --- | --- | --- |
| `vscode-kdb.notebook.maxOutputRows` | `20` | `1`-`10000` |
| `vscode-kdb.notebook.maxOutputBytes` | `1000000` | `16384`-`10000000` |
| Portable columns | n/a | At most `256` |
| Portable cell text | n/a | At most `32768` characters |

First-party direct output contains typed bounded rows, schema, total and preview counts, truncation reasons, safe provenance, and `text/plain`. At the default, tables with 20 rows or fewer persist every row; larger tables persist a 20-row preview with headers/schema and an explicit omitted-row notice. The current live session value remains full and virtualized in KX Results, but the `.ipynb` does not own it. Direct output does not add `text/html` or a persisted chart specification. The separate Python companion can add escaped `text/html` and an optional persisted chart specification. Neither route stores credentials, passwords, authentication tokens, connection objects, recoverable IPC handles, or the unbounded live result; the first-party output-binding ID described above is opaque targeting metadata, not an authentication or data-recovery token. The companion does not emit that extension binding. Omitted rows cannot be recovered from a saved or reopened `.ipynb`.

The saved-result renderer keeps the same table hierarchy, shared output formats, visible-column controls, positional resizing/auto-fit behavior, range behavior, explicit truncation notices, and capability-valid chart workflow, but every data action is limited to persisted rows. It identifies itself as **Saved preview**, reports stored versus total rows, and offers **Open saved preview** and **Rerun cell** when no live handle exists. Opening, copying, exporting, or charting that preview never claims or reconstructs omitted rows. Whole-result auto-fit and saved-preview zoom operate only within stored data; saved zoom cannot request refinement outside it. Direct saved-output chart choices remain transient and do not write a chart specification. A compatible chart specification emitted by the Python helper remains persisted. Python-helper HTML/PDF export uses its escaped, network-free static fallback and does not preserve arbitrary interactive controls.

`vscode-kdb.notebook.presentation` accepts:

- `inline` (default);
- `panel`; or
- `both`.

These automatic modes apply to Python-helper output. First-party KX direct results always remain inline beneath the cell. A live value opens in the full panel while its record exists. Expired/reopened output can open only the bounded rows stored in the notebook; **Rerun cell** is an explicit new execution, not recovery of the old live value.

## Separate Python `%%q` helper route

Use the released `kx-notebook==0.1.0` companion only when q should run through the selected Python/IPython kernel. Its distribution name is `kx-notebook`; its import and IPython extension name is `kx_notebook`. This is distinct from mixed mode's **Run q Cell (KX)**: the companion remains inside Python, requires `%%q`, and does not share q variables, namespace state, session identity, live-result records, or output-binding metadata with extension-managed Direct IPC.

Python 3.9 through 3.13 is supported. Install the exact release into the same environment selected as the notebook kernel:

```sh
uv venv /tmp/vscode-kdb-kx-notebook
uv pip install --python /tmp/vscode-kdb-kx-notebook/bin/python \
  'kx-notebook==0.1.0'
```

The package is not bundled in the VSIX, and the extension never installs or modifies a kernel environment automatically. q itself is not bundled.

Direct q IPC is built in. Start the q process separately, then load and connect from Python cells:

```python
%load_ext kx_notebook
%kx connect localhost:5000
```

The connection and its q state belong to the Python process, not KX for VS Code. Named companion profiles are selected explicitly with `%kx use PROFILE` or `%%q --profile PROFILE`; profiles may store endpoint and credential-lookup metadata, but not secret values.

Three alternatives to the default direct evaluator are explicit and opt-in:

- a synchronous application callback configured with `kx_notebook.configure_evaluator`;
- `kx_notebook.evaluators.PyKXEvaluator`, with PyKX separately installed, configured, licensed, and selected; or
- `kx_notebook.evaluators.BrokerEvaluator`, supplied a loopback broker URL and bearer token at runtime.

The package does not discover or borrow the extension's connection, does not bundle PyKX or a broker, and does not persist a broker token.

### Prepare and run through Python

Leave the cell's language as Python and use normal Jupyter Run:

```q
%%q --max-rows 20 --max-bytes 1000000
select from trade where date=.z.D
```

`%%q` is IPython syntax, so a companion cell stays Python-language even though its body is q. A durable extension Direct IPC cell instead stays q-language and uses **Run q Cell (KX)**. Do not switch the same cell back and forth between the routes. The extension's Tag/Prepare editing aids are not required by `kx-notebook` 0.1.0 and do not turn an extension Direct IPC cell into companion execution.

The released `kx-notebook==0.1.0` companion emits the same bounded version 1 MIME contract plus escaped `text/html` and `text/plain` fallbacks. Its marker limits bound persisted output, not server-side q execution. It receives no extension live-result identity or output binding, even if its independently configured evaluator targets the same external q process. The extension cannot reconstruct rows omitted from that MIME bundle or turn it into the helper's original live session.

When more than the bounded helper preview is needed, choose **Run %%q live with KX** on that output (or **KX: Run %%q Preview Live via Direct IPC**). KX resolves or asks for an extension-owned notebook target, shows that target in a modal confirmation, strips only the leading `%%q` directive/options, and submits the remaining q body through the existing first-party complete-cell Direct IPC runner. This is a new execution and session route: it does not call Jupyter Run, reuse the Python evaluator/session, or silently choose a connection. The cell remains Python-language and the selected Python kernel does not change. The replacement result is first-party and live/full while its new extension-host record exists.

When a helper evaluator returns `EvaluationResult(..., chart=Chart(...))`, `Chart.type` accepts `line`, `scatter`, `step`, `bar`, `box`, or `candlestick`. Line/scatter/step/bar may use `group_by_column`. Candlestick requires `y_columns=()` plus distinct `open_column`, `high_column`, `low_column`, and `close_column` fields. The interactive renderer supports all six; the static HTML fallback draws only ungrouped line/scatter/step/bar and clearly reports grouped, box, or candlestick selections as interactive-only.

## Cell metadata

VS Code's built-in Jupyter serializer can persist a non-default q cell as:

```json
{
  "metadata": {
    "vscode": {
      "languageId": "q"
    }
  }
}
```

That serializer-owned field is separate from the extension's optional nested `metadata.vscode-kdb` marker/limit object. Direct IPC q cells rely on the serializer-owned q language plus extension target metadata. A released-companion cell remains Python-language and persists `%%q` in its source; `kx-notebook` 0.1.0 does not require the extension tag metadata.

## Evidence boundary

Focused pure/provider tests cover default non-registration and opt-in controller registration/disposal, mixed action/toolbar/context/keybinding guards, q language assignment without a controller switch, current stable-ID target routing after same-profile endpoint edits and active changes, missing-target prompts, namespace/session continuity, complete-cell dispatch, Python-cell isolation, race/error/cancellation handling, live result lifetime, bounded snapshots, shared settings messages, companion-route separation, and bans on private Jupyter/SQLTools runtime coupling. `npm run test:notebook-cross` separately installs exactly `kx-notebook==0.1.0`, verifies `import kx_notebook`, and validates the released package's emitted version-1 MIME payload with the TypeScript contract.

The scoped real Extension Host smoke uses isolated VS Code user data and the actual `ConnectionStore` to add two application/global profiles, set active selection, edit the same targeted ID from port `5005` to `5000`, confirm both profiles remain, resolve the notebook target to current port `5000`, verify the optional controller is not registered by default, and clean up its settings, secrets, and global state. It also verifies actual q-language and KX metadata persistence through save, close, and reopen, then restores the notebook default. That smoke remains non-visual and does not automate the connection webview, top-right kernel selector, toolbar/status layout, or target QuickPick.

`npm run test:notebook-results-visual` is the narrower real UI check for this result surface. It starts q, runs a deterministic gallery in an isolated VS Code Extension Host under Xvfb, and keeps the existing set of 12 validated screenshots. They cover light/dark tables and charts, visible and hidden color-keyed legends, readable dark axes, selector swatches and narrow containment, **Auto** font-size and scrollable Settings, opt-in qText readability, tracked-file save/close/reopen preview behavior, live-full state, and all six chart families. Renderer automation also exercises live range selection/search, column and settings menus, saved range selection/search, chart rendering, pointer and keyboard legend toggling, drag zoom, Settings Close/Escape/focus return, settings-rerender persistence, and Reset zoom. Native clipboard ownership, save dialogs, panel handoff, and rerun replacement remain protocol/runtime evidence rather than screenshot claims.

That acceptance scope is local Linux VS Code Extension Host/Xvfb with the installed q binary reached over loopback. Remote and devcontainer acceptance were not run. The Docker daemon is unavailable on this host, which is a hard blocker for Docker-backed remote/devcontainer coverage.
