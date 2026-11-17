## Context

See proposal.md for the selected scope and compatibility boundaries.
The existing connection path provides credentials at IPC login; the new opt-in mode attaches them to execution requests and requires a matching executor.

## Decisions

Use explicit `credentialTransport: request` and a configured `executionHandler`; the existing connection mode remains the default.
Request-mode IPC connects anonymously and runs a credential-free protocol/version probe before sending any credential-bearing execution frame.
An unsupported peer fails clearly instead of silently falling back to connection authentication or sending secrets to an unprepared handler.
Use a versioned typed IPC call containing the operation kind, optional complete credential pair and original payload.
Do not interpolate credentials into q source, URLs or query text.
The executor strips the envelope before the existing execution/history/trace chain, establishes context only for the current execution and drops all automatic references on every exit path.
Raw requests have no credential context; automatic forwarding cannot inherit a preceding or another active request's pair.
Each execution resolves the current configured client values, so a later credential-file change needs no worker reconnect or server registration.
No complete pair means local execution without credential context and an actionable non-secret diagnostic; malformed/untrusted/unreadable configuration still reports its existing configuration error.
Default connection-mode resolution, precedence and failure behavior remain unchanged.

## Risks / Trade-offs

This is a coordinated client/executor protocol change; an opt-in profile is usable only after matching versions and the documented cutover are ready.
No worker login or capability probe validates downstream credentials; only the actual downstream operation does so.
Errors, cancellation, async execution and reconnection must not retain or replay credential context.
Credentials exist transiently on the executing host; this is not a security sandbox against a compromised executor or hostile code running there.

## Migration Plan

Prepare and test compatible artifacts and explicit profile examples first, preserving the existing mode for current connections.
Keep active worker/configuration changes outside this source-preparation phase.
Document the matched-version cutover and rollback to the preceding client mode and worker inputs; no silent compatibility fallback is added.

## Shared extension lifecycle

Keep one transport/envelope policy shared by Results/editor execution and the notebook companion.
Preserve namespaces, original source positions, timeouts, result identity, exactly-once execution, cancellation/stale fences and saved MIME compatibility.
Connection tests report worker/protocol reachability without claiming request-credential validity.
Persist only generic mode/handler and existing credential references across add/edit/duplicate/export; no resolved values enter metadata, history or saved outputs.
Use generic fixtures, examples, endpoints and handler names throughout public source and planning.
No external consumer identities, private route selection or company-specific naming belong here.
