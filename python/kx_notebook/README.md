# kx-notebook

`kx-notebook` is the small Python/IPython companion for KX for VS Code. It emits
bounded, persistent notebook output using `application/vnd.kx.result+json`, plus
escaped `text/html` and `text/plain` fallbacks for notebook viewers and exports.
It contains no q runtime, KX binary, credentials, IPC connection, or remote
bridge.

The KX for VS Code VSIX carries this installable source tree for offline handoff,
but the extension never changes a selected kernel environment automatically.

This package is the separate **Python-controller route**. Keep the normal
Python/IPython controller selected and use `%%q` only when Python and q must
coexist in that kernel. KX for VS Code 0.2.3 also provides a native
**KX q (Direct IPC)** notebook controller; that direct route needs no Python
package or `%%q` marker and executes through the active profile in the
first-party KX Connections view. No extension-managed variables, namespace
state, session identity, or live-result identity are shared between the routes.
A user-supplied Python evaluator may independently target the same external
process, but helper output never receives a Direct IPC live-result identity.

## Development install and tests

From the `vscode-kdb` repository root, run the tests in an isolated `uv`
environment (nothing is installed into system Python):

```sh
uv run --no-project --with-editable ./python/kx_notebook \
  python -m unittest discover -s python/kx_notebook/tests -v
```

For an editable development environment:

```sh
uv venv /tmp/vscode-kdb-kx-notebook
uv pip install --python /tmp/vscode-kdb-kx-notebook/bin/python \
  --editable ./python/kx_notebook
```

## Publish an existing bounded result

```python
from kx_notebook import Chart, display_result

display_result(
    [
        {"time": "2026-07-22T09:00:00Z", "sym": "AAPL", "price": 224.1},
        {"time": "2026-07-22T09:01:00Z", "sym": "AAPL", "price": 224.4},
    ],
    label="local bounded result",
    chart=Chart(type="line", x_column="time", y_columns=("price",)),
)
```

The default portable limits are 1,000 preview rows and 1,000,000 bytes across the three
MIME representations. `row_limit` and `byte_limit` can be lowered per call.
Results exceeding either limit retain schema and total row count, and clearly
record why the preview was truncated. Actual q source is not copied into output
unless `q_source=` is explicitly supplied; the notebook cell already preserves
the source.

## `%%q` with an explicit evaluator

The cell magic never opens a q connection. Configure the callback for a q
session that already belongs to the Python kernel, then load the extension:

```python
from kx_notebook import configure_evaluator

def evaluate_in_my_existing_session(source: str):
    # Return a bounded table-like value. This function owns q execution.
    return my_q_session(source)

configure_evaluator(
    evaluate_in_my_existing_session,
    label="my existing kernel q session",
)
%load_ext kx_notebook
```

```q
%%q
select from trades where sym=`AAPL
```

The durable marker can carry explicit portable-output limits (for example when
inserted by KX for VS Code). A quoted safe display label is optional:

```q
%%q --max-rows 250 --max-bytes 524288 --label "trades preview"
select from trades where sym=`AAPL
```

The helper validates these marker options before calling the evaluator. They
affect only the persisted preview; they do not change or cap the evaluator's q
execution unless the configured evaluator applies its own server-side limit.

Normal Run is owned by the selected Python controller. KX for VS Code does not
intercept it or silently substitute the direct IPC controller. Conversely,
selecting **KX q (Direct IPC)** makes the native controller the execution owner;
ordinary q cells then run without this magic.

For local tests and examples, `FixtureEvaluator` maps exact source strings to
fixed table-like values. It is deliberately not a q parser:

```python
from kx_notebook import FixtureEvaluator, configure_evaluator

configure_evaluator(FixtureEvaluator({"demo": [{"x": 1, "y": 2}]}),
                    label="fixture (does not execute q)")
```

## Optional PyKX adapter

PyKX is never installed by this package. If PyKX is already installed and
licensed in the kernel, opt in explicitly:

```python
from kx_notebook.pykx import configure_pykx
configure_pykx()
%load_ext kx_notebook
```

The adapter uses that kernel's `pykx.q` object, takes only a bounded prefix
before converting a PyKX value to Python, and records the original row count.
It does not use or share the VS Code extension's direct q IPC connection.
Consequently, helper-produced output remains a portable preview and cannot
truthfully promise that the full live result can be reopened in the extension's
KX Results panel after the originating session is gone.
