# Jupyter/IPython Notebooks

KX for VS Code 0.2.2 gives ordinary Jupyter/IPython `.ipynb` code cells an actual q document language for syntax highlighting and renders persistent, bounded KX/q results in their outputs. The notebook stays ordinary: Markdown remains notebook Markdown, the selected controller remains in charge of execution, and q reaches the current Python kernel only through an explicitly configured IPython helper callback.

The implementation does not contribute or intercept a Jupyter controller, patch Microsoft Jupyter, use private APIs, reinterpret `.q` documents as notebooks, or create a second direct q connection. Normal `.q` editor execution and the full KX Results panel remain unchanged.

## Set the actual q cell language

Select one or more notebook cells, then use any of these equivalent surfaces:

- the q action in the code-cell toolbar;
- the notebook cell context menu; or
- **KX: Set Notebook Cell Language to q** in the Command Palette.

The command calls VS Code's supported `vscode.languages.setTextDocumentLanguage` API for every selected code cell. A successful cell has `TextDocument.languageId === "q"` and uses the extension's q TextMate grammar. Already-q cells are idempotent, Markdown cells are skipped, later cells are still attempted after a failure, and the confirmation reports changed, unchanged, skipped, and failed counts.

When VS Code saves an `.ipynb`, its built-in Jupyter serializer persists a non-default cell language in the raw cell metadata:

```json
{
  "metadata": {
    "vscode": {
      "languageId": "q"
    }
  }
}
```

That `metadata.vscode.languageId` field belongs to the serializer; it is distinct from the extension's nested `vscode-kdb` marker metadata. A selected controller can still constrain or normalize languages. In particular, the normal Python Jupyter controller does not advertise `q`, will not Run a q-language cell, and may change it to Python when a kernel is selected.

Jupyter's standard cell-language picker is filtered by the selected controller/kernel. VS Code exposes no supported `contributes.languages` field for advertising a language specifically to that picker, so KX does not add a fictional manifest switch. The KX toolbar/context/Command Palette action is the reliable q-selection route.

**KX: Restore Notebook Cell Language** changes all selected code cells to the registered default resolved from Jupyter `language_info.name`, falling back to `kernelspec.language`. For an ordinary IPython notebook this is `python`. It refuses to guess when the notebook has no usable registered default and never changes Markdown. Restoring the language does not delete cell source, `%%q`, KX metadata, or output.

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

## Tag, prepare, and run a q cell

Select one or more notebook code cells and use **KX: Tag Notebook Cell as q**. For every successful code cell, the command first sets the actual document language to q, then inserts a durable marker when one is absent:

```q
%%q --max-rows 1000 --max-bytes 1000000
select from trade where date=.z.D
```

It also merges namespaced cell metadata equivalent to:

```json
{
  "metadata": {
    "vscode-kdb": {
      "version": 1,
      "language": "q",
      "marker": "%%q",
      "rowLimit": 1000,
      "byteLimit": 1000000
    }
  }
}
```

An existing leading `%%q` marker is preserved without duplication. Tagging does not delete user code or replace unrelated top-level or nested cell metadata; existing unknown KX metadata fields are also retained. While the cell is non-default q, a saved raw `.ipynb` normally contains both serializer-owned `metadata.vscode.languageId: "q"` and the sibling `metadata.vscode-kdb` object shown above.

The q language selects syntax highlighting. `%%q` is the durable portable convention that invokes the configured IPython evaluator. The q grammar scopes only a top-line `%%q` as a notebook directive and continues normal q highlighting below it.

If a q-language cell has no leading marker, KX shows a contextual **Prepare for Python kernel** status item and exposes **Prepare this q cell for the active Python kernel** in the cell menu and Command Palette. The same action is offered when a preview action finds an unprepared q cell. It inserts the marker and merges KX metadata safely; it does not execute, restore the language, or create a connection.

For the normal Python Jupyter controller, use this sequence:

1. Set or tag the cell as q while editing so q highlighting is active.
2. Keep or prepare the leading `%%q` marker.
3. Run **KX: Restore Notebook Cell Language**; the cell becomes the notebook default/Python while the marker remains.
4. Use the notebook's normal Run action. IPython recognizes `%%q` and invokes the configured helper callback.

Selecting a Python kernel may perform step 3 automatically. Reapply q mode after execution when q highlighting is wanted again. KX for VS Code adds no notebook execution keybinding, does not steal `Ctrl+Enter` or `Ctrl+Shift+Enter`, and its standalone q editor commands/code lens are suppressed for notebook-cell documents.

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

The tag and preparation commands write the current defaults into new `%%q` markers. The helper enforces the explicit marker values and removes preview rows as needed to satisfy the byte budget. The output preserves schema, total row count where supplied by the evaluator, preview count, and truncation reasons.

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

The conceptual source of a notebook result is the evaluator explicitly configured in that Python kernel. Version 0.2.2 changes cell language and prepares source through supported APIs, but it does not have supported ownership for rerouting normal Jupyter Run through the extension's existing direct q IPC session. Rather than create a misleading second connection, extension-driven notebook execution remains disabled.

Use the callback or optional PyKX adapter when the Python kernel already owns the intended q session. A future persistent q NotebookController/evaluator must bridge that active Python kernel's q session through supported same-kernel ownership; it must not silently open a separate direct q connection. Use normal `.q` editor commands when the extension-owned direct IPC session and its live full-result KX panel are required.

The selected-cell filtering, language-setter arguments/results, already-q behavior, Markdown rejection, partial failure, default resolution, marker/metadata preservation, grammar, menus, contexts, and no-direct-IPC boundary are covered by pure helpers, faithful fake providers, and source/manifest tests. There is no visual or real VS Code Extension Host E2E claim for this release.
