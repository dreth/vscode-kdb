# KX for VS Code

KX for VS Code is a standalone extension for working with kdb+/q directly in Visual Studio Code. It owns its q IPC connections, q editor commands, optional focused Server Explorer and Query History, portable Jupyter/IPython result renderer/helper, results viewer, charting, local data server, and diagnostics.

It sends q text to the selected q process. It does not translate ANSI SQL to q:

```q
select from trade where sym=`AAPL
meta trade
tables `.analytics
```

## Standalone status

The current `0.2.5` release supports both q-only and mixed Python/q notebooks. Select **KX q (Direct IPC)** for native q-only Run, or keep Python selected and use **Run q Cell (KX)** on q cells without switching controllers. Mixed output is committed as an undoable notebook edit after q finishes, so the notebook becomes dirty until saved; Python cells remain untouched. Inline output uses compact KX Results controls, all six real chart types/column capabilities, and shared result settings; hidden legend series remain hidden across chart refreshes. Query responses default to 30 minutes independently of the 30-second connect/handshake default. The separate Python/IPython `%%q` helper remains available only when a Python-kernel evaluator must own q execution.

Implemented foundations include:

- direct q IPC connections managed through one responsive **KX Connection** form, with extension-owned safe metadata, VS Code SecretStorage, and a temporary unsaved-value **Test Connection** path;
- a KX-owned **Import SQLTools KDB Connections** review for exact legacy driver aliases, scoped configuration discovery, safe skip/rename conflicts, explicit one-time password transfer, and no overwrite or sync;
- optional per-profile connect/handshake and query timeout overrides with independent 30-second and 30-minute global defaults;
- exact current-line, selection, and whole-document q execution;
- a supported `vscode.notebooks.createNotebookController` for q-only Jupyter notebooks plus a q-scoped **Run q Cell (KX)** action/shortcut for mixed Python notebooks, with shared complete-cell execution, active-profile/session/namespace continuity, actionable connection errors, bounded live/portable output, and no private Jupyter API;
- actual q `TextDocument.languageId` editing aids, safe restore-to-notebook-default, a separate durable Python `%%q` preparation route, and a real VS Code NotebookRenderer for `application/vnd.kx.result+json` v1; direct output stores KX MIME plus `text/plain`, while the Python helper can add static HTML/text fallbacks;
- a disabled-by-default, manual-refresh Server Explorer for current-namespace tables, safe variable/function categories, on-demand `meta`, confirmed bounded table/variable previews, and metadata-only functions/projections;
- disabled-by-default, workspace-local Query History for actually issued editor runs, with rerun/copy/insert/delete/confirmed-clear actions and no result persistence or telemetry;
- grid and q-text results, correct q no-value/empty classification, disabled-by-default safe qText highlighting/conservative display formatting, virtual scrolling, selection, search, sorting, hidden columns, copy/export, and large-result safeguards;
- compact/resizable notebook tables with stable two-axis scrolling, Search keyboard navigation, selection-only Tools copy, and capability-valid line/scatter/step/bar/box/candlestick controls;
- panel and notebook charts with original-domain Reset zoom and legend-hidden state preserved across refreshes;
- an opt-in tokenized loopback data server; and
- a dedicated `KX` Output channel with opt-in performance tracing.

This is not a full KDB-X or q Professional compatibility claim. Standalone owns its TextMate q grammar, native direct q controller, explicit mixed-notebook q action, opt-in qText result presentation, focused Server Explorer, local Query History, and NotebookRenderer, but it does not claim a q LSP, lint engine, source-document formatter, remote Jupyter kernel, or complete editor/notebook parity. Public VS Code APIs select one notebook controller; built-in Python Run is never rerouted to KX. The extension has no built-in SSH/TLS setup, gateway or Insights orchestration, remote administration, SQLTools result target/UI, `.session.sql` behavior, persisted full-result recovery, or server-side notebook interruption. Live direct results exist only in the current extension-host session; reopened output is the bounded saved snapshot. Deterministic provider/model/renderer/source guards are not visual or real Extension Host E2E. See [Parity Roadmap & Architecture](parity-roadmap.md).

## Requirements

- VS Code `1.96.0` or newer.
- A reachable kdb+/q process listening for q IPC.
- Credentials accepted by that process, if authentication is enabled.
- For the optional Python-kernel notebook route only: Python 3.9+, IPython, and the separately installed `kx_notebook` helper with an explicit evaluator callback; optional PyKX remains separately installed/licensed.

SQLTools is not required.

## Common workflow

1. Start q on a loopback port for local development.
2. Add a direct connection from the **KX Connections** sidebar, or run **KX: Import SQLTools KDB Connections** to review eligible legacy profiles already in VS Code settings. Import is optional, one-time, and does not require SQLTools.
3. Test it, set it active, and connect; a run can also connect on demand.
4. Open a `.q` file and run the current line, an exact selection, or the whole document.
5. Inspect, chart, copy, or export the result in **KX Results**.
6. In a q-only notebook, choose **KX q (Direct IPC)** and use normal Run. In a mixed notebook, keep Python selected and use **Run q Cell (KX)** only on q-language code cells.
7. Open **View > Output** and select **KX** when diagnosing lifecycle or IPC failures.
8. Optionally enable Server Explorer or Query History in Settings; both default off to avoid surprise metadata queries or query-text persistence.

## Documentation map

- [Installation](installation.md): requirements, local development, and first connection.
- [Connections & SecretStorage](connections.md): direct IPC, namespaces, authentication, and lifecycle.
- [Running q](running-q.md): exact editor semantics and cancellation boundaries.
- [Jupyter/IPython Notebooks](notebooks.md): q-only and mixed modes, active-session routing, live result lifetime, bounded persistence, and the separate Python `%%q` route.
- [Results Viewer](results-viewer.md): grids, q text, selection, search, sort, and column controls.
- [Charting](charting.md): chart types, controls, sampling, and PNG export.
- [Copy & Export](copy-export.md): formats and safety prompts.
- [Settings](settings.md): supported keys and defaults.
- [Performance & Large Results](performance.md): memory model, limits, and safe tracing.
- [Local Data Server](local-data-server.md): tokenized local endpoints.
- [Troubleshooting](troubleshooting.md): connection, q, diagnostics, and result problems.
- [Parity Roadmap & Architecture](parity-roadmap.md): current boundary and planned parity/backport flow.
- [Feedback](feedback.md): useful details for reports and requests.
