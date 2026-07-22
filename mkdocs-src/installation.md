# Installation

## Requirements

KX for VS Code requires VS Code `1.96.0` or newer and a kdb+/q process reachable over q IPC for normal `.q` editor execution. The extension does not bundle q or a kdb+ license.

Notebook publishing additionally requires Python 3.9 or newer, IPython, and the focused `kx_notebook` helper installed in the selected notebook kernel. The helper bundles no q runtime or PyKX binary. Optional PyKX use must be installed, configured, licensed, and enabled separately in that kernel.

SQLTools is neither installed nor activated by this extension.

## Install the extension

Use a project-approved distribution of **KX for VS Code**. When installing a locally supplied VSIX, use VS Code's **Extensions: Install from VSIX...** command and confirm the extension name, publisher, and version before installation.

This documentation build does not publish a Marketplace package and does not establish that an unverified development VSIX is ready for Marketplace publication.

For repository development:

```sh
npm ci
npm run compile
```

Open the repository in VS Code and start the extension development host with **Run Extension** / `F5`.

## Start a local q process

Prefer loopback for an unauthenticated development process:

```sh
q -p 127.0.0.1:5000
```

The common `q -p 5000` form can listen beyond loopback. Use it only on a trusted, firewalled machine.

## First connection and run

1. Open the **KX** activity-bar view.
2. Choose **Add Connection** in **KX Connections**.
3. Enter a unique name, `localhost`, port `5000`, namespace `.`, and optional q IPC username and authentication secret.
4. Choose **Test Connection**, then **Set Active Connection** and **Connect**.
5. Open a `.q` file containing:

   ```q
   til 5
   ```

6. Press `Ctrl+Enter` on Windows/Linux or `Cmd+Enter` on macOS.

The result should open in a KX-owned result panel. If it does not, see [Troubleshooting](troubleshooting.md) and inspect **View > Output > KX**.

## Install the notebook helper

Install `python/kx_notebook` into the same Python environment used by the Jupyter/IPython kernel. For an editable source install without modifying system Python:

```sh
uv venv /tmp/vscode-kdb-kx-notebook
uv pip install --python /tmp/vscode-kdb-kx-notebook/bin/python \
  --editable ./python/kx_notebook
```

The packaged VSIX includes the same helper source under `python/kx_notebook`; KX for VS Code never installs it into a kernel automatically.

Then configure an evaluator callback owned by that kernel and load the magic:

```python
from kx_notebook import configure_evaluator

configure_evaluator(lambda source: my_existing_q_session(source))
%load_ext kx_notebook
```

Use **KX: Tag Notebook Cell as q** to add the durable `%%q` marker and configured output limits. The extension does not install a notebook controller, intercept Microsoft Jupyter, or open a q connection for the helper. See [Jupyter/IPython Notebooks](notebooks.md).

## Verify a source checkout

The maintained non-visual checks are:

```sh
npm ci
npm run compile
node test/run.js
npm test
uv run --no-project --with-editable ./python/kx_notebook \
  python -m unittest discover -s python/kx_notebook/tests -v
```

When a local q executable is available:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

These commands do not claim visual VS Code Extension Host end-to-end coverage.
