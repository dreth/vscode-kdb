## MODIFIED Requirements

### Requirement: Deterministic dotenv and environment resolution
The existing resolution and connection-identity requirements in this block SHALL remain the default connection-credential mode.
Explicit request mode SHALL use the request-context-credentials contract without changing unrelated profiles or saved outputs.
An explicitly configured dotenv file SHALL be read as data, never executed or injected into process.env, and its named value SHALL take precedence over the same extension-host variable.
A variable absent from a successfully read file SHALL fall back to the extension-host environment; an explicitly blank file value SHALL remain blank and fail required-credential validation.
In default connection mode, a configured missing, unreadable or malformed file, an ambiguous workspace-relative path, or a missing/blank referenced credential SHALL fail before IPC with the file/key identified but no credential values disclosed.
No shell, command or dotenv variable interpolation SHALL be performed.
Workspace-relative paths SHALL bind to the connection's unambiguous owning workspace folder, and workspace-provided bindings SHALL not resolve files in an untrusted workspace.

#### Scenario: Connect after setup or rotation
- **GIVEN** setup has written a valid file-backed username and password
- **WHEN** the user connects, tests or explicitly reconnects after changing that file
- **THEN** KX uses the current named values without an extension-host restart or repeated credential input.

#### Scenario: Preserve literal credential characters
- **GIVEN** a supported quoted single-line password containing spaces, hash, equals, dollar signs, quotes, backslashes or non-ASCII text
- **WHEN** it is loaded through the documented dotenv format
- **THEN** its exact value reaches the IPC handshake without shell expansion or whitespace loss.

#### Scenario: Missing explicit credentials cannot revive old shared access
- **GIVEN** a passwordEnv reference, an absent referenced value and an old saved SecretStorage/configured password
- **WHEN** the user connects or tests
- **THEN** KX reports missing configuration before IPC and does not use the old password.

#### Scenario: Regression — Legacy credential precedence survives
- **GIVEN** a connection without explicit environment references
- **WHEN** KX resolves authentication
- **THEN** its literal username and SecretStorage-before-configured-password precedence remain unchanged, including supported passwordless connections.

### Requirement: Shared connection lifecycle and secret-free outputs
The existing resolution and connection-identity requirements in this block SHALL remain the default connection-credential mode.
Explicit request mode SHALL use the request-context-credentials contract without changing unrelated profiles or saved outputs.
Normal editor/Results execution, live q-only and mixed notebooks, temporary connection tests and reconnects SHALL use the same credential resolution policy.
Editing or reading an env file SHALL NOT connect, replay a query, change the active profile, or silently close another live session.
In default connection mode, an existing session SHALL continue under its established identity until explicit reconnect; new test sessions SHALL use current references and preserve cancellation and stale-result fencing.
Passwords SHALL NOT appear in diagnostics, failure reports, exports, query history, public snapshots or saved notebook metadata/output.

#### Scenario: Regression — Notebooks and editor share the active session
- **GIVEN** a live environment-backed active connection
- **WHEN** editor, qnb and mixed notebook actions execute q
- **THEN** they retain the established active-session, namespace, timeout, result and exactly-once contracts
- **AND** saved notebook output remains readable without resolving credentials or reviving a connection.

#### Scenario: Regression — Temporary test cancellation remains isolated
- **GIVEN** a pending connection test with environment-backed credentials
- **WHEN** the user cancels it or supersedes its configuration
- **THEN** its late result is ignored and only the owned temporary transport is closed
- **AND** no active session or unrelated credentials are modified.
