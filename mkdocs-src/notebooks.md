# Jupyter/IPython Notebooks

KX for VS Code 0.2.3 supports two explicit q notebook routes. They have different session ownership and must not be confused.

| Route | Select in VS Code | Execution/session | Cell source |
| --- | --- | --- | --- |
| **KX q (Direct IPC)** | Notebook's normal kernel/controller selector | Existing active profile and q client from **KX Connections** | Ordinary q; leading `%%q` is rejected |
| Python/IPython helper | A normal Python Jupyter controller | Evaluator configured inside that Python kernel | Leading `%%q` |

Selecting one route never silently invokes the other. The extension uses only supported VS Code notebook APIs and does not patch or intercept Microsoft Jupyter.

## Native KX q Direct IPC controller

Version 0.2.3 registers:

- controller ID `vscode-kdb.q-notebook-controller`;
- notebook type `jupyter-notebook`;
- label **KX q (Direct IPC)**; and
- `supportedLanguages = ["q"]`.

Open an ordinary `.ipynb`, use the notebook's top-right kernel/controller selector or **Notebook: Select Notebook Kernel**, and choose **KX q (Direct IPC)**. This is VS Code's native controller/kernel surface, analogous to choosing another language kernel. It is not an entry in the Python controller's per-cell language picker and does not masquerade as a Python kernel.

The controller is registered dynamically through `vscode.notebooks.createNotebookController`. The manifest's `onNotebook:jupyter-notebook` activation event ensures the extension activates for an ordinary Jupyter notebook. No private Jupyter API, `ms-toolsai.jupyter` runtime import, or hidden command interception is used.

### Run complete q cells normally

With the direct controller selected, use normal **Run Cell**, **Run All**, or `Ctrl+Enter`. VS Code calls the controller execution handler with the complete cell source. No selection or alternate KX run gesture is required. A leading `%%q` is rejected to prevent route confusion; remove it, or select the Python controller for the helper route.

The controller advertises q, so q-language code cells use the extension's TextMate grammar. If an existing code cell still has another language, select it and use **KX: Set Notebook Cell Language to q**. The inline Set-q button is hidden after the cell is q. **KX: Restore Notebook Cell Language** remains a secondary editing aid.

Markdown is ignored. A non-q code cell is never dispatched to q and receives a clear output that the direct controller supports q only. KX does not intercept a Run owned by a selected Python controller.

### Active connection and session continuity

Direct notebook execution uses the profile currently selected in the first-party **KX Connections** view. The controller description/detail and q cell status identify:

- **Direct IPC**;
- active profile name;
- endpoint and namespace; and
- connected state, or that the saved profile will connect on Run.

The controller uses the same `ConnectionManager` client and q process/session as normal `.q` editor runs. It does not open a per-cell or per-notebook connection. Assignments, q variables, process configuration, and namespace state therefore remain visible across direct notebook cells and editor runs on that active profile. Every direct cell uses the q script/namespace wrapper and requires q 4.0 dated 2023-03-28 or newer (or q 4.1t dated 2022-11-01 or newer).

A saved but disconnected active profile may connect on demand because selecting **KX q (Direct IPC)** was an explicit execution choice. Its profile/global connect and query timeouts apply. If no active saved profile exists, output says **Add or select a KX connection in the KX Connections view**. Connect, timeout, q, and decode failures become sanitized notebook error output; credentials are not included.

Cancellation before dispatch prevents the query. Cancellation after a synchronous IPC request was sent ends the local execution wait and completes the notebook execution reliably, but q work or side effects already sent may continue on the server. Version 0.2.3 does not claim server-side interruption.

## Live direct result and saved snapshot

A successful direct result has two representations:

1. an extension-host live result backed by the decoded q value; and
2. a safe bounded `application/vnd.kx.result+json` version 1 snapshot plus `text/plain` fallback stored in notebook output.

While the live record exists, the notebook renderer uses the same first-party KX result model and display policies as the standard KX Results panel. It supports bounded virtual grid slices, qText/list/dictionary/table display, capped search, bounded sorting, mouse selection/copy within the loaded slice, column scrolling, and sampled uPlot chart requests. Inline search stops after 1,000 matches, 2,000,000 cells, or about 1.5 seconds. Inline sort declines results with 250,000 or more rows. Selection copies TSV only for a rectangle within the loaded slice and at most 20,000 cells. Keyboard grid navigation, column hide/reorder/resize, and full export remain panel features. **Open in KX Results** hands the same live value to the full panel.

`vscode-kdb.results.*` is the common durable settings source for live notebook results and the standard panel. Supported density/sizing, array formatting, qText and value-display strategies, elapsed-time display, and chart changes use a validated renderer/extension message path. A supported setting changed from a live notebook result updates the same global VS Code configuration used by other live q cells and open KX panels.

### Exact live lifetime

The live registry exists only in memory for the current extension-host session:

- every opaque record is bound to its notebook URI and cell URI;
- rerunning a cell replaces that cell's record;
- removing a cell removes that cell's record;
- closing a notebook removes all records for that notebook;
- deactivation clears the registry; and
- a maximum of 512 records is retained, with the oldest evicted first.

The opaque ID persisted beside the snapshot is not an IPC handle and cannot recreate a result. If a record is absent because the notebook was reopened, the extension host ended, the cell was rerun, the notebook closed, or the cap evicted it, the renderer falls back to the saved bounded snapshot.

### Portable snapshot limits

| Limit | Default | Accepted range |
| --- | --- | --- |
| `vscode-kdb.notebook.maxOutputRows` | `1000` | `1`-`10000` |
| `vscode-kdb.notebook.maxOutputBytes` | `1000000` | `16384`-`10000000` |
| Portable columns | n/a | At most `256` |
| Portable cell text | n/a | At most `32768` characters |

Direct-controller output contains typed bounded rows, schema, total and preview counts, truncation reasons, safe provenance, and `text/plain`. It does not add `text/html` or a persisted chart specification. The separate Python helper can add escaped `text/html` and an optional persisted chart specification. Neither route stores credentials, passwords, tokens, connection objects, recoverable IPC handles, or the unbounded live result. Omitted rows cannot be recovered from a saved or reopened `.ipynb`.

The snapshot renderer provides a compact paged table, preview CSV copy, explicit truncation notices, and local uPlot line/scatter/step/bar controls. Direct saved-preview chart choices are transient and do not write a chart specification. Python-helper HTML/PDF export uses its escaped, network-free static fallback and does not preserve arbitrary interactive controls.

`vscode-kdb.notebook.presentation` accepts:

- `inline` (default);
- `panel`; or
- `both`.

These automatic modes apply to Python-helper output. Direct-controller results always remain inline beneath the cell and expose an explicit button: live values open in the full KX Results panel while their record exists; expired/reopened direct output opens only the bounded snapshot. No mode or handoff reruns q or recovers omitted rows.

## Separate Python `%%q` helper route

Use `python/kx_notebook` when q must run through an evaluator owned by the selected Python/IPython kernel. This route remains separate from Direct IPC and does not share q variables, namespace state, or session identity with it by implication.

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
   %%q --max-rows 1000 --max-bytes 1000000
   select from trade where date=.z.D
   ```

3. Use **KX: Restore Notebook Cell Language** so the Python controller accepts the cell while the marker remains.
4. Use normal Run; IPython invokes the registered magic.

The contextual **Prepare this q cell for the active Python kernel** action adds the marker and KX metadata without executing. Tag/Prepare actions are hidden while the direct controller is selected to avoid presenting the Python route as a direct-controller requirement.

The helper emits the same bounded version 1 MIME contract plus escaped `text/html` and `text/plain` fallbacks. Its marker limits bound persisted output, not server-side q execution. The helper never opens a connection and never receives a Direct IPC live-result identity. A user callback may independently target the same external q process, but that is user-owned configuration—not extension-managed state sharing.

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

Focused pure/provider tests cover controller identity/type/label/language, registration/disposal, supported activation, active-profile and namespace routing, session continuity, complete-cell dispatch, q-only filtering, scalar/table/error output, connection failures, cancellation, redaction, live result lifetime, bounded snapshots, shared settings messages, Python-route separation, and bans on private Jupyter/SQLTools runtime coupling.

These checks do not launch a real VS Code Extension Host and are not visual selector, notebook UI, or end-to-end execution evidence.
