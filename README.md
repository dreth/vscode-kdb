# KX for VS Code

KX for VS Code is a standalone extension for working with kdb+/q directly in Visual Studio Code. It provides q language support, extension-owned direct q IPC connections, exact editor execution, a KX activity-bar view, and a high-performance native result panel.

Version 0.1.1 has no SQLTools dependency. It does not call SQLTools APIs, contribute SQLTools commands, or create or interpret `.session.sql` files.

Documentation: [standalone user guide](mkdocs-src/index.md) and [source-backed parity matrix](PARITY.md). The generated site is tracked under `docs/`; no Pages deployment is implied.

## Quick start

1. Start a local q process that listens for IPC connections:

   ```sh
   q -p 127.0.0.1:5000
   ```

   The common `q -p 5000` form listens on all network interfaces. Use it only on a trusted, firewalled machine; the loopback form above avoids exposing an unauthenticated local development process to the network.

2. Install KX for VS Code and open the **KX** activity-bar icon.
3. In **KX Connections**, choose **Add Connection** and enter a unique name, `localhost`, port `5000`, and the q namespace to use. Use `.` for the root namespace.
4. Test the connection, set it active, and connect. Opening a connection is also handled automatically when a query first needs it.
5. Open a `.q` file and run the current line, a selection, or the complete script.

The value shown as **Database / Namespace** is a q namespace, such as `.` or `.app`. Raw editor queries run in that namespace, and the connection's previous namespace is restored after execution.

## Connections

Connections belong to this extension and appear in the **KX Connections** sidebar. The sidebar and Command Palette provide these commands:

- **KX: Add Connection**
- **KX: Edit Connection**
- **KX: Remove Connection**
- **KX: Set Active Connection**
- **KX: Connect**
- **KX: Disconnect**
- **KX: Test Connection**

Connection errors identify the relevant host and port so endpoint, network, authentication, and q-listener problems can be distinguished. Names must be unique; hosts, ports, and namespaces are validated before they are stored.

### Security model

Safe connection metadata is kept in the global user setting `vscode-kdb.connections`: connection ID, name, host, port, database/namespace, and username. Passwords are never written to settings. Each password is stored under a connection-specific key in VS Code `SecretStorage`, using the credential protection provided by VS Code and the operating system at rest. Removing a connection removes its stored secret. Passwords are not included in extension logs, documentation samples, packaged files, or connection errors.

Direct q IPC is plaintext in transit, including authentication and query traffic. Phase 1 does not add TLS, SSH tunnelling, or a gateway. Use loopback or a trusted private network, or establish a separately managed secure tunnel before connecting to a remote q process.

## Running q

The extension contributes minimal q language support for `.q` files and these editor commands:

| Command | Windows/Linux | macOS | Behavior |
| --- | --- | --- | --- |
| **KX: Run Selection / Current Line** | `Ctrl+Enter` | `Cmd+Enter` | Runs the selection exactly; without a selection, runs the complete current physical line exactly. |
| **KX: Run q Script** | `Ctrl+Alt+Enter` | `Cmd+Alt+Enter` | Runs the complete active `.q` document. |
| **KX: Run Selection in New Result** | `Ctrl+Shift+Enter` | `Cmd+Shift+Enter` | Runs the exact selection, or the exact current physical line when there is no selection, in a new result panel. |

Multiline selections are preserved as selected and evaluated using q's own script-line grouping. There is no SQL parser, extension-owned statement splitter, current-block inference, or hidden session-file behavior.

Whole-document runs and multiline selections use [q's own documented script-line grouping](https://code.kx.com/q/ref/dotq/#ld-load-and-group), including q indentation and script termination rules; they require q 4.0 dated 2023-03-28 or newer (or q 4.1t dated 2022-11-01 or newer). Single-line selections and current-line execution remain raw q queries and do not use this grouping helper.

Queries use the active connection. A normal run replaces the active result panel; **Run Selection in New Result** keeps the existing panel and opens another.

Canceling a result wait is local and best-effort: the panel stops waiting immediately, but q computation or side effects already sent to the server can continue. It does not cancel other queued result panels on the same connection. Use **Disconnect** when you intentionally need to close that connection and fail its outstanding work.

## Result panel

All q results open in the KX-owned viewer; there is no alternate SQLTools result target. The viewer includes:

- columnar result storage and row virtualization for responsive large-table browsing;
- native q scalar, vector, dictionary, keyed-table, table, and text/function presentation, with configurable grid or q-text display where appropriate;
- cell/range selection, keyboard navigation, search, sorting, column visibility and sizing, and compact-to-comfortable density controls;
- copy and export for selections or full results, including CSV, XLSX, TSV, JSON, NDJSON, HTML, Markdown, and plain text as applicable;
- line, scatter, step, bar, box, and candlestick charts, grouped series, zoom/refinement, and PNG export; and
- an opt-in, tokenized local data endpoint bound only to `127.0.0.1` for controlled CSV/JSON/NDJSON access to the current result.

Large copy, export, rendering, and chart operations have configurable safety limits. The viewer exposes only implemented actions; it does not contain placeholder explorer or gateway controls.

## Diagnostics

Open **View > Output** and select **KX** for connection, handshake, query, cancellation, disconnect, and close lifecycle diagnostics. Records include the phase and direct host/port where useful, but omit query text and result values. Authentication credentials, SecretStorage values, and local-data-server tokens are redacted or omitted.

For additional safe operation timings, enable this setting explicitly:

```json
"vscode-kdb.performance.trace": true
```

The setting is opt-in and is never changed automatically. Performance tracing adds operation durations, sizes/counts, and memory details to the KX output without logging query values or credentials.

## Phase 1 scope

Phase 1 supports direct q IPC only. SSH setup, TLS termination, gateway or broker configuration, and remote connection orchestration are intentionally outside this release. There is no object explorer for tables, functions, or namespaces in 0.1.1; unreliable metadata placeholders are deliberately omitted.

## Development and verification

Requirements: a current Node.js/npm installation and a supported VS Code installation for local extension development.

```sh
npm ci
npm run compile
node test/run.js
npm run test:unit
npm test
```

`node test/run.js` is the focused harness for q IPC serialization/deserialization, q-text selection/current-line extraction, connection validation and namespace wrapping, connection-manager lifecycle, diagnostics/redaction, result conversion, and manifest/source guards. `npm run test:unit` and `npm test` compile and run that same harness. `npm test` is intentionally not labelled as Extension Host E2E: launching Electron reliably is not available in every minimal or headless release environment, while these Phase 1 behaviors can be tested deterministically without it.

If a local q executable is available at `~/.kx/bin/q`, run the optional live IPC test:

```sh
npm run test:live-q
```

The live runner detects that location automatically and skips cleanly when q is unavailable. Set `VSCODE_KDB_Q_BIN=/path/to/q` to select another executable, or `VSCODE_KDB_LIVE_REQUIRED=1` to make an unavailable q executable fail the run.

The MkDocs sources are under `mkdocs-src/`, and generated `docs/` is committed. Run the same strict build and drift gate as the Pages workflow:

```sh
python3 -m venv /tmp/vscode-kdb-docs-venv
. /tmp/vscode-kdb-docs-venv/bin/activate
python -m pip install --requirement mkdocs-src/requirements.txt
mkdocs build --strict
python .github/scripts/clean-mkdocs-output.py docs
git diff --exit-code -- docs
test -z "$(git status --porcelain -- docs)"
```

The workflow uploads generated docs as an artifact but intentionally does not deploy or change repository Pages configuration. See `mkdocs-src/README.md` for the exact documentation and extension contributor checks.

Package the extension with either the project script or an explicit artifact path:

```sh
npm run package
npx @vscode/vsce package --out vscode-kdb-0.1.1.vsix
```

The VSIX is assembled through `.vscodeignore`; development dependencies, tests, caches, source maps, prompt files, archives, and local secrets are excluded from the release artifact.

## License

KX for VS Code is released under the [MIT License](LICENSE). Bundled third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

KX and the KX logo are trademarks of KX. They are used here solely to identify KX/kdb+ integration. This independent project is not affiliated with or endorsed by KX.

kdb+ and q are products of KX. This project is not a SQLTools extension and does not require SQLTools to be installed.
