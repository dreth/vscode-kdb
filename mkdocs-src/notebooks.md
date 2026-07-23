# Jupyter/IPython Notebooks

KX for VS Code 0.2.1 renders persistent, bounded KX/q results inside ordinary Jupyter/IPython `.ipynb` code-cell outputs. The notebook stays an ordinary notebook: Python cells use the normal selected Python kernel, Markdown cells use normal notebook Markdown, and q cells execute only through an explicitly configured IPython helper callback.

The implementation does not contribute or intercept a Jupyter controller, patch Microsoft Jupyter, use private APIs, reinterpret `.q` documents as notebooks, or create a second direct q connection. Normal `.q` editor execution and the full KX Results panel remain unchanged.

## Install the companion helper

`python/kx_notebook` is a focused Python package that depends on IPython but bundles no q runtime, PyKX binary, credential, IPC connection, or remote bridge. Install it into the same Python environment selected as the notebook kernel. For source development with an isolated `uv` environment:

```sh
uv venv /tmp/vscode-kdb-kx-notebook
uv pip install --python /tmp/vscode-kdb-kx-notebook/bin/python \
  --editable ./python/kx_notebook
```

The VSIX includes the same installable source package at `python/kx_notebook`; installation into a selected kernel is explicit and is never performed by the extension.

Run its tests without installing anything into system Python:

```sh
uv run --no-project --with-editable ./python/kx_notebook \
  python -m unittest discover -s python/kx_notebook/tests -v
```

## Configure the evaluator

`%%q` has no implicit connection. Configure exactly one synchronous evaluator callback in the Python kernel, then load the IPython extension:

```python
from kx_notebook import configure_evaluator

def evaluate_in_my_existing_session(source: str):
    # This callback owns q execution and returns a bounded table-like value.
    return my_existing_q_session(source)

configure_evaluator(
    evaluate_in_my_existing_session,
    label="existing kernel q session",
)
%load_ext kx_notebook
```

The callback receives the q cell body exactly and is the sole source of notebook execution. An actionable error is raised if no evaluator is configured or it returns an awaitable.

For local tests/examples, `FixtureEvaluator` maps exact source strings to fixed table-like values. It is not a q parser and makes no live-q claim.

### Optional PyKX

If PyKX is already installed, licensed, and configured in that kernel, opt in explicitly:

```python
from kx_notebook.pykx import configure_pykx

configure_pykx()
%load_ext kx_notebook
```

The adapter uses that kernel's existing `pykx.q` object and takes a bounded prefix before converting a table-like value to Python. `kx_notebook` never installs PyKX and never shares the VS Code extension's direct q IPC connection.

## Tag and run a q cell

Select one or more notebook code cells and use **KX: Tag Notebook Cell as q**. The command inserts a durable marker when one is absent:

```q
%%q --max-rows 1000 --max-bytes 1000000
select from trade where date=.z.D
```

It also writes namespaced cell metadata equivalent to:

```json
{
  "vscode-kdb": {
    "version": 1,
    "language": "q",
    "marker": "%%q",
    "rowLimit": 1000,
    "byteLimit": 1000000
  }
}
```

The `%%q` marker is the durable portable convention; the metadata helps VS Code present q-specific actions. The implementation does not rely on a Python notebook controller preserving a `q` cell language ID.

The command only tags cells. Run the cell with the notebook's normal execution action. IPython invokes the registered helper magic; ordinary Python cells are unaffected. KX for VS Code adds no notebook execution keybinding and does not steal `Ctrl+Enter` or `Ctrl+Shift+Enter`.

The marker may also accept a quoted safe label:

```q
%%q --max-rows 250 --max-bytes 524288 --label "trades preview"
select from trade where sym=`AAPL
```

Options are validated before the callback runs. They bound persisted output only; they do not add a server-side limit to the q expression. The evaluator remains responsible for safe q execution and any server-side limit.

## Persistent MIME output

The helper emits one ordinary IPython MIME bundle with:

- `application/vnd.kx.result+json`, contract version 1, for the VS Code renderer;
- escaped, self-contained `text/html` for Jupyter/nbconvert HTML and PDF paths; and
- readable `text/plain` for plain notebook viewers.

The rich payload contains a typed bounded row representation, column names/types, total and persisted-preview row counts, configured row/byte limits, truncation reasons, safe optional label and elapsed time, optional q source display text, and an optional persisted chart specification. q source is included only when the helper is configured to do so. Credentials, passwords, tokens, IPC handles, connection objects, and arbitrary notebook execution state are not fields in the contract.

The renderer strictly validates the untrusted JSON contract before rendering. Result and source text are placed into DOM text nodes; the grid does not interpolate untrusted HTML.

### Bounds and truncation

| Limit | Default | Accepted range |
| --- | --- | --- |
| `vscode-kdb.notebook.maxOutputRows` | `1000` | `1`-`10000` |
| `vscode-kdb.notebook.maxOutputBytes` | `1000000` | `16384`-`10000000` |

The tag command writes the current defaults into new `%%q` markers. The helper enforces the explicit marker values and removes preview rows as needed to satisfy the byte budget. The output preserves schema, total row count where supplied by the evaluator, preview count, and truncation reasons.

Omitted data is not placed elsewhere in notebook metadata. It remains only in the originating evaluator/session while that system retains it. Saving, reopening, copying, exporting, or opening the saved preview in the KX panel cannot recover omitted rows.

## Inline renderer

The VS Code NotebookRenderer provides:

- provenance label, elapsed time, total row count, and saved preview count;
- a compact bounded table that renders saved rows in pages;
- safe copy of the persisted preview as CSV;
- clear row/byte/cell/column truncation notices;
- show/hide table and chart controls;
- local uPlot line, scatter, step, and bar charts for eligible saved columns;
- chart type, X column, Y series, point-cap controls, and Reset zoom; and
- **Open saved preview in KX panel** when extension messaging is available.

The chart configuration emitted by `kx_notebook` is part of the MIME payload and persists. Renderer-only control changes are intentionally session state; they do not silently mutate the notebook output. To persist a changed chart selection, re-emit the output with the desired `kx_notebook.Chart` specification.

## Static export

The `text/html` fallback is self-contained, escaped, and network-free. It includes the table schema, total and preview row counts, a bounded table preview, truncation/transfer notices, and a static SVG when the emitted chart specification can be represented. `text/plain` carries the same essential counts and omitted-data warning.

Notebook HTML/PDF export is static. It does not preserve uPlot zoom, tooltips, control changes, clipboard actions, or arbitrary interactive state, and PDF is never described as an interactive chart format.

## Presentation setting and KX panel handoff

`vscode-kdb.notebook.presentation` accepts:

- `inline` (default): render the persistent KX output in the notebook;
- `panel`: open the saved bounded preview in the KX Results panel instead of showing the inline table/chart; or
- `both`: keep the inline output and automatically open the saved preview in the panel.

The panel handoff is deliberately a saved-preview view. It does not find a live q result, share an IPC handle, rerun q, or recover omitted rows. **KX: Open Saved Notebook Preview in Results Panel** is enabled only when the selected cell contains a valid saved KX MIME output. A reopened notebook can render and hand off its saved preview without the originating session.

## Same-session boundary

The conceptual source of a notebook result is the evaluator explicitly configured in that Python kernel. Version 0.2.1 does not have a supported way to route a normal Jupyter cell through the extension's existing direct q IPC session without intercepting the controller. Rather than create a misleading second connection, extension-driven notebook selection execution is disabled and deferred.

Use the callback or optional PyKX adapter when the Python kernel already owns the intended q session. Use normal `.q` editor commands when the extension-owned direct IPC session and its live full-result KX panel are required.
