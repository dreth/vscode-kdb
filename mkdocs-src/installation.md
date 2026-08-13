# Installation

## Requirements

KX for VS Code requires VS Code `1.96.0` or newer and a kdb+/q process reachable over q IPC for normal `.q` editor execution. The extension does not bundle q or a kdb+ license.

Mixed-notebook **Run q Cell (KX)** uses the globally active q profile while Python stays selected. The optional pure-q **KX q (Direct IPC)** controller uses that same active profile only when its default-false setting is enabled and it is selected. Both use the same direct q machinery as editor execution and neither requires a Python package. Release 0.2.18 preserves 0.2.7's client-side complete-source grouping and ordinary q `value` evaluation, so it does not require `.Q.ld` or reject a process by q release date. Compatibility is covered deterministically for generated source when `.Q.ld` is absent and live on the installed modern q runtime; no historical q binary was available, so no exact minimum q version or live old-q result is claimed. The separate optional Python-kernel `%%q` route requires Python 3.9 through 3.13, IPython, and the separately installed `kx-notebook==0.1.0` distribution (`import kx_notebook`) in that kernel. The companion has direct q IPC built in; it bundles no q runtime or PyKX binary.

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

If you previously used the `DanielAlonso.kdb-sqltools` driver, run **KX: Import SQLTools KDB Connections** from the Command Palette. It is intentionally absent from the routine KX Connections title toolbar. SQLTools may already be uninstalled. KX inspects existing user, workspace, and workspace-folder settings and reviews only profiles whose normalized driver is `KDB`, `kdb+`, `kdb`, `kdb-sqltools`, or `DanielAlonso.kdb-sqltools`.

The review never displays password values. SSH-enabled and malformed profiles are explained but cannot be selected. Existing KX profiles are skipped unless you explicitly import the candidate under a new unique name; this release has no replace or overwrite action. If selected settings contain passwords, choose whether to copy them once into VS Code SecretStorage, import without passwords, or cancel. Source settings remain unchanged and are never synchronized.

The imported legacy connection timeout applies only to KX connect/handshake. Query timeout continues to inherit the KX global query default until you edit it. After import, use **Review Imported Connection** or the KX sidebar to inspect and test the saved direct profile.

## Use mixed Python and q cells

1. Keep the normal Python Jupyter controller selected.
2. Leave Python cells as Python and run them normally.
3. Click the leading **Make q Cell (KX)** action on the intended code cell. This changes the whole cell's language without changing the selected Python kernel.
4. Choose the visible notebook-level **Active** item or **KX: Activate q Connection**, then activate and star one saved KX profile.
5. Use the leading **Run q Cell (KX)** play action, `Ctrl+Enter` / `Cmd+Enter` to run and stay, `Shift+Enter` to run and move next, or `Alt+Enter` (`Option+Enter` on macOS) to run and insert below.

The KX action executes the complete q source through the globally starred active connection without switching the Python controller. Every run resolves current store data: editing the active profile to a new host/port uses the new endpoint and recycles a stale client as needed. Legacy per-notebook target metadata is ignored, a connected non-active profile is never a fallback, and a missing active profile asks for explicit activation instead of using list order. q assignments continue through the active profile's KX q process. Python variables and KX q variables remain separate.

When the q cell editor itself has text focus, the contributed defaults preserve notebook semantics: `Ctrl+Enter` / `Cmd+Enter` runs and stays, `Shift+Enter` runs and moves next, and `Alt+Enter` / `Option+Enter` runs and inserts below. Move/insert happens only after a successful executed result. The bindings are limited to q code-cell editor focus and are disabled when the KX direct controller is selected. Python, Markdown, cell-container, and output focus keep their normal notebook shortcut behavior. User or keymap-extension bindings can override defaults; use the visible KX action if a shortcut was customized.

Mixed mode is an explicit KX action, not native KX kernel execution, while Python is selected. After q finishes, the KX action applies complete exact rich v2 output as one undoable notebook edit, which marks the notebook dirty until saved and replaces the q cell's internal handle. Source, q language, metadata, and sibling cells are preserved; a cell or output changed during the run is not overwritten. Use VS Code/Jupyter's native **Clear Cell Output** or **Clear All Outputs** actions to remove output.

KX is absent from the kernel candidates by default. VS Code's top-right Jupyter selector remains; KX does not remove it.

## Optional native direct q notebook controller

Set the application-scoped `vscode-kdb.notebook.enableDirectController` setting to `true`, then choose **KX q (Direct IPC)** from the normal notebook kernel selector. This opt-in controller executes complete q cells through the active profile's existing direct q client and namespace using normal **Run Cell**, **Run All**, and notebook shortcuts. Each successful execution uses standard notebook output APIs and automatically persists complete exact rich v2 output.

Turning the setting off disposes the controller, so a previously saved KX selection cannot be restored while it is unregistered. Use ordinary q source: a leading `%%q` is rejected and belongs to the separate Python route. The controller does not install a q kernel, intercept Python/Jupyter, use private APIs, or create a notebook-specific connection. See [Jupyter/IPython Notebooks](notebooks.md).

## Notebook commands

| Command | Use |
| --- | --- |
| **Run q Cell (KX)** | Execute the complete q-language cell through the globally starred active KX connection while another notebook controller remains selected. |
| **Make q Cell (KX)** | Apply q language/highlighting to a complete code cell without changing the selected kernel. |
| **KX: Activate q Connection** | Activate and star the global KX connection used by mixed q cells and editor Direct IPC. |
| **KX: Restore Notebook Cell Language** | Restore selected code cells to the notebook default, normally Python. |
| **KX: Tag Notebook Cell as q** | Legacy editing aid that adds q language, a `%%q` marker, and output limits; the released companion's normal route instead keeps a Python cell Python. |
| **Prepare this q cell for the active Python kernel** | Add legacy marker/metadata without executing; not required by `kx-notebook==0.1.0`. |
| **KX: Open Saved Notebook Result in Results Panel** | Open validated stored rows when no live direct result is available: every row from current first-party complete v2 output, or bounded rows from a historical/Python-helper preview. |

## Optional: install the Python notebook helper

Install the exact released companion into the same Python 3.9-3.13 environment used by the Jupyter/IPython kernel:

```sh
uv venv /tmp/vscode-kdb-kx-notebook
uv pip install --python /tmp/vscode-kdb-kx-notebook/bin/python \
  'kx-notebook==0.1.0'
```

The distribution name is `kx-notebook` and the import name is `kx_notebook`. It is not bundled in the VSIX, and KX for VS Code never installs it into a kernel automatically.

Direct q IPC is built in. Load the package and connect from Python cells:

```python
%load_ext kx_notebook
%kx connect localhost:5000
```

Keep a companion `%%q` cell's language as Python and use normal Jupyter Run:

```q
%%q
select from trade
```

`%%q` is IPython syntax. A durable extension Direct IPC cell instead remains q-language and uses **Run q Cell (KX)**; do not switch one cell back and forth between the two routes. Companion direct IPC, profiles, callback, PyKX, and loopback-broker alternatives are owned by the Python process. They do not borrow the extension's connection or receive its live-result record/output-binding metadata. See [Jupyter/IPython Notebooks](notebooks.md).

## Verify a source checkout

The maintained checks are:

```sh
npm ci
npm run compile
npm test
npm run test:notebook-python
npm run test:notebook-cross
npm run test:extension-host
npm run test:notebook-results-visual
```

When a local q executable is available:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

Pure helpers and faithful VS Code providers/fakes cover migration configuration, native active-profile routing, mixed explicit-target routing, live results, status, menus, and keybinding scopes. `npm run test:notebook-cross` installs exactly `kx-notebook==0.1.0`, imports `kx_notebook`, and validates its emitted version-1 MIME payload with the TypeScript contract. The scoped Extension Host smoke covers activation, contributed commands, isolated two-profile configuration/active selection, and real q-language/KX metadata persistence through save, close, and reopen; it remains non-visual and does not exercise the connection form, selector, toolbar/status layout, or target QuickPick. The notebook-results visual check requires VS Code, Xvfb/ffmpeg, and q; it records 12 validated screenshots covering light/dark table/chart, opt-in qText, tracked-file reopen, live-full state, every chart family, narrow live/saved layouts, and a narrow overlay.
