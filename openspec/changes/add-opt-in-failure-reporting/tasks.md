## 1. Baseline and focused regression fixtures

- [x] 1.1 Re-read affected implementation/tests/docs, main specs and active deltas; record preserved local diagnostics, execution, Results/live/saved notebook, cancellation/stale/reset and language fallback contracts in verification notes, and record the existing `npm test` outcome before changes.
- [x] 1.2 Add deterministic reporter fixtures for disabled-mode inactivity, independent sink activation, invalid/machine-versus-workspace settings, no environment-derived opt-in, and no historical backfill; verify they fail until the required gating exists.
- [x] 1.3 Add wire-level sensitive-data fixtures covering nested causes, arbitrary q/error strings, tokens/credentials/DSNs, query/results, paths/URIs, cyclic/deep details and foreign frames; verify both destination payloads and reporter-status logs exclude literal fixture values while retaining useful KX frames.
- [x] 1.4 Add explicit VS Code/foreign-extension failure exclusion and existing-Sentry-client isolation fixtures; verify collection requires a KX operation/producer and never installs global process/console/network/browser error hooks.

## 2. Shared configuration, schema and lifecycle

- [x] 2.1 Add both empty-default machine-scoped settings and an authorized configuration resolver; verify the gating fixtures, local/remote effective-setting behavior, independent invalid-setting handling, and settings schema declarations.
- [x] 2.2 Implement the host-neutral v1 safe-event schema, conservative exception classification/relative-frame sanitization and safe lazy environment snapshots; verify redaction fixtures, missing/truncated information, extension-inventory bounds and absence of q/file/system-command probing.
- [x] 2.3 Implement host-owned capture, bounded safe breadcrumbs/fingerprints, per-sink generations, event fan-out and shared ephemeral IDs; verify error deduplication, same identity across sinks, zero disabled-mode retention and no raw errors/documents/q values in queues.
- [x] 2.4 Implement enable/change/clear/dispose handling, cancellation and stale async guards; verify delayed SDK initialization/context capture/producer messages/transport sends cannot reactivate disabled reporting, flush an obsolete destination, or backfill a newly enabled sink.

## 3. Isolated Sentry and JSON delivery

- [x] 3.1 Pin supported `@sentry/node` and `@sentry/core` 10.76.1 releases, update lockfile/notices, and implement lazy core-base-client/private-current-and-isolation-scope exception capture with private event preparation and no recursive SDK error capture; verify real-SDK import/setup against supported VS Code Node, no global state/listener/foreign-processor/session changes, no SDK environment overrides, and no sessions/tracing/logs/metrics/outcome/PII enrichment.
- [x] 3.2 Implement a cancellable generation-gated Sentry transport and the 256 KiB final-event policy; verify decoded loopback envelopes contain only sanitized exception events, correct release/frames/context/event IDs, the intended project DSN and reverse-proxy prefix, and no forbidden envelope items or redirects.
- [x] 3.3 Implement JSON POST to the complete report-server URL with the documented v1 body; verify request path/query handling, content type, 2xx success, independent sinks, standard TLS validation and rejection of userinfo/unsupported URL schemes.
- [x] 3.4 Add bounded per-sink queue/concurrency, five-second timeout, ten-attempt rolling-minute limit, 60-second deduplication and no-retry delivery; verify with a controlled clock and failing/stalled/redirecting/rate-limited receivers that limits hold and reporter failures never recurse or alter operation outcomes.
- [x] 3.5 Integrate lazy SDK packaging with the host esbuild/VSIX workflow; verify the packaged extension works without development `node_modules`, both empty settings avoid SDK evaluation, and renderer/language bundles do not contain destination SDK clients or credentials.

## 4. KX-owned producer integration and surface regressions

- [x] 4.1 Extend shared diagnostics/connection and editor execution boundaries with no-throw owned failure observers; verify existing local redaction/error messages and connection-race tests, failure-once semantics, successful execution/query counts, cancellation exclusions and endpoint omission remotely.
- [x] 4.2 Integrate dedicated `.qnb` and mixed Direct IPC notebook execution/encoding/output-commit failures; verify native/mixed output, exactly-once q dispatch, bounded local commit retry, ownership cleanup, focus/move rules and stale/cancel behavior with reporting disabled, enabled and unavailable.
- [x] 4.3 Integrate unexpected `.qnb` serialization/resource failures; verify intentional malformed/unsupported input validation stays local, valid saved MIME bytes remain unchanged and existing large-output/memory tests pass without reporter retention of notebook data.
- [x] 4.4 Add gated safe producer handshake/messages and owned callback guards for KX Results webviews; verify host schema/generation/producer binding, no direct renderer network client, foreign-error exclusion and existing grid/chart reset/refinement/copy/export behavior under delivery failure.
- [x] 4.5 Integrate the optional notebook renderer bridge for live and saved outputs; verify new KX renderer exceptions are forwarded only while enabled, absent messaging still renders, stale/oversized/forged messages are rejected, and saved reopen causes neither historical-error replay nor q queries/MIME metadata changes.
- [x] 4.6 Integrate q-language client startup/protocol failures and gated bounded child implementation-failure notifications; verify no stderr/global-error harvesting, no source/lint finding transmission, lazy disabled behavior, current analysis/version gates and lexical/q-execution fallback.
- [x] 4.7 Integrate unexpected KX local-data-server lifecycle/handler failures; verify existing bind/auth/request/export behavior and token redaction, ordinary invalid/unauthorized requests remain local, and failed reporter delivery leaves server behavior unchanged.

## 5. User documentation and ingestion smoke procedure

- [x] 5.1 Update README/CHANGELOG and `mkdocs-src/` settings, troubleshooting and architecture content with activation, field exclusions/limits, receiver v1 example, remote-host semantics and GlitchTip setup; verify settings names/defaults match the manifest and all source examples parse.
- [x] 5.2 Regenerate `docs/` through the pinned strict MkDocs build and cleanup workflow; verify generated output matches the updated sources and the documented Pages gate.
- [x] 5.3 Provide a generic loopback/synthetic KX-owned ingestion smoke procedure with actual implemented release/settings/verification paths; exclude VS Code/foreign failures and do not claim server ingestion before evidence exists. Keep organization-specific infrastructure details and deployment instructions out of the repository.

## 6. Integration verification and completion

- [ ] 6.1 Run `npm test`, `npm run test:notebook-cross`, and `npm run test:extension-host`; record exact outcomes and confirm Results/live/saved notebook parity, local diagnostic privacy and no functional regression before marking implementation complete.
- [x] 6.2 Run the packaged-extension smoke check and relevant Results/notebook browser verification; verify default-off activation, actual handled exception delivery, no foreign/global capture and no feature failure when receivers are offline. Run `npm run test:live-q` when a q runtime is available and record availability/outcome; run the Python companion gate if its code changed.
- [x] 6.3 Review verification notes against every spec scenario, run `openspec validate add-opt-in-failure-reporting --strict`, and keep remaining unverified tasks unchecked; confirm no unrelated working-tree changes were reverted and documentation distinguishes client verification from server receipt. Archive only after implementation and verification are complete through the archive workflow.
