# KX for VS Code

KX for VS Code is a standalone extension for working with kdb+/q directly in Visual Studio Code. It owns its q IPC connections, q editor commands, optional focused Server Explorer and Query History, portable Jupyter/IPython result renderer/helper, results viewer, charting, local data server, and diagnostics.

It sends q text to the selected q process. It does not translate ANSI SQL to q:

```q
select from trade where sym=`AAPL
meta trade
tables `.analytics
```

## Standalone status

The current workflow is Python-first for notebooks. Keep Python selected, use leading **Make q Cell (KX)** for q language/highlighting, activate one saved profile, and use **Run q Cell (KX)** for Direct IPC. Every run resolves the active profile by stable ID, so endpoint edits take effect and missing active routes never fall through. **KX q (Direct IPC)** is absent from kernel candidates by default; this first-class pure-q controller is available through the default-false `vscode-kdb.notebook.enableDirectController` setting. VS Code's top-right Jupyter selector remains. Connection profiles merge predictably across User, Workspace, and Workspace Folder settings while edits preserve ownership and delayed configuration propagation is reconciled. Complete q cells and editor scripts use client-side grouping and ordinary `value` execution without a q release-date gate.

Implemented foundations include:

- multiple direct q IPC profiles managed through one responsive **KX Connection** form, with Folder > Workspace > User stable-ID precedence, explicit scope ownership/moves, delayed-propagation-safe persistence, an active marker/selector, non-syncing VS Code SecretStorage, and a temporary unsaved-value **Test Connection** path;
- a KX-owned **Import SQLTools KDB Connections** review for exact legacy driver aliases, scoped configuration discovery, safe skip/rename conflicts, explicit one-time password transfer, and no overwrite or sync;
- optional per-profile connect/handshake and query timeout overrides with independent 30-second and 60-minute global defaults;
- exact current-line execution plus client-grouped multiline, whole-document, and complete-cell q execution through ordinary q `value`, with configured-namespace save/enter/restore;
- leading **Make q Cell (KX)** / **Run q Cell (KX)** actions, q-cell status, a notebook-level active-profile chooser, and a focused q-cell shortcut for mixed Python notebooks, plus an optional default-off public pure-q `NotebookController`, with shared complete-cell execution, profile/session/namespace continuity, immediately bound full live results, bounded portable previews or exact selected full v2 output, and no private Jupyter API;
- actual q `TextDocument.languageId` editing aids, safe restore-to-notebook-default, honest bounded compatibility with the released `kx-notebook==0.1.0` Python `%%q` route, an explicit confirmed rerun-as-new-Direct-IPC action, and a real VS Code NotebookRenderer for `application/vnd.kx.result+json` v1/v2; direct output stores KX MIME plus `text/plain`, while companion output adds static HTML/text fallbacks;
- a disabled-by-default, manual-refresh Server Explorer for current-namespace tables, safe variable/function categories, on-demand `meta`, confirmed bounded table/variable previews, and metadata-only functions/projections;
- disabled-by-default, workspace-local Query History for actually issued editor runs, with rerun/copy/insert/delete/confirmed-clear actions and no result persistence or telemetry;
- grid and q-text results, correct q no-value/empty classification, selective concise grid-cell text with exact q identity retained for qText/copy/export, stable logical-row striping, disabled-by-default safe qText highlighting/conservative display formatting, virtual scrolling, selection, search, sorting, hidden columns, large-result safeguards, and an explicit private CSV-snapshot handoff to optional Data Wrangler;
- KX Results-aligned notebook tables with shared toolbar/output formats/settings, stable two-axis scrolling, Search/navigation, visible-column controls, range copy/export, explicit live-versus-saved state, and exact live panel handoff;
- panel and notebook line/scatter/step/bar/box/candlestick charts with shared q numeric/temporal column classification, temporal X choices, numeric Y/OHLC requirements, a keyboard-accessible full-X overview navigator, exact 7,000-point ordinary-series reduction, automatic settled-range live refinement, original-domain Reset zoom, PNG export, and legend-hidden state preserved across refreshes;
- an opt-in tokenized loopback data server; and
- a dedicated `KX` Output channel with opt-in performance tracing.

The extension provides TextMate q syntax highlighting, not a q language server, lint engine, or source formatter. Built-in Python Run is never rerouted to KX. SSH/TLS setup, gateways, remote administration, SQLTools UI/session behavior, recovery of rows omitted from a saved preview, and server-side notebook interruption are not included. Live direct results exist only in the current extension-host session; reopened output contains its selected bounded preview or exact supported full v2 representation. See [Architecture](architecture.md) for component and state boundaries.

## Requirements

- VS Code `1.96.0` or newer.
- A reachable kdb+/q process listening for q IPC.
- Credentials accepted by that process, if authentication is enabled.
- For the optional Python-kernel notebook route only: Python 3.9-3.13, IPython, and separately installed `kx-notebook==0.1.0` (`import kx_notebook`). Direct q IPC is built in; profiles, callbacks, PyKX, and a loopback broker are explicit alternatives.

Direct execution compatibility is feature-based rather than gated on a q version/date. The deterministic suite covers generated requests for a process without `.Q.ld`, but the release's live check used only the installed modern q runtime. No exact minimum q version or live historical-q result is claimed.

SQLTools is not required.

## Common workflow

1. Start q on a loopback port for local development.
2. Add a direct connection from the **KX Connections** sidebar, or run **KX: Import SQLTools KDB Connections** to review eligible legacy profiles already in VS Code settings. Import is optional, one-time, and does not require SQLTools.
3. Test it, set it active, and connect; a run can also connect on demand.
4. Open a `.q` file and run the current line, an exact selection, or the whole document.
5. Inspect, chart, copy, or export the result in **KX Results**. For a complete decoded table, **Open in Data Wrangler** can create a lossy local CSV snapshot; it is not a live or type-perfect q handoff.
6. In a notebook, keep Python selected, use **Make q Cell (KX)**, activate the shared q connection, then use **Run q Cell (KX)**. Enable the optional pure-q controller only if that separate workflow is wanted.
7. Open **View > Output** and select **KX** when diagnosing lifecycle or IPC failures.
8. Optionally enable Server Explorer or Query History in Settings; both default off to avoid surprise metadata queries or query-text persistence.

## Documentation map

- [Installation](installation.md): requirements, local development, and first connection.
- [Connections & SecretStorage](connections.md): direct IPC, namespaces, authentication, and lifecycle.
- [Running q](running-q.md): exact editor semantics and cancellation boundaries.
- [Jupyter/IPython Notebooks](notebooks.md): Python-first mixed execution, optional pure-q controller, explicit active-profile routing, live result lifetime, bounded persistence, and the separate Python `%%q` route.
- [Results Viewer](results-viewer.md): grids, q text, selection, search, sort, and column controls.
- [Charting](charting.md): chart types, controls, sampling, and PNG export.
- [Copy & Export](copy-export.md): formats, safety prompts, and the optional Data Wrangler CSV handoff.
- [Settings](settings.md): supported keys and defaults.
- [Performance & Large Results](performance.md): memory model, limits, and safe tracing.
- [Local Data Server](local-data-server.md): tokenized local endpoints.
- [Troubleshooting](troubleshooting.md): connection, q, diagnostics, and result problems.
- [Architecture](architecture.md): components, state lifetime, and product boundaries.
- [Feedback](feedback.md): useful details for reports and requests.
