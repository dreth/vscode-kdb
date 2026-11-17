## Why

KX currently resolves passwords from VS Code SecretStorage or configured plaintext and reads usernames from settings; it does not read credentials from a local .env file.
Users need an explicit file-backed credential source that works after setup without restarting the extension host or placing personal values in shared settings.

## What Changes

- Use `KX_VSCODE_USERNAME` and `KX_VSCODE_PASSWORD` in generic credential examples; support explicit `KX_VSCODE_<CONNECTION_KEY>_*` references for additional connections without deriving keys from display labels.
- Keep all public source, tests, examples and planning artifacts free of employer names, private repository identities and internal endpoints.
- Add optional per-connection `envFile`, `usernameEnv` and `passwordEnv` references, editable in the connection form and preserved across settings scopes, duplication and migration.
- Resolve an explicitly named variable from the selected dotenv file first, then from the extension-host environment; resolve at connect/test/reconnect time without mutating process.env or saved settings.
- Explicit references are authoritative: missing/blank referenced credentials fail before IPC and cannot fall back to an old SecretStorage or configured password.
- Retain existing literal username and SecretStorage-before-configured-password behavior when references are absent.
- Use one resolver across editor/Results, live qnb/mixed notebook execution and temporary connection tests; saved notebook output never contains or resolves credentials.

## Capabilities

### New Capabilities
- `environment-backed-kx-credentials`: Explicit, secret-safe credential references with deterministic dotenv and process-environment resolution.

### Modified Capabilities
None.

## Impact

Connection model/store/form, persisted connection schema, command and manager connection paths, package settings schema, tests, README, changelog and generated documentation.
The extension remains employer-neutral; it does not hardcode consumer names, provision users, modify .env files, auto-connect, share credentials with another extension, or change q transports and result formats.
Scope conflict handling, SecretStorage editing, active-profile identity, cancellation and notebook session continuity must survive.
A tested extension release/distribution step is a delivery dependency, and remains separate from publication authority.
