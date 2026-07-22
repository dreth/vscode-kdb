# KX for VS Code

KX for VS Code is a standalone extension for working with kdb+/q directly in Visual Studio Code. It provides q language support, extension-owned direct q IPC connections, exact editor execution, a KX activity-bar view, and a high-performance native result panel.

Version 0.1.3 has no SQLTools dependency. It does not call SQLTools APIs, contribute SQLTools commands, or create or interpret `.session.sql` files.

Documentation: [standalone user guide](mkdocs-src/index.md) and [source-backed parity matrix](PARITY.md). The generated site is tracked under `docs/`; no Pages deployment is implied.

## Quick start

1. Start a local q process that listens for IPC connections:

   ```sh
   q -p 127.0.0.1:5000
   ```

   The common `q -p 5000` form listens on all network interfaces. Use it only on a trusted, firewalled machine; the loopback form above avoids exposing an unauthenticated local development process to the network.

2. Install KX for VS Code and open the **KX** activity-bar icon.
3. In **KX Connections**, choose **Add Connection**. The **KX Connection** form shows the direct host, port, namespace, optional authentication, and timeout overrides together. Enter a unique name, `localhost`, port `5000`, and `.` for the root namespace, then choose **Save Connection**.
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

Connection errors identify the failed `connect`, `handshake`, or `query` phase and direct host/port so endpoint, network, authentication, and q-listener problems can be distinguished. They do not include credentials or query contents.

### KX Connection form

**Add Connection** and **Edit Connection** open the same responsive, theme-aware **KX Connection** form instead of a sequence of VS Code prompts. Name, host, port, namespace/database, username, and password are visible together. Name and host are required, names are unique, port is an integer from `1` through `65535`, and namespace defaults to `.`. The help text explains that the endpoint is direct q IPC and that the database value is the q namespace used for editor runs.

The collapsible **Advanced direct q IPC** section provides optional per-connection **Connect / handshake timeout (ms)** and **Query timeout (ms)** overrides. Leave a value blank to use its global default. Only whole numbers from `0` through `2147483647` are accepted; `0` disables that timeout. No SSH, TLS, gateway, broker, keep-alive, or reconnect-policy controls are presented.

**Save Connection** is enabled only when the browser-level form checks pass, and every submitted message is validated again by the extension host before storage. Enter submits a valid form. Escape and **Cancel** close it without changing storage or the current connection. Labels, descriptions, an announced error region, invalid-field focus, and initial name-field focus support keyboard and screen-reader use. **Delete Connection** appears when editing and opens an explicit modal VS Code confirmation; the webview does not use browser `confirm`.

When editing a connection with a saved password, the password input is always empty and says to leave it blank to keep the existing secret. Enter a value to replace the secret, or select **Clear saved password** to delete it. The saved value itself is never sent back to the webview.

### Timeout behavior

`vscode-kdb.connectionTimeoutMs` is the global connect/handshake default and remains `30000` milliseconds. The same complete budget applies separately to the TCP connect phase and then to the q IPC handshake phase. `vscode-kdb.queryTimeoutMs` defaults to `null`, which inherits `connectionTimeoutMs` for compatibility with existing profiles; set an integer to configure a separate global query timeout. A blank per-connection override inherits the corresponding resolved global value.

The query timer starts when a queued query becomes active and is sent; time spent waiting behind an earlier query on the same connection is not included. A query timeout drops the uncertain socket. Every timeout accepts `0` to disable it and is bounded at `2147483647` milliseconds.

### Update lifecycle

Validation failures and Cancel leave both persisted data and any connected client unchanged. Save writes the safe profile and requested SecretStorage change first. If a connected profile's host, port, username, password, or timeout changes, the old client is then disconnected and a reconnect is attempted with the saved settings. A reconnect failure leaves the new profile saved, the client disconnected, and shows a warning; it does not restore or silently reuse the stale client. Name and namespace-only edits do not recycle an otherwise valid client. Deleting a connection removes its stored password and disconnects its client.

### Security model

Safe connection metadata is kept in the global user setting `vscode-kdb.connections`: connection ID, name, host, port, database/namespace, username, and optional `connectTimeoutMs` / `queryTimeoutMs` overrides. Passwords are never written to settings. Each password is stored under a connection-specific key in VS Code `SecretStorage`, using the credential protection provided by VS Code and the operating system at rest. Removing a connection removes its stored secret. Passwords are not included in extension logs, documentation samples, packaged files, connection errors, or saved-profile messages sent to the webview.

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

Phase 1 supports direct q IPC only. SSH setup, TLS termination, gateway or broker configuration, and remote connection orchestration are intentionally outside this release. There is no object explorer for tables, functions, or namespaces in 0.1.3; unreliable metadata placeholders are deliberately omitted.

## Development and verification

Requirements: a current Node.js/npm installation and a supported VS Code installation for local extension development.

```sh
npm ci
npm run compile
node test/run.js
npm run test:unit
npm test
```

`node test/run.js` is the focused harness for q IPC serialization/deserialization, q-text selection/current-line extraction, connection-form payload and timeout validation, SecretStorage keep/replace/clear behavior, persisted-first connection lifecycle, namespace wrapping, diagnostics/redaction, result conversion, and manifest/source/webview guards. `npm run test:unit` and `npm test` compile and run that same harness. `npm test` is intentionally not labelled as Extension Host E2E: launching Electron reliably is not available in every minimal or headless release environment, while these Phase 1 behaviors can be tested deterministically without it. Release 0.1.3 does not claim a visual Extension Host E2E run, and no screenshot is presented as test evidence.

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
npx @vscode/vsce package --out vscode-kdb-0.1.3.vsix
```

The VSIX is assembled through `.vscodeignore`; development dependencies, tests, caches, source maps, prompt files, archives, and local secrets are excluded from the release artifact.

## License

KX for VS Code is released under the [MIT License](LICENSE). Bundled third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

KX and the KX logo are trademarks of KX. They are used here solely to identify KX/kdb+ integration. This independent project is not affiliated with or endorsed by KX.

kdb+ and q are products of KX. This project is not a SQLTools extension and does not require SQLTools to be installed.
