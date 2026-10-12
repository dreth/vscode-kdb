## 1. Contract and production

- [x] 1.1 Add strict v3 full columnar contract, shared lazy cell access, and large native q-table production; verify exact scalar/nested/key/attribute and malformed-schema regression cases, ordinary-size v2 compatibility, and resource-error reporting.

## 2. Consumers and lifecycle

- [x] 2.1 Adapt live/saved renderer, static fallbacks, messaging, exports/charts/panel handoff, and durable ownership to shared access; verify focused grid/action and stale/foreign/clear/close tests without weakening existing Results or sampling behavior.
- [x] 2.2 Verify 600,000 × 14 creation/save/reopen with every cell preserved under a constrained heap, no per-cell tree construction, both zero/positive routing policies, and actual container pipeline evidence.

## 3. Release

- [x] 3.1 Reconcile active compatibility specs, update documentation/changelog, and verify npm tests, companion/cross-contract/live-q gates, strict docs/spec validation, and audited local versioned VSIX/ZIP.
