# Connections & SecretStorage

KX for VS Code owns its direct q IPC connections. They appear in the **KX Connections** sidebar and are independent of SQLTools.

## Connection fields

| Field | Use |
| --- | --- |
| Name | Unique display name, up to 100 characters. |
| Host | Direct q hostname, IPv4 address, or IPv6 address. Do not enter a URL or path. |
| Port | q IPC port from `1` through `65535`; a new form defaults to `5000`. |
| Namespace / database | `.` for root, or a dot-qualified q namespace such as `.analytics`; a new form defaults to `.`. |
| Username | Optional q IPC username. |
| Password | Optional secret combined with the username for the q IPC handshake. It is a password input and is stored only in SecretStorage. |
| Connect / handshake timeout | Optional per-connection millisecond override in **Advanced direct q IPC**. Blank inherits the global default. |
| Query timeout | Optional per-connection millisecond override in **Advanced direct q IPC**. Blank inherits the global default. |

Namespaces are normalized to a leading dot. Invalid hosts, ports, namespaces, duplicate names, unsupported username characters, and timeout values are rejected before storage. Timeout overrides must be whole numbers from `0` through `2147483647`; `0` disables the corresponding deadline.

## Add, edit, and remove

Use the sidebar toolbar, item context menus, or Command Palette:

- **KX: Add Connection**
- **KX: Edit Connection**
- **KX: Remove Connection**
- **KX: Set Active Connection**
- **KX: Connect**
- **KX: Disconnect**
- **KX: Test Connection**
- **KX: Refresh Connections**

Add and Edit open the same dedicated, single-screen **KX Connection** webview. All normal fields are visible together; the two implemented timeout overrides are in a clearly labelled collapsible **Advanced direct q IPC** section. The form is responsive, uses VS Code theme colors, and does not present unsupported SSH, TLS, gateway, broker, keep-alive, or reconnect-policy controls.

Choose **Save Connection** to submit or **Cancel** to close without changes. Enter submits only while the form is valid; Escape cancels. Each control has a label and description, errors are announced and focus the relevant field, and initial focus moves to the connection name. Browser checks provide immediate feedback, but the extension host treats every webview message as untrusted and validates it again.

When editing, **Delete Connection** is also available. It asks for explicit confirmation through a modal VS Code notification in the extension host, not browser `confirm`. Removing a connection also removes its secret.

### Password edits

A stored password is never read back into or reflected by the webview. On Edit, the password field is empty:

- leave it blank to keep the saved password;
- enter a new password to replace it; or
- select **Clear saved password** to remove it. The control appears only when a saved password exists.

Connection changes use rollback handling so a failed settings or secret write does not intentionally leave half-written state. A validation error, Cancel, or webview disposal does not modify the saved profile or active client; reopen Edit to try again. Each panel accepts only its own session token and ignores stale messages after disposal.

## Timeout model

`vscode-kdb.connectionTimeoutMs` defaults to `30000`. It is the global direct q IPC connect/handshake deadline. TCP connect gets the full budget, and after TCP succeeds the q IPC handshake gets a new full budget.

`vscode-kdb.queryTimeoutMs` defaults to `null`. Null inherits `connectionTimeoutMs`, preserving the behavior of profiles created before the split query setting. A numeric value sets a distinct global query-response timeout. A blank profile override inherits the corresponding resolved global value; specifically, a blank query override uses the global query value, which under the default `null` is the global `connectionTimeoutMs` value.

All global values and profile overrides accept only integers from `0` through `2147483647`; `0` disables that deadline. Query queue wait is not timed. The query deadline starts when that connection makes the query active and sends it, and runs until the response completes. On expiry the uncertain socket is discarded. Errors identify the `connect`, `handshake`, or `query` phase and direct endpoint without including credentials or query contents.

## Active and connected state

**Active** identifies the connection used by editor runs. **Connected** means an IPC socket is currently open. They are separate states:

- The first added connection becomes active.
- A run opens the active connection on demand when needed.
- If no connection is active, the run asks you to add or select one.
- A transport failure or remote close drops the client and refreshes the sidebar state.
- Explicit **Disconnect** closes that client's outstanding IPC work.

**Test Connection** uses a temporary connection and verifies that `1+1` returns `2`; it does not keep that test socket as the active client.

Saving is persisted-first. Name or namespace-only edits do not recycle a healthy connected client. If host, port, username, password, connect timeout, or query timeout changes, safe metadata and the requested SecretStorage operation are committed first; an existing connected client is then disconnected and reconnected with the saved values. If reconnect fails, the new profile remains saved, the client remains disconnected, and KX shows a warning instead of silently using stale settings. A disconnected edited profile simply uses the new values on its next connection.

## Storage and secrets

Safe metadata is stored in the application-scoped user setting `vscode-kdb.connections`:

- generated connection ID;
- display name;
- host and port;
- database/namespace;
- username; and
- optional `connectTimeoutMs` and `queryTimeoutMs` overrides.

Passwords and authentication secrets are not written into that setting. Each connection's secret is stored under an extension-specific key in VS Code `SecretStorage`, which delegates at-rest protection to VS Code and the operating system.

Do not add a password field to `settings.json`. Do not paste credentials into logs, issue reports, or example queries.

## Network security

Direct q IPC is plaintext in transit, including handshake credentials and query traffic. The standalone release does not implement TLS, SSH configuration, gateways, brokers, or remote orchestration. Use loopback, a trusted private network, or a separately managed secure tunnel whose lifecycle remains outside the extension.

## Focused Server Explorer

`vscode-kdb.features.serverExplorer` defaults to `false`. When enabled, **KX Server Explorer** is a separate tree under the KX activity bar whenever an active direct q IPC profile exists. A disconnected profile leaves a clear reconnect status instead of stale metadata; requests require it to be connected. The connection tree remains responsible only for connection state and lifecycle.

The explorer never polls. Select **KX: Refresh Server Explorer** to query the active profile's configured namespace. Refresh uses q-native `tables[]` for table names and obtains names plus safe q type metadata for the **Variables & Functions** category without fetching the remote values. Only safely recognized function type codes are labelled as functions; unknown or other objects are conservatively labelled as variables. Non-standard names that cannot be executed safely are omitted and reported.

Expand a table to invoke `meta` explicitly and show column name, q type, foreign-key, and attribute metadata. Table expansion is also on demand. Permission errors, missing/stale objects, timeouts, disconnects, cancellation, and a changed active connection or namespace produce a retryable status instead of retaining misleading tree data. Canceling a metadata wait is local: q work already sent may still finish on the server.

**Preview** is a separate, confirmed action for tables and variables and opens the selected object through the normal KX Results pipeline in the configured namespace. Functions and projections remain metadata-only because captured arguments can exceed any meaningful preview limit. The explorer accepts only standard q identifiers beginning with a letter and continuing with letters, digits, or underscores, up to 255 characters; it never treats an arbitrary tree label as executable q text. `vscode-kdb.serverExplorer.previewCellLimit` defaults to approximately `10000` table cells or `10000` outer list/dictionary items and is configurable from `1` through `1000000`. Nested values and scalars may still be large, which is why every preview warns before materializing anything.

Explorer requests temporarily apply the configured namespace and restore q's previous namespace. They install no server scripts, persist no remote state, and provide no namespace browser, write action, SSH/TLS, gateway, or Insights controls.

## Namespace behavior

Root namespace `.` sends a single-line/current-line query as written. A non-root namespace wraps the query so q temporarily switches namespace, evaluates the text, restores the previous namespace, and rethrows genuine q errors.

Whole-document and multiline selection runs use the corresponding script wrapper while preserving the same configured namespace. See [Running q](running-q.md) for script grouping and version requirements.
