## 1. Persistence

- [x] 1.1 Remove the `.qnb` file-wide byte cap while preserving codec validation; verify a valid notebook larger than 16 MiB saves and reopens exactly and malformed input still fails.

## 2. Notebook scrolling

- [x] 2.1 Stabilize live table scrolling across virtual canvas and slice updates; verify vertical and horizontal offsets and corresponding rows remain stable in a focused regression.
- [x] 2.2 Update saved visible-row auto-fit widths without replacing the scrolling viewport; verify saved `.qnb`/`.ipynb` scroll and existing sizing controls with focused tests.

## 3. Documentation and integration

- [x] 3.1 Update the notebook guide, performance notes, changelog, and generated docs; verify strict MkDocs build succeeds.
- [x] 3.2 Run `npm test`, targeted notebook visual checks where a compatible runtime is available, and strict OpenSpec validation; record any environment-only visual limitation.

## 4. Large-save follow-up

- [x] 4.1 Write compact `.qnb` JSON and skip copying parsed output owned by the notebook serializer; verify exact large typed-table round trip, legacy indented-file compatibility, unchanged input, metadata sanitization, and generic codec normalization.
- [x] 4.2 Repeat the representative 60,000-row benchmark, update documentation and verification evidence, and run `npm test`, strict docs build, and strict OpenSpec validation.

## 5. Extension-host memory follow-up

- [x] 5.1 Emit compact Direct IPC MIME output and save validated JSON text without a second full typed-result object tree; preserve exact values, old MIME whitespace, generic codec normalization, metadata privacy, UTF-8/JSON/depth/key/MIME validation, and invalid-JSON behavior.
- [x] 5.2 Add safe save byte/timing diagnostics and focused regressions using realistic VS Code JSON formatting, a constrained heap, repeated saves, and exact save/reopen.
- [x] 5.3 Update documentation and verification with the observed container crash, run required gates, and build audited versioned VSIX/ZIP artifacts.

## 6. Live ownership validation follow-up

- [x] 6.1 Cache validated byte-output ownership without retaining the payload tree; preserve exact byte/mutation, strict metadata, duplicate claims, bounded scans, live-store scope, legacy/value-backed behavior, and close/dispose cleanup.
- [x] 6.2 Verify repeated live slices during saving without reparsing unchanged complete output, with focused fail-closed regressions and actual Dev Container handler/save evidence.
- [x] 6.3 Update documentation, run required release gates, and build audited VSIX/ZIP artifacts.
