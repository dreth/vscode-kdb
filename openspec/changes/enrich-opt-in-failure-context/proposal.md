## Why

The first retained DEV event proves reporting works, but useful context is too limited for diagnosing many real failures. The user wants substantially richer error data: explain what KX was doing, the state of that operation, the sequence leading to failure, and the conditions of the executing host.

## What Changes

- Expand the shared safe diagnostic schema with operation phase/status, elapsed and timeout timings, transport/protocol state, retry/cancellation/stale flags, result shape and notebook/output mode where already known. Cover editor/IPC, Results, live notebooks, saved renderers, qnb serialization, language service and local data server.
- Enrich KX-owned lifecycle breadcrumbs with bounded structured state and ephemeral operation correlation, keeping successful steps so failures have a preceding sequence.
- Collect more host/runtime and resource context on eligible failures: runtime-library versions, uptime, CPU/resource usage, free memory, V8 heap statistics and relevant safe settings. Include only information available to the executing host; unavailable facts are explicit omissions.
- Preserve safe standard error codes, audited message classifications and bounded cause-chain/frame context. Add reproducible packaged-build identification and a documented route to matching first-party source maps when available.
- Present common runtime/OS/resource information in standard Sentry contexts and searchable tags, with detailed KX context remaining available in both transports.
- Extend the actual-host and packaged smoke to exercise a synthetic owned operation sequence and verify that the intended DEV project retains the richer fields; retain empty defaults and restore temporary settings.

### Current behavior and preserved invariants

`add-opt-in-failure-reporting` remains the authoritative active baseline; its implementation is release `0.2.43` with isolated SDK `10.76.1` and VS Code minimum `1.101`. The verified DEV event contains 23 KX context fields, eight safe settings and 92 extension ID/version entries, but its synthetic operation context and breadcrumb sequence are empty. Host environment collection has a short allowlist; operation details accept only selected numeric/boolean fields, and breadcrumbs retain only component/operation/time.

Keep source/result/credential/path/personal-identity exclusions, explicit KX ownership, error-only envelopes, private scopes, disabled-mode inactivity, revocation/no-backfill, rate/dedup/size/time bounds, exactly-once q dispatch, cancellation/stale rules, language fallback and unchanged saved MIME bytes. Richer context must not issue q queries or inspect user files.

### Non-goals

Raw queries/notebooks/results, connection identities, arbitrary error/source strings, workspace scans, environment dumps, global listeners, sessions/transactions/replay/log telemetry, fleet-wide opt-in, additional server rollout, and fixing the pre-existing native column-width reset failure.

## Capabilities

### New Capabilities

- `rich-failure-diagnostics`: Structured operation history, broader safe host context, actionable classifications and packaged-build provenance layered on the active opt-in reporting contract.

### Modified Capabilities

None. The existing reporting capability is still an active delta rather than a synchronized main capability; this change explicitly preserves and extends that baseline without rewriting its intent/history.

## Impact

Shared schema/reporter/host collection in `src/failure-record.ts`, `src/failure-reporting.ts` and `src/failure-reporting-host.ts`; owned producer boundaries and renderer/language bridges; packaging metadata; reporting fixtures and documentation. JSON v1 gains additive fields; existing saved notebook formats and both destination settings retain their contracts. The existing DEV analytics project and verified DSN are reused for isolated acceptance, with no DEMO/LIVE configuration or administrative token in the extension repository.
