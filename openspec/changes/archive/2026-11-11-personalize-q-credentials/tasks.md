## 1. Credential model and resolver

- [x] 1.1 Add regression tests for explicit references, file-over-process precedence, blank/missing/file failures, literal special characters, untrusted and multi-root paths, stale SecretStorage and unchanged legacy precedence; verify all failures occur before IPC and disclose no values.
- [x] 1.2 Implement the optional connection fields and shared ephemeral resolver, including schema/form/normalization/persistence/duplicate/scope fingerprints; verify label changes retain references, scope moves retain or explicitly replace file bindings and resolved values never enter settings or SecretStorage.

## 2. Connection lifecycle integration

- [x] 2.1 Route live/lazy/reconnect and temporary connection tests through the resolver; verify editor/Results/qnb/mixed notebook parity, current-file reads for new sessions, retained active sessions, no automatic replay and existing test cancellation/stale-result fencing.
- [x] 2.2 Run `npm test` and the affected extension-host connection suites with synthetic users, including save/reopen of notebook output and secret-free diagnostics/exports; verify no runtime-library or Python companion contract change is required.

## 3. Documentation and coordinated delivery

- [x] 3.1 Update README, changelog, package settings descriptions and mkdocs sources; regenerate documentation through the documented workflow and verify examples use only placeholder values and explicit `KX_` variable names; review the complete public diff, including planning artifacts, to ensure it contains no employer names, internal repository references or private endpoints.
- [x] 3.2 Prepare a versioned compatible extension build and record the consumer release dependency without publishing; run strict OpenSpec validation, synchronize specs and archive after all specified regression checks pass.
