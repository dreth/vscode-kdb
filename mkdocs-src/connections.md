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

## One-time legacy SQLTools import

**KX: Import SQLTools KDB Connections** is a KX-owned migration bridge for users who already have KDB profiles in VS Code's `sqltools.connections` setting. Invoke it from the Command Palette or KX Connections toolbar. It reads settings only when invoked, creates standalone KX direct IPC profiles, and then stops. SQLTools need not be installed or activated; its setting is never changed, and there is no background, startup, or ongoing synchronization.

Discovery treats every setting value as untrusted. It inspects explicit user, workspace, and workspace-folder values and uses the effective value only when explicit scope values are unavailable. Equivalent candidates across scopes are deduplicated, but all contributing source labels remain visible in the review. Only these normalized legacy driver aliases are recognized:

- `KDB`
- `kdb+`
- `kdb`
- `kdb-sqltools`
- `DanielAlonso.kdb-sqltools`

All other SQLTools drivers are ignored before their endpoint, authentication, password, or other fields are inspected. Candidate identity uses the sanitized connection label plus direct endpoint, namespace, and username; no source ID or raw HTML is trusted.

The multi-select review shows:

- sanitized source profile name;
- direct `host:port`;
- validated/defaulted q namespace;
- every source scope;
- password presence as **present (value hidden)**, **not present**, or **not inspected**; and
- legacy timeout seconds mapped to milliseconds for KX connect/handshake only, with an explicit reminder that query timeout is not migrated.

Malformed legacy KDB candidates remain visible with a safe reason and cannot be selected. This includes missing or invalid names/servers, ports outside `1`-`65535`, invalid namespaces/usernames, passwords containing a null character or exceeding 65,535 characters, unsafe field access, and timeouts that cannot convert to a whole number from `0` through `2147483647` milliseconds. A profile with `ssh: "Enabled"` is shown as **Not importable: requires SQLTools SSH tunnelling**. KX never copies `sshOptions` or SSH credentials and never turns such a profile into a non-working direct connection.

For an importable candidate, KX maps:

| Legacy SQLTools field | Standalone KX field |
| --- | --- |
| connection `name` | unique KX connection name |
| `server` | `host` |
| `port` | `port` |
| `database` | validated q namespace; missing/blank defaults to `.` |
| `username` | `username` |
| `connectionTimeout` seconds | `connectTimeoutMs` only, after checked multiplication by 1,000 |
| `password` | new profile's VS Code SecretStorage key, only after explicit confirmation |

`connectionTimeout: 0` becomes `connectTimeoutMs: 0`. A missing legacy timeout uses the old 30-second schema default. Import never sets `queryTimeoutMs`; the profile continues to inherit the resolved global KX query default until the user edits it. In particular, a per-profile imported connect timeout is not silently reused as that profile's query timeout.

Before any selected plaintext password is copied, a modal prompt explains that KX will re-read it once, write it to SecretStorage, leave the SQLTools setting unchanged, and establish no sync. Choose **Copy Passwords and Import**, explicitly choose **Import Without Passwords**, or cancel without changing KX profiles or secrets. Password values never appear in QuickPick items, notifications, logs, diagnostics, telemetry, Query History, errors, snapshots, webview messages, or `vscode-kdb.connections`; references are discarded after each attempt.

Existing KX data is protected. A conflict by case-insensitive name or equivalent host/port/namespace/username offers only:

- **Skip (recommended)** — keep the saved KX profile unchanged; or
- **Import as new name** — create a separate profile after standalone name validation.

Version 0.2.2 has no replace action and never overwrites a saved profile or secret. Conflicts are checked again before each add, so a profile that becomes conflicting is skipped. Successful adds use the normal ConnectionStore settings/SecretStorage transaction. The first standalone connection follows the normal active-profile rule; existing connected clients are not recycled because no existing profile is edited.

The final notification reports imported, skipped, unsupported, and failed counts, states that the source settings remain unchanged with no ongoing sync, and offers **Review Imported Connection** for review and testing. A no-candidate invocation shows one quiet informational message and does not require SQLTools.

## Add, edit, and remove

Use the sidebar toolbar, item context menus, or Command Palette:

- **KX: Add Connection**
- **KX: Edit Connection**
- **KX: Remove Connection**
- **KX: Set Active Connection**
- **KX: Connect**
- **KX: Disconnect**
- **KX: Test Connection**
- **KX: Import SQLTools KDB Connections**
- **KX: Refresh Connections**

Add and Edit open the same dedicated, single-screen **KX Connection** webview. All normal fields are visible together; the two implemented timeout overrides are in a clearly labelled collapsible **Advanced direct q IPC** section. The form is responsive, uses VS Code theme colors, and does not present unsupported SSH, TLS, gateway, broker, keep-alive, or reconnect-policy controls.

Choose **Save Connection** to submit or **Cancel** to close without changes. Enter submits only while the form is valid; Escape cancels. Each control has a label and description, errors are announced and focus the relevant field, and initial focus moves to the connection name. Browser checks provide immediate feedback, but the extension host treats every webview message as untrusted and validates it again.

Choose the visible **Test Connection** button to validate and test the current unsaved form values without saving. The name, host, port, namespace, username, password choice, and resolved per-profile/global timeouts are all taken from the current form. A fresh temporary socket proves TCP connect and q IPC handshake, validates a non-root namespace through a read-only type/current-namespace expression, performs a minimal response check, and closes. The test does not alter the saved profile, active connection, Query History, or remote definitions.

Test status is announced and identifies the `validation`, `connect`, `handshake`, `namespace`, `query`, or `cancel` phase with the safe direct host/port only. Starting another test cancels the older one. Save remains available during a test and cancels that test before normal persistence; Cancel, Escape, and closing the panel also cancel and close the temporary transport. Late responses from superseded or closed tests are ignored.

When editing, **Delete Connection** is also available. It asks for explicit confirmation through a modal VS Code notification in the extension host, not browser `confirm`. Removing a connection also removes its secret.

### Password edits

A stored password is never read back into or reflected by the webview. On Edit, the password field is empty:

- leave it blank to keep the saved password;
- enter a new password to replace it; or
- select **Clear saved password** to remove it. The control appears only when a saved password exists.

The same rules apply to testing: a blank edit can use the saved secret only when the extension host retrieves it from SecretStorage, and status discloses only that a saved secret was used. A new password remains in memory for the test; Clear means do not use the saved secret. No password is reflected into the webview, logs, settings, history, or test status.

Connection changes use rollback handling so a failed settings or secret write does not intentionally leave half-written state. A validation error, Cancel, or webview disposal does not modify the saved profile or active client; reopen Edit to try again. Each panel accepts only its own session token and ignores stale messages after disposal.

## Timeout model

`vscode-kdb.connectionTimeoutMs` defaults to `30000`. It is the global direct q IPC connect/handshake deadline. TCP connect gets the full budget, and after TCP succeeds the q IPC handshake gets a new full budget.

`vscode-kdb.queryTimeoutMs` defaults to `null`. Null inherits `connectionTimeoutMs`, preserving the behavior of profiles created before the split query setting. A numeric value sets a distinct global query-response timeout. A blank profile override inherits the corresponding resolved global value; specifically, a blank query override uses the global query value, which under the default `null` is the global `connectionTimeoutMs` value.

All global values and profile overrides accept only integers from `0` through `2147483647`; `0` disables that deadline. Query queue wait is not timed. The query deadline starts when that connection makes the query active and sends it, and runs until the response completes. On expiry the uncertain socket is discarded. Errors identify the `connect`, `handshake`, or `query` phase and direct endpoint without including credentials or query contents.

## Active and connected state

**Active** identifies the connection used by normal `.q` editor runs. **Connected** means an IPC socket is currently open. They are separate states:

- The first added connection becomes active.
- A run opens the active connection on demand when needed.
- If no connection is active, the run asks you to add or select one.
- A transport failure or remote close drops the client and refreshes the sidebar state.
- Explicit **Disconnect** closes that client's outstanding IPC work.

Both the form button and the saved-profile **KX: Test Connection** command use temporary connections and a deliberately minimal safe response request; neither keeps the test socket as the active client.

Notebook language selection and `%%q` execution do not use this connection manager. The q cell action changes only the cell document language; the `kx_notebook` helper calls only the evaluator explicitly configured in that Python kernel, and optional PyKX uses that kernel's existing PyKX object. The extension deliberately does not intercept Jupyter to route a cell through the extension session and does not create a second extension direct-q connection. A future persistent notebook evaluator must bridge the active Python kernel's q session. Opening a saved notebook preview in KX Results transfers only the bounded stored rows and cannot recover a full live result.

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

During discovery, the importer inspects the password field of a matching legacy KDB profile only to classify it as absent, present, or invalid; the value is not returned in the candidate model or retained through review. After that profile is selected and the modal copy choice is confirmed, KX re-reads only its exact scoped source entry, validates the password, immediately hands it to the normal SecretStorage transaction, and releases the source snapshot. It is never retained as a KX setting. Workspace-scoped source data receives the same validation as every other untrusted configuration value.

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
