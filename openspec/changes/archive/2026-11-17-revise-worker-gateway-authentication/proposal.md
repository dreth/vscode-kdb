## Why

Some q executors accept unauthenticated connections and require credentials only when an execution performs authenticated downstream work.
KX currently resolves required credentials before IPC and supplies them only during connection establishment; that cannot support request-scoped credentials without server session storage.

## What Changes

- Add an explicit generic request-credentials mode and configurable q execution handler, preserving connection-login mode as the default.
- In request mode, open the worker connection anonymously and resolve credentials for each execution; absent credentials permit local execution, while incomplete input has a secret-free diagnostic and no credential-context fallback.
- Send a versioned typed IPC envelope containing the credential context separately from the original q payload, never interpolating secrets into q source.
- Keep editor/Results, q-only and mixed notebooks, the notebook companion and temporary tests consistent; saved outputs and query history retain no resolved credentials.

## Capabilities

### Modified Capabilities

- `environment-backed-kx-credentials`: make required pre-IPC resolution and connection identity explicitly the preserved default mode.

### New Capabilities

- `request-context-credentials`: opt-in generic per-execution credential transport and lifecycle parity.

## Impact

Connection metadata/editor/validation, shared execution transport, notebook companion, tests, documentation and release notes.
Public configuration and planning remain employer-neutral, with generic q fixtures and no private consumer names, endpoints or port lists.
A matching external q executor and Python client must implement the same wire version; no private routing logic belongs in this repository.
No live executor is switched, no connection is silently migrated and no publication is performed by preparing this proposal.
