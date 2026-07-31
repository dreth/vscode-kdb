# KX for VS Code

KX for VS Code is a standalone extension for working with kdb+/q directly in Visual Studio Code. It owns its q IPC connections, q editor commands, optional focused Server Explorer and Query History, portable Jupyter/IPython result renderer/helper, results viewer, charting, local data server, and diagnostics.

It sends q text to the selected q process. It does not translate ANSI SQL to q:

```q
select from trade where sym=`AAPL
meta trade
tables `.analytics
```

## Standalone status

The current `0.2.8` release is Python-first for notebooks. Keep Python selected, use leading **Make q Cell (KX)** for q language/highlighting, choose one saved profile explicitly, and use **Run q Cell (KX)** for Direct IPC. Every run resolves the current profile by stable ID, so endpoint edits take effect and missing targets never fall through. **KX q (Direct IPC)** is absent from kernel candidates by default; the legacy q-only controller is available only through the default-false `vscode-kdb.notebook.enableDirectController` setting. VS Code's top-right Jupyter selector remains. Connection add/edit/remove and active state remain immediately coherent while delayed configuration propagation catches up. Complete q cells and editor scripts preserve 0.2.7's client-side grouping and ordinary `value` execution without a q release-date gate.

Implemented foundations include:

- multiple direct q IPC profiles managed through one responsive **KX Connection** form, with effective application/global configuration, delayed-propagation-safe persistence, an explicit active marker/selector, extension-owned safe metadata, VS Code SecretStorage, and a temporary unsaved-value **Test Connection** path;
- a KX-owned **Import SQLTools KDB Connections** review for exact legacy driver aliases, scoped configuration discovery, safe skip/rename conflicts, explicit one-time password transfer, and no overwrite or sync;
- optional per-profile connect/handshake and query timeout overrides with independent 30-second and 30-minute global defaults;
- exact current-line execution plus client-grouped multiline, whole-document, and complete-cell q execution through ordinary q `value`, with configured-namespace save/enter/restore;
- leading **Make q Cell (KX)** / **Run q Cell (KX)** actions, q-cell status, a notebook-level explicit current profile target, and a focused q-cell shortcut for mixed Python notebooks, plus an optional default-off public `NotebookController` for legacy q-only use, with shared complete-cell execution, profile/session/namespace continuity, actionable connection errors, bounded live/portable output, and no private Jupyter API;
- actual q `TextDocument.languageId` editing aids, safe restore-to-notebook-default, a separate durable Python `%%q` preparation route, and a real VS Code NotebookRenderer for `application/vnd.kx.result+json` v1; direct output stores KX MIME plus `text/plain`, while the Python helper can add static HTML/text fallbacks;
- a disabled-by-default, manual-refresh Server Explorer for current-namespace tables, safe variable/function categories, on-demand `meta`, confirmed bounded table/variable previews, and metadata-only functions/projections;
- disabled-by-default, workspace-local Query History for actually issued editor runs, with rerun/copy/insert/delete/confirmed-clear actions and no result persistence or telemetry;
- grid and q-text results, correct q no-value/empty classification, disabled-by-default safe qText highlighting/conservative display formatting, virtual scrolling, selection, search, sorting, hidden columns, copy/export, and large-result safeguards;
- compact/resizable notebook tables with stable two-axis scrolling, Search keyboard navigation, selection-only Tools copy, and capability-valid line/scatter/step/bar/box/candlestick controls;
- panel and notebook charts with original-domain Reset zoom and legend-hidden state preserved across refreshes;
- an opt-in tokenized loopback data server; and
- a dedicated `KX` Output channel with opt-in performance tracing.

The extension provides TextMate q syntax highlighting, not a q language server, lint engine, or source formatter. Built-in Python Run is never rerouted to KX. SSH/TLS setup, gateways, remote administration, SQLTools UI/session behavior, persisted full-result recovery, and server-side notebook interruption are not included. Live direct results exist only in the current extension-host session; reopened output contains the bounded saved snapshot. See [Architecture](architecture.md) for component and state boundaries.

## Requirements

- VS Code `1.96.0` or newer.
- A reachable kdb+/q process listening for q IPC.
- Credentials accepted by that process, if authentication is enabled.
- For the optional Python-kernel notebook route only: Python 3.9+, IPython, and the separately installed `kx_notebook` helper with an explicit evaluator callback; optional PyKX remains separately installed/licensed.

Direct execution compatibility is feature-based rather than gated on a q version/date. The deterministic suite covers generated requests for a process without `.Q.ld`, but the release's live check used only the installed modern q runtime. No exact minimum q version or live historical-q result is claimed.

SQLTools is not required.

## Common workflow

1. Start q on a loopback port for local development.
2. Add a direct connection from the **KX Connections** sidebar, or run **KX: Import SQLTools KDB Connections** to review eligible legacy profiles already in VS Code settings. Import is optional, one-time, and does not require SQLTools.
3. Test it, set it active, and connect; a run can also connect on demand.
4. Open a `.q` file and run the current line, an exact selection, or the whole document.
5. Inspect, chart, copy, or export the result in **KX Results**.
6. In a notebook, keep Python selected, use **Make q Cell (KX)**, select the notebook q target, then use **Run q Cell (KX)**. Enable the optional q-only controller only if that separate workflow is required.
7. Open **View > Output** and select **KX** when diagnosing lifecycle or IPC failures.
8. Optionally enable Server Explorer or Query History in Settings; both default off to avoid surprise metadata queries or query-text persistence.

## Documentation map

- [Installation](installation.md): requirements, local development, and first connection.
- [Connections & SecretStorage](connections.md): direct IPC, namespaces, authentication, and lifecycle.
- [Running q](running-q.md): exact editor semantics and cancellation boundaries.
- [Jupyter/IPython Notebooks](notebooks.md): Python-first mixed execution, optional q-only controller, explicit current-profile routing, live result lifetime, bounded persistence, and the separate Python `%%q` route.
- [Results Viewer](results-viewer.md): grids, q text, selection, search, sort, and column controls.
- [Charting](charting.md): chart types, controls, sampling, and PNG export.
- [Copy & Export](copy-export.md): formats and safety prompts.
- [Settings](settings.md): supported keys and defaults.
- [Performance & Large Results](performance.md): memory model, limits, and safe tracing.
- [Local Data Server](local-data-server.md): tokenized local endpoints.
- [Troubleshooting](troubleshooting.md): connection, q, diagnostics, and result problems.
- [Architecture](architecture.md): components, state lifetime, and product boundaries.
- [Feedback](feedback.md): useful details for reports and requests.
