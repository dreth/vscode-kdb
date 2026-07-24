# KX for VS Code

KX for VS Code is a standalone extension for working with kdb+/q directly in Visual Studio Code. It owns its q IPC connections, q editor commands, optional focused Server Explorer and Query History, portable Jupyter/IPython result renderer/helper, results viewer, charting, local data server, and diagnostics.

It sends q text to the selected q process. It does not translate ANSI SQL to q:

```q
select from trade where sym=`AAPL
meta trade
tables `.analytics
```

## Standalone status

The current `0.2.4` release polishes **KX q (Direct IPC)** and the inline NotebookRenderer. q no-value/generic empty results are compact qText while schema-bearing zero-row tables remain tables; saved and live grids use compact natural sizing, vertical resize, stable two-axis scrolling, range selection/copy, and multi-series chart controls. The separate Python/IPython `%%q` helper remains available when a Python kernel must own execution. The release also retains the explicit one-shot bridge for importing legacy KDB profiles already saved in VS Code settings. There is no SQLTools runtime/UI dependency, private Jupyter integration, session-file behavior, or ongoing synchronization.

Implemented foundations include:

- direct q IPC connections managed through one responsive **KX Connection** form, with extension-owned safe metadata, VS Code SecretStorage, and a temporary unsaved-value **Test Connection** path;
- a KX-owned **Import SQLTools KDB Connections** review for exact legacy driver aliases, scoped configuration discovery, safe skip/rename conflicts, explicit one-time password transfer, and no overwrite or sync;
- optional per-profile connect/handshake and query timeout overrides with bounded global defaults;
- exact current-line, selection, and whole-document q execution;
- a supported `vscode.notebooks.createNotebookController` for ordinary Jupyter notebooks, q syntax and normal complete-cell Run, active-profile/session/namespace continuity, actionable connection errors, live first-party result views, shared result settings, bounded portable output, and no private Jupyter API;
- actual q `TextDocument.languageId` editing aids, safe restore-to-notebook-default, a separate durable Python `%%q` preparation route, and a real VS Code NotebookRenderer for `application/vnd.kx.result+json` v1; direct output stores KX MIME plus `text/plain`, while the Python helper can add static HTML/text fallbacks;
- a disabled-by-default, manual-refresh Server Explorer for current-namespace tables, safe variable/function categories, on-demand `meta`, confirmed bounded table/variable previews, and metadata-only functions/projections;
- disabled-by-default, workspace-local Query History for actually issued editor runs, with rerun/copy/insert/delete/confirmed-clear actions and no result persistence or telemetry;
- grid and q-text results, correct q no-value/empty classification, disabled-by-default safe qText highlighting/conservative display formatting, virtual scrolling, selection, search, sorting, hidden columns, copy/export, and large-result safeguards;
- compact/resizable notebook tables with stable two-axis scrolling, bounded range copy, and line/scatter/step/bar multi-series charts below the table;
- panel line, scatter, step, bar, box, and candlestick charts with original-domain Reset zoom;
- an opt-in tokenized loopback data server; and
- a dedicated `KX` Output channel with opt-in performance tracing.

This is not a full KDB-X or q Professional compatibility claim. Standalone owns its TextMate q grammar, native direct q controller, opt-in qText result presentation, focused Server Explorer, local Query History, and NotebookRenderer, but it does not claim a q LSP, lint engine, source-document formatter, remote Jupyter kernel, or complete editor/notebook parity. Server exploration is deliberately limited to the active direct profile and configured namespace. The extension has no built-in SSH/TLS setup, gateway or Insights orchestration, remote administration, SQLTools result target/UI, `.session.sql` behavior, Python-controller interception, persisted full-result recovery, or server-side notebook interruption. Live direct results exist only in the current extension-host session; reopened output is the bounded saved snapshot. Deterministic provider/model/renderer/source guards are not visual or real Extension Host E2E. See [Parity Roadmap & Architecture](parity-roadmap.md).

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
6. In an ordinary Jupyter notebook, choose **KX q (Direct IPC)** from the normal kernel/controller selector, make the intended code cells q, and use normal Run. A saved disconnected active profile may connect on the first Run because selecting the direct controller was explicit.
7. Open **View > Output** and select **KX** when diagnosing lifecycle or IPC failures.
8. Optionally enable Server Explorer or Query History in Settings; both default off to avoid surprise metadata queries or query-text persistence.

## Documentation map

- [Installation](installation.md): requirements, local development, and first connection.
- [Connections & SecretStorage](connections.md): direct IPC, namespaces, authentication, and lifecycle.
- [Running q](running-q.md): exact editor semantics and cancellation boundaries.
- [Jupyter/IPython Notebooks](notebooks.md): native Direct IPC controller, active-session routing, live result lifetime, bounded persistence, and the separate Python `%%q` route.
- [Results Viewer](results-viewer.md): grids, q text, selection, search, sort, and column controls.
- [Charting](charting.md): chart types, controls, sampling, and PNG export.
- [Copy & Export](copy-export.md): formats and safety prompts.
- [Settings](settings.md): supported keys and defaults.
- [Performance & Large Results](performance.md): memory model, limits, and safe tracing.
- [Local Data Server](local-data-server.md): tokenized local endpoints.
- [Troubleshooting](troubleshooting.md): connection, q, diagnostics, and result problems.
- [Parity Roadmap & Architecture](parity-roadmap.md): current boundary and planned parity/backport flow.
- [Feedback](feedback.md): useful details for reports and requests.
