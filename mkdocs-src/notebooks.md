# Jupyter/IPython Notebooks

KX for VS Code 0.2.7 supports two clear first-party notebook modes:

| Selected notebook kernel + cell | Use |
| --- | --- |
| Python selected + Python cell | normal Run |
| Python selected + q cell | **Run q Cell (KX)** / `Ctrl+Enter` |
| KX q selected + q cell | normal Run |

VS Code selects one controller for the notebook. KX does not patch Jupyter or pretend built-in Run can dispatch cells through multiple selected controllers. The mixed action is an explicit second execution gesture for q-language cells; it leaves the Python controller and Python cells untouched.

## Mode 1: q-only Direct IPC controller

Version 0.2.7 includes:

- controller ID `vscode-kdb.q-notebook-controller`;
- notebook type `jupyter-notebook`;
- label **KX q (Direct IPC)**; and
- `supportedLanguages = ["q"]`.

Open an ordinary `.ipynb`, use the notebook's top-right kernel/controller selector or **Notebook: Select Notebook Kernel**, and choose **KX q (Direct IPC)**. This is VS Code's native controller/kernel surface, analogous to choosing another language kernel. It is not an entry in the Python controller's per-cell language picker and does not masquerade as a Python kernel.

The controller is registered dynamically through `vscode.notebooks.createNotebookController`. The manifest's `onNotebook:jupyter-notebook` activation event ensures the extension activates for an ordinary Jupyter notebook. No private Jupyter API, `ms-toolsai.jupyter` runtime import, or hidden command interception is used.

### Run complete q cells normally

With the direct controller selected, use normal **Run Cell**, **Run All**, or `Ctrl+Enter` / `Cmd+Enter`. VS Code calls the controller execution handler with the complete cell source. No selection or alternate KX run gesture is required. The mixed-mode KX shortcut and inline action stand down while this controller is selected. A leading `%%q` is rejected; remove it, or use the separate Python helper route.

The controller advertises q, so q-language code cells use the extension's TextMate grammar. If an existing code cell still has another language, use VS Code's normal cell-language picker to choose q. Mixed-mode Make/Run controls remain suppressed while the native KX controller is selected. **KX: Restore Notebook Cell Language** remains a secondary editing aid.

Markdown is ignored. A non-q code cell is never dispatched to q and receives a clear output that the direct controller supports q only.

## Mode 2: mixed Python and q

Keep the normal Python Jupyter controller selected. Python cells continue to use Jupyter's Run commands, execution order, variables, and outputs. KX never changes their language, controller, or source.

For each intended q cell:

1. Click the leading **Make q Cell (KX)** action. It changes the complete code cell's language to q without changing the selected Python kernel.
2. Choose the visible notebook-level `q default` target from saved KX profiles.
3. Use the leading **Run q Cell (KX)** play action or focused-cell `Ctrl+Enter` / `Cmd+Enter`.
4. Read the route from status: `KX: <profile> · Ctrl+Enter` (`Cmd+Enter` on macOS).

The action sends the complete cell source through the selected notebook target's direct KX session. It does not require `%%q`, select the KX controller, or mutate the Python controller. **KX: Restore Notebook Cell Language** restores the notebook's declared default language.

Only safe `{id, name}` profile identity/display metadata is saved in the `.ipynb`; host, namespace, username, password, and connection objects are excluded. The globally active KX profile is offered first as a convenience, never used as an invisible fallback. A renamed profile resolves by stable ID. A removed profile shows **Select connection** and must be replaced explicitly, so mixed q never routes to list order or another profile by accident.

Because Python remains the selected controller, public APIs do not let KX own a native cell execution in mixed mode. **Run q Cell (KX)** leaves the old output visible while q runs, then commits the finished KX output as one normal undoable notebook edit. The edit marks the notebook dirty until saved and gives that q cell a new internal VS Code cell handle. It preserves the q source, q language, cell metadata, and every sibling Python/Markdown cell; it does not copy an old native execution order/timing summary onto the new KX output. If the q cell source, language, output, or execution state changes while KX is waiting, KX refuses to overwrite the newer state.

### Focused q-cell shortcut

While the q cell editor itself has text focus, the contributed default `Ctrl+Enter` on Windows/Linux or `Cmd+Enter` on macOS invokes **Run q Cell (KX)**. The public manifest guard requires all of:

- notebook cell editor and editor text focus;
- notebook type `jupyter-notebook`;
- code cell type;
- language exactly `q`;
- resource scheme `vscode-notebook-cell`; and
- **KX q (Direct IPC)** not selected.

It cannot match Python, Markdown, an ordinary source editor, output focus, or a cell container without editor focus. In those other focus states VS Code's normal notebook shortcut remains in charge; use the visible KX action for q execution. Extension default bindings outrank the built-in notebook rule when this exact guard matches, while later user/keymap rules can still override any default shortcut. If `Ctrl+Enter` / `Cmd+Enter` was customized, use the toolbar/context/Command Palette action or inspect **Developer: Toggle Keyboard Shortcuts Troubleshooting**. Clicking normal Python Run on a q-language cell remains standard Jupyter behavior and is not secretly duplicated by KX.

## Active connection and shared q session

The q-only controller uses the active profile in **KX Connections**. Mixed cells use the notebook's explicit q target. Both reuse the profile-keyed `ConnectionManager` client and q process/session; they do not open a connection per cell. Assignments, q variables, process configuration, and namespace state remain visible across q cells that choose the same target.

Every direct q cell uses the same complete-source path as **Run q Script**. The extension groups physical q lines on the client, including indentation continuations, comments, top-level system commands, and q's bare-`\` trailing-script-comment convention, then evaluates the groups in order through ordinary q `value`. It saves the process's current namespace, enters the profile's configured namespace, and restores the saved namespace after success or q error. A source system command retains normal q semantics and can affect later groups within that run; the outer wrapper still restores the pre-run namespace afterward.

This path has no `.Q.ld` or q release-date gate. Deterministic tests simulate missing `.Q.ld` through the full direct-cell request, while the available live test uses the installed modern q runtime. Version 0.2.7 does not state an exact minimum q version or claim a live historical-q run.

A saved but disconnected target may connect on demand after an explicit KX execution gesture. Its profile/global connect and query timeouts apply. A missing mixed target stays actionable rather than falling through. Connect, timeout, q, and decode failures become sanitized notebook error output; credentials are not included.

Cancellation before dispatch prevents the query. Cancellation after a synchronous IPC request was sent ends the local wait; the selected q controller completes its native execution, while mixed mode writes a cancellation result only if the q cell is still unchanged. q work or side effects already sent may continue on the server. Version 0.2.7 does not claim server-side interruption.

## Live KX result and saved snapshot

A successful result from either first-party KX mode has two representations:

1. an extension-host live result backed by the decoded q value; and
2. a safe bounded `application/vnd.kx.result+json` version 1 snapshot plus `text/plain` fallback stored in notebook output.

While the live record exists, the notebook renderer uses the same first-party KX result model and display policies as the standard KX Results panel. q general null/no-value responses produced by assignments, declarations, and calls such as `hopen`, plus generic empty values, render as compact qText. A genuine typed zero-row q table stays a table and retains its schema.

The renderer is a compact adaptation of the standard KX Results interaction model:

- the one-line header uses **KX Results** and **Settings**;
- table controls use Search, match status, and Chart;
- Search `Enter` / `Shift+Enter` navigate next/previous matches without separate buttons;
- selection copy appears only after selecting cells, in a compact **Tools** menu with one format selector and one Copy action; and
- no inert Reset Size, default disabled match-navigation, duplicate Copy TSV/CSV, or placeholder controls are shown.

Live tables size naturally for small results and use a bounded default for larger results. The viewport can be resized vertically; horizontal and vertical scroll positions remain stable while virtual rows and columns update; headers and row numbers stay fixed without covering cells. Three-state sort, drag selection, Shift-range selection, and keyboard navigation remain available. A selected rectangle of at most 20,000 cells can be copied through the owning extension-host record, including selected rows outside the currently loaded virtual slice. Inline search stops after 1,000 matches, 2,000,000 cells, or about 1.5 seconds. Inline sort declines results with 250,000 or more rows. Column hide/reorder and full export remain panel features. **KX Results** hands the same live value to the full panel.

Inline charts use the same real capability model as the panel:

| Type | Required controls | Group By |
| --- | --- | --- |
| Line, scatter, step, bar | X and one or more Y series | Available for a categorical column |
| Box | X and one or more numeric Y series | Unavailable |
| Candlestick | X and distinct Open, High, Low, Close fields | Unavailable |

The notebook-only visible Point cap is removed. Shared `vscode-kdb.results.viewer.chartMaxSourceRows` and chart sampling defaults still bound work, and compact status text reports sampling or validation. Configuration changes leave the old rendered chart visible until **Render** is pressed. Legend-hidden series remain hidden through zoom, Reset zoom/double-click, explicit rerender, resize, renderer settings messages, and compatible configuration updates. Zoom refinement remains available after opening the value in the full KX Results panel; the notebook renderer does not advertise a Refine action it cannot perform.

`vscode-kdb.results.*` is the common durable settings source for live notebook results and the standard panel. Supported density/sizing, array formatting, qText and value-display strategies, elapsed-time display, and chart changes use a validated renderer/extension message path. A supported setting changed from a live notebook result updates the same global VS Code configuration used by other live q cells and open KX panels.

### Exact live lifetime

The live registry exists only in memory for the current extension-host session:

- every opaque record is bound to its notebook URI and current cell URI (mixed mode rebinds it after the output edit replaces the q cell handle);
- rerunning a cell replaces that cell's record;
- removing a cell removes that cell's record;
- closing a notebook removes all records for that notebook;
- deactivation clears the registry; and
- a maximum of 512 records is retained, with the oldest evicted first.

The opaque ID persisted beside the snapshot is not an IPC handle and cannot recreate a result. If a record is absent because the notebook was reopened, the extension host ended, the cell was rerun, the notebook closed, or the cap evicted it, the renderer falls back to the saved bounded snapshot.

### Portable snapshot limits

| Limit | Default | Accepted range |
| --- | --- | --- |
| `vscode-kdb.notebook.maxOutputRows` | `20` | `1`-`10000` |
| `vscode-kdb.notebook.maxOutputBytes` | `1000000` | `16384`-`10000000` |
| Portable columns | n/a | At most `256` |
| Portable cell text | n/a | At most `32768` characters |

First-party direct output contains typed bounded rows, schema, total and preview counts, truncation reasons, safe provenance, and `text/plain`. At the default, tables with 20 rows or fewer persist every row; larger tables persist a 20-row preview with headers/schema and an explicit omitted-row notice. The current live session value remains full and virtualized in KX Results, but the `.ipynb` does not own it. Direct output does not add `text/html` or a persisted chart specification. The separate Python helper can add escaped `text/html` and an optional persisted chart specification. Neither route stores credentials, passwords, tokens, connection objects, recoverable IPC handles, or the unbounded live result. Omitted rows cannot be recovered from a saved or reopened `.ipynb`.

The saved-result renderer provides the same compact table/Tools/Chart model, stable two-axis scrolling, range selection copy, explicit truncation notices, and all capability-valid chart selectors over the stored rows. Direct saved-output chart choices are transient and do not write a chart specification. A compatible chart specification emitted by the Python helper remains persisted. Python-helper HTML/PDF export uses its escaped, network-free static fallback and does not preserve arbitrary interactive controls.

`vscode-kdb.notebook.presentation` accepts:

- `inline` (default);
- `panel`; or
- `both`.

These automatic modes apply to Python-helper output. First-party KX direct results always remain inline beneath the cell and expose a concise KX Results action: live values open in the full panel while their record exists; expired/reopened output opens only the bounded rows stored in the notebook. No mode or handoff reruns q or recovers omitted rows.

## Separate Python `%%q` helper route

Use `python/kx_notebook` only when q must run through an evaluator owned by the selected Python/IPython kernel. This is distinct from mixed mode's **Run q Cell (KX)**: the helper remains inside Python, requires `%%q`, and does not share q variables, namespace state, or session identity with direct KX execution by implication.

The helper bundles no q runtime, PyKX binary, credential, IPC connection, or remote bridge. Install it into the same Python environment selected as the notebook kernel:

```sh
uv venv /tmp/vscode-kdb-kx-notebook
uv pip install --python /tmp/vscode-kdb-kx-notebook/bin/python \
  --editable ./python/kx_notebook
```

The VSIX includes the source package under `python/kx_notebook`, but the extension never modifies a kernel environment automatically.

Configure one synchronous evaluator inside the Python kernel:

```python
from kx_notebook import configure_evaluator

def evaluate_in_my_existing_session(source: str):
    return my_existing_q_session(source)

configure_evaluator(
    evaluate_in_my_existing_session,
    label="existing kernel q session",
)
%load_ext kx_notebook
```

The callback receives the q body exactly and owns execution. If PyKX is already installed, licensed, and configured in that kernel, the optional explicit adapter is:

```python
from kx_notebook.pykx import configure_pykx

configure_pykx()
%load_ext kx_notebook
```

The adapter uses that kernel's existing `pykx.q` object. It never installs PyKX or borrows the extension's Direct IPC client.

### Prepare and run through Python

With a Python controller selected:

1. Use **KX: Tag Notebook Cell as q** while editing to set q highlighting and add a durable marker.
2. Keep the leading marker:

   ```q
   %%q --max-rows 20 --max-bytes 1000000
   select from trade where date=.z.D
   ```

3. Use **KX: Restore Notebook Cell Language** so the Python controller accepts the cell while the marker remains.
4. Use normal Run; IPython invokes the registered magic.

The contextual **Prepare this q cell for the active Python kernel** action adds the marker and KX metadata without executing. Tag/Prepare actions are hidden while the direct controller is selected to avoid presenting the Python route as a direct-controller requirement.

The helper emits the same bounded version 1 MIME contract plus escaped `text/html` and `text/plain` fallbacks. Its marker limits bound persisted output, not server-side q execution. The helper never opens a connection and never receives a Direct IPC live-result identity. A user callback may independently target the same external q process, but that is user-owned configuration—not extension-managed state sharing.

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

That serializer-owned field is separate from the helper's nested `metadata.vscode-kdb` marker/limit object. Tagging merges its metadata without deleting unrelated fields and preserves an existing leading `%%q` marker.

## Evidence boundary

Focused pure/provider tests cover controller identity/type/label/language, registration/disposal, mixed action/toolbar/context/keybinding guards, native-controller preservation, native active-profile routing, mixed explicit-target resolution, namespace/session continuity, complete-cell dispatch, Python-cell isolation, race/error/cancellation handling, live result lifetime, bounded snapshots, shared settings messages, helper-route separation, and bans on private Jupyter/SQLTools runtime coupling.

The scoped real Extension Host smoke adds activation, contributed-command, isolated multi-profile configuration/active-selection, and actual notebook language conversion/restoration evidence. It does not automate the connection webview, kernel selector, toolbar/status layout, target QuickPick, or q execution, so there is no standalone visual UI E2E claim.
