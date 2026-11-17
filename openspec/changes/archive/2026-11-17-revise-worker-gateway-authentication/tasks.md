## 1. Request contract and implementation

- [x] 1.1 Add regression coverage for anonymous local computation, per-execution credentials and preserved default mode before or with implementation.
- [x] 1.2 Implement the versioned typed request contract, credential-free compatibility probe and complete cleanup/error behavior; verify no automatic secret retention or diagnostic disclosure.

## 2. Compatibility and verification

- [x] 2.1 Verify supported execution surfaces, cancellation/error/rotation cases and preserved existing behavior with unit and disposable q integration tests.
- [x] 2.2 Update documentation, release compatibility and coordinated adoption instructions; run the relevant full project checks and strict OpenSpec validation.
- [x] 2.3 Keep artifacts aligned with verified implementation, prepare reviewable release/rollout material, and sync/archive only when all approved source/staging work is complete.

## 3. Public extension gate

- [x] 3.1 Run npm test and npm run test:notebook-python plus relevant live-q/cross-surface tests, build the reviewable VSIX candidate and verify employer-neutral artifacts and secret-free persisted outputs.
