# Connections & SecretStorage

KX for VS Code owns its direct q IPC connections. They appear in the **KX Connections** sidebar and are independent of SQLTools.

## Connection fields

| Field | Use |
| --- | --- |
| Name | Unique display name, up to 100 characters. |
| Host | Direct q hostname, IPv4 address, or IPv6 address. Do not enter a URL or path. |
| Port | q IPC port from `1` through `65535`; the prompt defaults to `5000`. |
| Database / Namespace | `.` for root, or a dot-qualified q namespace such as `.analytics`. |
| Username | Optional q IPC username. |
| Authentication secret | Optional secret combined with the username for the q IPC handshake. |

Namespaces are normalized to a leading dot. Invalid hosts, ports, namespaces, duplicate names, and unsupported username characters are rejected before storage.

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

Editing offers explicit choices to keep, replace, or remove the stored authentication secret. Removing a connection also removes its secret. Connection changes use rollback handling so a failed settings or secret update does not intentionally leave half-written state.

## Active and connected state

**Active** identifies the connection used by editor runs. **Connected** means an IPC socket is currently open. They are separate states:

- The first added connection becomes active.
- A run opens the active connection on demand when needed.
- If no connection is active, the run asks you to add or select one.
- A transport failure or remote close drops the client and refreshes the sidebar state.
- Explicit **Disconnect** closes that client's outstanding IPC work.

**Test Connection** uses a temporary connection and verifies that `1+1` returns `2`; it does not keep that test socket as the active client.

## Storage and secrets

Safe metadata is stored in the application-scoped user setting `vscode-kdb.connections`:

- generated connection ID;
- display name;
- host and port;
- database/namespace; and
- username.

Passwords and authentication secrets are not written into that setting. Each connection's secret is stored under an extension-specific key in VS Code `SecretStorage`, which delegates at-rest protection to VS Code and the operating system.

Do not add a password field to `settings.json`. Do not paste credentials into logs, issue reports, or example queries.

## Network security

Direct q IPC is plaintext in transit, including handshake credentials and query traffic. Phase 1 does not implement TLS, SSH configuration, gateways, brokers, or remote orchestration. Use loopback, a trusted private network, or a separately managed secure tunnel whose lifecycle remains outside the extension.

The connection sidebar is not an object explorer. Phase 1 does not enumerate server tables, functions, or namespaces.

## Namespace behavior

Root namespace `.` sends a single-line/current-line query as written. A non-root namespace wraps the query so q temporarily switches namespace, evaluates the text, restores the previous namespace, and rethrows genuine q errors.

Whole-document and multiline selection runs use the corresponding script wrapper while preserving the same configured namespace. See [Running q](running-q.md) for script grouping and version requirements.
