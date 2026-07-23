# KX for VS Code

KX for VS Code is a standalone extension for working with kdb+/q directly in Visual Studio Code. It owns its q IPC connections, q editor commands, optional focused Server Explorer and Query History, portable Jupyter/IPython result renderer/helper, results viewer, charting, local data server, and diagnostics.

It sends q text to the selected q process. It does not translate ANSI SQL to q:

```q
select from trade where sym=`AAPL
meta trade
tables `.analytics
```

## Standalone status

The current `0.2.1` release keeps `.q` editor execution focused and direct-q-IPC-only and adds an explicit one-shot bridge for importing legacy KDB profiles already saved in VS Code settings. The bridge reads only import candidates, creates KX-owned direct IPC profiles, and does not require SQLTools to be installed. There is no SQLTools runtime/UI dependency, session-file behavior, or ongoing synchronization.

Implemented foundations include:

- direct q IPC connections managed through one responsive **KX Connection** form, with extension-owned safe metadata, VS Code SecretStorage, and a temporary unsaved-value **Test Connection** path;
- a KX-owned **Import SQLTools KDB Connections** review for exact legacy driver aliases, scoped configuration discovery, safe skip/rename conflicts, explicit one-time password transfer, and no overwrite or sync;
- optional per-profile connect/handshake and query timeout overrides with bounded global defaults;
- exact current-line, selection, and whole-document q execution;
- a real VS Code NotebookRenderer for `application/vnd.kx.result+json` v1 plus the focused `kx_notebook` IPython helper, durable `%%q` tagging, bounded persistent previews, static HTML/text export fallbacks, and optional saved-preview panel handoff;
- a disabled-by-default, manual-refresh Server Explorer for current-namespace tables, safe variable/function categories, on-demand `meta`, confirmed bounded table/variable previews, and metadata-only functions/projections;
- disabled-by-default, workspace-local Query History for actually issued editor runs, with rerun/copy/insert/delete/confirmed-clear actions and no result persistence or telemetry;
- grid and q-text results, disabled-by-default safe qText highlighting/conservative display formatting, virtual scrolling, selection, search, sorting, hidden columns, copy/export, and large-result safeguards;
- line, scatter, step, bar, box, and candlestick charts with original-domain Reset zoom;
- an opt-in tokenized loopback data server; and
- a dedicated `KX` Output channel with opt-in performance tracing.

This is not a full KDB-X or q Professional compatibility claim. Standalone owns its TextMate q grammar, opt-in qText result highlighting/display formatting, focused Server Explorer, local Query History, and NotebookRenderer, but it does not claim a q LSP, lint engine, source-document formatter, notebook controller, or complete editor/notebook parity. Server exploration is deliberately limited to the active direct profile and configured namespace, with metadata requests only while connected; the extension has no built-in SSH/TLS setup, gateway or Insights orchestration, remote administration, SQLTools result target/UI, `.session.sql` behavior, Jupyter controller interception, extension-driven same-session notebook routing, or full omitted-result recovery. Deterministic model/host/renderer/source guards—including faithful fake configuration providers for migration discovery—are not visual or real Extension Host E2E. See [Parity Roadmap & Architecture](parity-roadmap.md) and the source-backed repository parity matrix before treating a capability as equivalent.

## Requirements

- VS Code `1.96.0` or newer.
- A reachable kdb+/q process listening for q IPC.
- Credentials accepted by that process, if authentication is enabled.
- For notebook publishing, a Python 3.9+ IPython kernel with the separately installed `kx_notebook` helper and an explicit evaluator callback; optional PyKX remains separately installed/licensed.

SQLTools is not required.

## Common workflow

1. Start q on a loopback port for local development.
2. Add a direct connection from the **KX Connections** sidebar, or run **KX: Import SQLTools KDB Connections** to review eligible legacy profiles already in VS Code settings. Import is optional, one-time, and does not require SQLTools.
3. Test it, set it active, and connect; a run can also connect on demand.
4. Open a `.q` file and run the current line, an exact selection, or the whole document.
5. Inspect, chart, copy, or export the result in **KX Results**.
6. In an ordinary Jupyter notebook, install/configure `kx_notebook`, tag a code cell with **KX: Tag Notebook Cell as q**, and run it through the normal Python/IPython kernel to save a bounded inline KX result.
7. Open **View > Output** and select **KX** when diagnosing lifecycle or IPC failures.
8. Optionally enable Server Explorer or Query History in Settings; both default off to avoid surprise metadata queries or query-text persistence.

## Documentation map

- [Installation](installation.md): requirements, local development, and first connection.
- [Connections & SecretStorage](connections.md): direct IPC, namespaces, authentication, and lifecycle.
- [Running q](running-q.md): exact editor semantics and cancellation boundaries.
- [Jupyter/IPython Notebooks](notebooks.md): helper setup, `%%q`, MIME persistence, bounds, static export, and same-session limits.
- [Results Viewer](results-viewer.md): grids, q text, selection, search, sort, and column controls.
- [Charting](charting.md): chart types, controls, sampling, and PNG export.
- [Copy & Export](copy-export.md): formats and safety prompts.
- [Settings](settings.md): supported keys and defaults.
- [Performance & Large Results](performance.md): memory model, limits, and safe tracing.
- [Local Data Server](local-data-server.md): tokenized local endpoints.
- [Troubleshooting](troubleshooting.md): connection, q, diagnostics, and result problems.
- [Parity Roadmap & Architecture](parity-roadmap.md): current boundary and planned parity/backport flow.
- [Feedback](feedback.md): useful details for reports and requests.
