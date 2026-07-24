# Installation

## Requirements

KX for VS Code requires VS Code `1.96.0` or newer and a kdb+/q process reachable over q IPC for normal `.q` editor execution. The extension does not bundle q or a kdb+ license.

The native **KX q (Direct IPC)** controller and mixed-notebook **Run q Cell (KX)** action use the same reachable q process and active KX profile as editor execution; neither requires a Python package. Because every direct q cell uses q script grouping, it requires q 4.0 dated 2023-03-28 or newer (or q 4.1t dated 2022-11-01 or newer). The separate optional Python-kernel `%%q` route requires Python 3.9 or newer, IPython, and `kx_notebook` in that kernel. The helper bundles no q runtime or PyKX binary.

SQLTools is neither installed nor activated by this extension. If legacy KDB profiles remain in VS Code's `sqltools.connections` setting, the explicit import command can read those values as one-time candidates through VS Code's configuration API; that does not create a SQLTools runtime dependency.

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

## Optional one-time connection import

If you previously used the `DanielAlonso.kdb-sqltools` driver, run **KX: Import SQLTools KDB Connections** from the Command Palette or KX Connections toolbar. SQLTools may already be uninstalled. KX inspects existing user, workspace, and workspace-folder settings and reviews only profiles whose normalized driver is `KDB`, `kdb+`, `kdb`, `kdb-sqltools`, or `DanielAlonso.kdb-sqltools`.

The review never displays password values. SSH-enabled and malformed profiles are explained but cannot be selected. Existing KX profiles are skipped unless you explicitly import the candidate under a new unique name; this release has no replace or overwrite action. If selected settings contain passwords, choose whether to copy them once into VS Code SecretStorage, import without passwords, or cancel. Source settings remain unchanged and are never synchronized.

The imported legacy connection timeout applies only to KX connect/handshake. Query timeout continues to inherit the KX global query default until you edit it. After import, use **Review Imported Connection** or the KX sidebar to inspect and test the saved direct profile.

## Use the native direct q notebook controller

1. Add or select a profile in **KX Connections**.
2. Open an ordinary `.ipynb`.
3. Choose **KX q (Direct IPC)** from the notebook's top-right kernel/controller selector or **Notebook: Select Notebook Kernel**.
4. Set the intended code cells to q if needed.
5. Use normal **Run Cell** or `Ctrl+Enter`.

The controller executes the complete q cell through the active profile's existing direct q client and namespace. It can connect a saved disconnected profile on demand because selecting the controller was explicit. Use ordinary q source: a leading `%%q` is rejected and belongs to the separate Python route. The controller does not install a q kernel, intercept a Python kernel, or create a notebook-specific connection. See [Jupyter/IPython Notebooks](notebooks.md).

## Use mixed Python and q cells

1. Keep the normal Python Jupyter controller selected.
2. Leave Python cells as Python and run them normally.
3. Set an intended q code cell to language q with **KX: Set Notebook Cell Language to q**.
4. Use its compact **Run q Cell (KX)** play action or cell context entry.

The KX action executes the complete q source through the active KX profile without switching the Python controller. q assignments continue through the same KX q process used by the direct controller and `.q` editor runs. Python variables and KX q variables remain separate.

When the q cell editor itself has text focus, the contributed default `Ctrl+Enter` / `Cmd+Enter` runs the KX action. The shortcut is limited to q code-cell editor focus and is disabled when the KX direct controller is selected. Python, Markdown, cell-container, and output focus keep their normal notebook shortcut behavior. User or keymap-extension bindings can override defaults; use the visible KX action if the shortcut was customized.

Mixed mode cannot claim native KX kernel execution while Python is selected. After q finishes, the KX action applies its output as one undoable notebook edit, which marks the notebook dirty until saved and replaces the q cell's internal handle. Source, q language, metadata, and sibling cells are preserved; a cell or output changed during the run is not overwritten.

## Notebook commands

| Command | Use |
| --- | --- |
| **Run q Cell (KX)** | Execute the complete q-language cell through the active KX connection while another notebook controller remains selected. |
| **KX: Set Notebook Cell Language to q** | Apply q language/highlighting to selected code cells; skips Markdown. |
| **KX: Restore Notebook Cell Language** | Restore selected code cells to the notebook default, normally Python. |
| **KX: Tag Notebook Cell as q** | Prepare the separate Python-helper route by adding q language, a durable `%%q` marker, and output limits. |
| **Prepare this q cell for the active Python kernel** | Add the helper marker/metadata without executing. |
| **KX: Open Saved Notebook Preview in Results Panel** | Open only the bounded stored snapshot when no live direct result is available. |

## Optional: install the Python notebook helper

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

Use the q code-cell toolbar action or **KX: Set Notebook Cell Language to q** for actual q highlighting, then **KX: Tag Notebook Cell as q** to retain the durable `%%q` marker and configured output limits. The normal Python Jupyter controller does not advertise or Run q-language cells: keep the marker, use **KX: Restore Notebook Cell Language**, and then use normal Run so IPython invokes the configured magic. Selecting the Python kernel may perform that normalization itself.

This helper path is separate from both **KX q (Direct IPC)** and **Run q Cell (KX)**. It never opens or borrows the extension's direct connection and does not share q variables/session state with first-party direct execution by implication. KX does not intercept Microsoft Jupyter or reroute Python-controller Run. See [Jupyter/IPython Notebooks](notebooks.md).

## Verify a source checkout

The maintained non-visual checks are:

```sh
npm ci
npm run compile
npm test
npm run test:parity:self
npm run test:notebook-python
npm run test:notebook-cross
```

When a local q executable is available:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

The migration configuration-provider, NotebookController, mixed q-cell runner, active-session routing, live-result, and language-setter tests use pure helpers and faithful VS Code providers/fakes because the maintained suite does not launch an Extension Host. Source/manifest guards cover controller activation, q-only toolbar/context/keybinding scopes, grammar, and private-Jupyter/runtime boundaries. These commands do not claim visual or real VS Code Extension Host end-to-end coverage.
