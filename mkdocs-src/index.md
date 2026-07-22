# KX for VS Code

KX for VS Code is a standalone extension for working with kdb+/q directly in Visual Studio Code. It owns its q IPC connections, q editor commands, results viewer, charting, local data server, and diagnostics.

It sends q text to the selected q process. It does not translate ANSI SQL to q:

```q
select from trade where sym=`AAPL
meta trade
tables `.analytics
```

## Phase 1 status

The current `0.1.3` release is in the first standalone phase. It has no SQLTools runtime dependency and does not create or interpret SQLTools session files.

Implemented foundations include:

- direct q IPC connections managed through one responsive **KX Connection** form, with extension-owned safe metadata and VS Code SecretStorage;
- optional per-profile connect/handshake and query timeout overrides with bounded global defaults;
- exact current-line, selection, and whole-document q execution;
- grid and q-text results, virtual scrolling, selection, search, sorting, hidden columns, copy/export, and large-result safeguards;
- line, scatter, step, bar, box, and candlestick charts;
- an opt-in tokenized loopback data server; and
- a dedicated `KX` Output channel with opt-in performance tracing.

Phase 1 is not a full compatibility claim. The extension has no object explorer, built-in SSH or TLS setup, gateway orchestration, SQLTools result target, SQLTools connection UI, or `.session.sql` behavior. Release 0.1.3 has deterministic form/source guards but no visual Extension Host E2E or screenshot evidence. See [Parity Roadmap & Architecture](parity-roadmap.md) and the source-backed repository parity matrix before treating a capability as equivalent.

## Requirements

- VS Code `1.96.0` or newer.
- A reachable kdb+/q process listening for q IPC.
- Credentials accepted by that process, if authentication is enabled.

SQLTools is not required.

## Common workflow

1. Start q on a loopback port for local development.
2. Add a direct connection from the **KX Connections** sidebar. Complete the single-screen endpoint, namespace, and optional authentication fields; use **Advanced direct q IPC** only when this profile needs timeout overrides.
3. Test it, set it active, and connect; a run can also connect on demand.
4. Open a `.q` file and run the current line, an exact selection, or the whole document.
5. Inspect, chart, copy, or export the result in **KX Results**.
6. Open **View > Output** and select **KX** when diagnosing lifecycle or IPC failures.

## Documentation map

- [Installation](installation.md): requirements, local development, and first connection.
- [Connections & SecretStorage](connections.md): direct IPC, namespaces, authentication, and lifecycle.
- [Running q](running-q.md): exact editor semantics and cancellation boundaries.
- [Results Viewer](results-viewer.md): grids, q text, selection, search, sort, and column controls.
- [Charting](charting.md): chart types, controls, sampling, and PNG export.
- [Copy & Export](copy-export.md): formats and safety prompts.
- [Settings](settings.md): supported keys and defaults.
- [Performance & Large Results](performance.md): memory model, limits, and safe tracing.
- [Local Data Server](local-data-server.md): tokenized local endpoints.
- [Troubleshooting](troubleshooting.md): connection, q, diagnostics, and result problems.
- [Parity Roadmap & Architecture](parity-roadmap.md): current boundary and planned parity/backport flow.
- [Feedback](feedback.md): useful details for reports and requests.
