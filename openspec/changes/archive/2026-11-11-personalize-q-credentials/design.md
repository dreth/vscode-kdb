## Context

Current `ConnectionStore.resolvePassword` chooses SecretStorage before the configured fallback; usernames remain ordinary `KxConnection` fields.
`ConnectionManager` creates live and temporary connections through several paths, so resolving only at UI activation would leave tests/reconnects inconsistent.
VS Code does not expand arbitrary settings variables automatically: [VS Code variables reference](https://code.visualstudio.com/docs/reference/variables-reference).
A shell export made by `just setup` also cannot change an already running extension host; explicit file-backed reads solve that lifecycle boundary.

## Goals / Non-Goals

**Goals:** Add one generic credential resolver with deterministic precedence, exact string preservation and current-file reads for newly created IPC sessions.
**Non-Goals:** Consumer-specific naming, credential provisioning, editing/exporting .env values, shell expansion, automatic reconnect, changes to q result/MIME contracts, or shared authentication with another extension.

## Decisions

### Generic KX names and explicit references
The documented default pair is `KX_VSCODE_USERNAME` and `KX_VSCODE_PASSWORD`; additional independent connections can use explicitly named `KX_VSCODE_<CONNECTION_KEY>_USERNAME` and `_PASSWORD`.
The resolver remains generic and does not know any consumer company, repository, endpoint or private environment-variable namespace.
Keep integration notes that identify private consumers outside this public repository, including planning artifacts and release notes.

### Explicit fields instead of label-derived variable names
Extend the persisted connection model/settings schema/form with optional `envFile`, `usernameEnv` and `passwordEnv`.
References are ordinary non-secret configuration; validate variable names and support them through normalization, safe persistence, duplicate/edit flows, scope merges and source fingerprints.
Labels remain free to change without rebinding credentials.
Do not reinterpret an existing literal `${env:...}` username or password as a reference; existing raw-string contracts remain intact.

### Resolve only at authentication boundaries
Add one resolver returning ephemeral effective username/password for connect, connection test, lazy session creation and reconnect.
For a field with an explicit variable reference, read the configured dotenv file and use the file's own property if present, otherwise the extension-host variable.
An explicitly blank value is missing authentication and does not trigger legacy fallback; a configured bad file/path fails before IPC.
For a field without a reference, retain its existing literal username or SecretStorage-before-configured-password behavior.
Reference resolution outranks stale SecretStorage only for the explicitly referenced field; editing a file never writes its value into SecretStorage or settings.

### Bind files to an unambiguous workspace
Support absolute paths and `${workspaceFolder}`/relative paths resolved against the connection's owning workspace folder.
For global/workspace connections with no unique owner in multi-root workspaces, require an explicit absolute file path or an unambiguous folder binding instead of choosing the first folder.
Moving a folder-relative connection across scopes must preserve the binding or obtain an explicit replacement; saving only a new scope cannot silently select another folder's secret.
Do not read workspace-driven credential files until VS Code workspace trust permits it.
Read fresh for each new/test session, without caching resolved secrets, directory watching, process.env mutation or automatically disconnecting existing transports.

### Treat dotenv as data and keep lifecycle ownership
Use a small strict single-line dotenv parser with the same quoting/escape fixtures as setup; this avoids differing parser expansion policies and introduces no runtime dependency. Parsing performs no shell/command/variable expansion.
Support documented single-line quoting, comments and exact punctuation/Unicode, with malformed input producing sanitized key/path diagnostics.
Normal settings edits preserve active-connection, queued-mutation/rollback, stale-test and cancellation rules; env changes affect the next explicit/new connection, not already running queries.
Resolved values must not enter connection equality keys, telemetry, diagnostics, query history, saved notebook output or public semantic snapshots.
Saved output rendering remains fully offline and the Python notebook helper's independent connection contract does not change.

## Risks / Trade-offs

- Missing secrets become explicit connect errors; this is intentional for referenced fields and prevents revival of a shared saved password.
- Different dotenv readers can disagree; use a shared fixture corpus with consumers and test exact strings, malformed files, precedence and required-value errors.
- Older extension versions ignore the new fields. Consumer adoption must follow availability of a tested compatible build; publication is a separate delivery action.

## Migration Plan

Add regression tests before/with the resolver, extend every persisted/form boundary, and verify editor, temporary test and notebook connection paths share it.
Run `npm test` and the applicable extension-host connection suites; rebuild documentation from `mkdocs-src` through the existing workflow and update README/changelog.
A versioned compatible extension build is required for coordinated consumer rollout, but this proposal does not authorize publishing it.
Legacy configurations remain valid; removing references deliberately returns that connection to its preceding literal/SecretStorage behavior without deleting existing secrets.
