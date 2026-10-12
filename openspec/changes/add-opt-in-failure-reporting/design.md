## Context

See `proposal.md` for motivation and `specs/opt-in-failure-reporting/spec.md` for the behavioral contract. This is an opt-in addition to a shared extension host, not an application-wide exception collector.

`src/diagnostics.ts` currently owns redacted local lifecycle events; `src/extension.ts` creates its KX Output channel and distributes the diagnostic instance. Some exceptions are handled directly by notebook runners, panel/integration code, and `src/q-language-client.ts`. The bundled language service logs bounded failure kinds in its own process. The notebook renderer already has optional host messaging; saved output can operate without it. `package.json` bundles the host, renderer, and language server separately using esbuild, and VSIX packaging uses `--no-dependencies`.

The existing working tree contains unrelated active work. Implementation must extend current boundaries without reverting those edits or weakening main specs and active deltas. Existing `test/run.js` coverage includes diagnostic redaction, connection races, q-language isolation, exactly-once notebook output, UI parity, and chart stale/reset behavior. Existing README/settings docs promise local redaction and offline language tooling. q Problems findings remain private under `q-diagnostics`.

## Goals / Non-Goals

**Goals:** Provide one safe event policy, two independent delivery adapters, and explicit KX producer ownership. Prioritize proving disabled-mode inactivity and isolated Sentry/GlitchTip delivery before broadening the producer coverage. Capture handled exceptions as soon as their KX operation fails, without waiting for network delivery.

**Non-Goals:** Global exception/console instrumentation, collection of VS Code's own failures, background environment scans, q source traceback extraction, user-data attachments, Python companion instrumentation, and server deployment/configuration.

## Decisions

### 1. Configuration is the sole activation source

Declare `diagnostics.reportServerUrl` and `diagnostics.sentryDsn` with `scope: machine`, string type, and empty defaults. Read effective authorized machine/user values with configuration inspection, excluding Workspace/Workspace Folder contributions even if malformed settings bypass VS Code UI validation. Document and test how local and remote User settings resolve for the executing extension host.

Use URL parsing, not string concatenation. The general receiver accepts full HTTP(S) URLs without userinfo or fragments; path/query strings stay private transport configuration. The DSN accepts the public-key username, a project ID and optional reverse-proxy prefix, without a secret/password or fragment. Empty/invalid values disable only their sink. Never inherit `SENTRY_DSN`, `SENTRY_RELEASE`, Spotlight configuration, or other SDK environment defaults. Settings descriptions state that configuration enables automatic diagnostic delivery.

A cheap configuration observer can exist while disabled. Actual SDK import/client construction, reporter context capture, failure forwarding listeners, and reporter retention cannot. Producer callbacks must return before inspecting/serializing an error or taking a resource snapshot if the service is inactive. Existing local diagnostics continue independently.

Alternative: an extra default-false enable switch. Rejected because the user's activation contract is destination configuration itself, and extra switches can silently prevent configured reporting.

### 2. One host-owned service and one host-neutral safe schema

Introduce a reporter service owned/disposed by extension activation and a host-neutral schema/sanitizer shared by producer bridges. Inject a no-throw observer into KX operation boundaries rather than uploading Output text or catching global process errors. Extend the existing diagnostic helper with an optional structured observer where useful; do not change its local formatting/redaction contract. The observer receives operation ownership and lazy context rather than arbitrary logs.

Create one immutable sanitized event per eligible failure, then fan out only to the sinks enabled when it occurred. Queue safe serialized records; never retain `Error` objects, q values, documents, connections, or closures containing query/source data. Use a weak identity check for errors seen across layers plus a bounded safe fingerprint cache (component, operation, error category and relative frame locations) to avoid duplicate reporting. Re-enablement never replays local history.

A v1 report has these stable sections:

| Section | Allowed contents |
| --- | --- |
| Identity | `schemaVersion: 1`, 32-hex event ID compatible with Sentry, ISO timestamp, ephemeral activation/session ID, KX release |
| Failure | Known component/surface/operation/phase identifiers; safe exception type/code/category; relative KX artifact frames with function/line/column; bounded sanitized cause classifications |
| Environment | VS Code version/UI kind, KX version/extension kind, available runtime versions, OS platform/release/architecture, remote kind, CPU count/total memory, process memory snapshot |
| Configuration | An explicit allowlist of relevant KX booleans/enums/numeric limits; no connection profiles, arbitrary strings, query history, destination URLs, or settings dump |
| Extensions | At most 200 installed extension IDs/versions in stable order; omitted count when inventory is larger; no installation paths or other extensions' settings/state/logs |
| Operation | Already-known transport phase/protocol, timeout/duration, execution kind, result shape/counts when already known, notebook MIME version and live/saved/retention mode; no column names, values, namespaces, endpoints, or document identity |
| Breadcrumbs | Up to 100 safe KX operation/lifecycle records and 64 KiB total; no raw Output channel, console stream, or source/result strings |
| Omissions | Stable missing/truncated-section markers and bounded drop counters |

Gather environment summaries on demand after a failure; cache only invariant safe version information while enabled. Process resource snapshots are taken per report, not polled. Do not enumerate directories, read notebooks, launch diagnostic commands, or issue q queries. Settings/extension inventory reads are bounded and fail independently with omission markers.

Alternative: attach an entire environment/log/settings dump. Rejected because it breaks current privacy promises and admits unbounded user data.

### 3. Use conservative structured exception capture

Reuse `redactDiagnosticText` and existing known-secret replacement as defense in depth, but construct remote data from approved fields. The existing local sanitizer alone is insufficient: arbitrary q error text and JS exception messages can contain user data without sensitive field names. Include message text only for audited templates or known standard error categories; otherwise emit a stable omission marker and retain the exception class, safe code, operation, and frames.

Parse bounded stacks without collecting source excerpts or locals. Preserve paths relative to known packaged KX artifacts (`out/extension.js`, `out/q-language-server.js`, renderer/panel artifacts) and line/column locations. Omit absolute path prefixes, document URLs, and foreign frames; treat function names/causes as bounded sanitized data. q errors retain standard allowlisted classifications where available; do not upload arbitrary q strings or source tracebacks. Non-Error thrown values are classified without stringifying their objects. Limit causes to three levels, frames to 50, detail depth/lengths, and serialized output to 256 KiB with explicit truncation markers.

Source maps are optional supplementary debugging artifacts, not an excuse to collect user source. Preserve release and generated frame coordinates so an operator can correlate the installed build. If existing/new packaging includes maps, validate them and document a separate project-scoped upload workflow; do not add automatic production uploads or a server token to the extension.

Alternative: `captureException(error)` with automatic SDK enrichment. Rejected because SDK processing may expose messages, paths, locals, or global scope data outside this schema.

### 4. Isolate the Sentry Node SDK

Lazily import the explicitly pinned `@sentry/node` and `@sentry/core` 10.76.1 releases only after valid DSN configuration. Construct a private subclass of the core `Client` and private current/isolation `Scope` instances, with no global `Sentry.init`, global scope mutation, or default integrations. Supply the Node SDK stack parser and reporter-owned transport explicitly. Use `captureEvent` with a pre-sanitized exception structure and the private scopes so GlitchTip receives an exception event rather than merely a log message. Override event preparation to bypass global scopes/processors and prevent SDK pipeline errors from being captured recursively. Do not initialize the standard Node client: real-SDK tests found it adds a process exit listener even with empty integrations; runtime-client capture also touches global request/session state. The pinned SDK requires Node 18 or newer, so the existing VS Code 1.101 minimum (Node 22.15.1) remains sufficient, with no maximum VS Code version cap.

Disable integrations that patch process exception/rejection handlers, console, HTTP/fetch, child processes, session tracking, context/source lines, modules or local variables. Do not initialize OpenTelemetry, tracing, profiling, logs, replay, Spotlight, or client-report tracking. Explicitly disable default PII, client-outcome reports and server hostname data; do not leave SDK environment-derived switches implicit. A final event sanitizer/`beforeSend` gate rechecks generation and removes any enrichment outside the safe schema. The integration must leave any other extension's Sentry client/scope/listeners unchanged.

GlitchTip's [Node SDK documentation](https://glitchtip.com/sdkdocs/node/) supports Sentry's Node SDK and identifies session tracking as unsupported. Sentry's [client source](https://github.com/getsentry/sentry-javascript/blob/develop/packages/node/src/sdk/client.ts) and [initialization source](https://github.com/getsentry/sentry-javascript/blob/develop/packages/node/src/sdk/index.ts) explain why constructing a private client and avoiding global initialization/default integrations is necessary here. SDK APIs change; implementation must check the exact pinned release, compile it against the supported VS Code runtime, and test its real wire envelopes and import-time side effects before accepting this design as verified.

Provide a reporter-owned cancellable SDK transport, or wrap the pinned SDK Node transport only after proving timeout, redirect, TLS, queue and generation properties. Sentry parsing determines the intended project ingestion URL, preserving a GlitchTip prefix. Transport sends only sanitized error envelopes to that destination; no sessions, transactions, client reports, attachments or implicit hosts. Reuse the host transport lifecycle instead of allowing an independent unbounded SDK queue.

Bundle the SDK into the packaged host build, preserving lazy module evaluation; the renderer and language-server bundles contain only schema/producer helpers. Verify VSIX `--no-dependencies` does not omit needed assets or dynamic imports. If lazy bundling introduces a separate chunk, include it explicitly and exercise packaged activation; do not leave a development-only `node_modules` dependency.

Alternative: normal Node SDK global initialization. Rejected because VS Code shares the process across extensions, so global integrations could capture VS Code/foreign failures and alter runtime behavior.

### 5. Capture at KX operation boundaries with explicit ownership

The reporter only accepts events from named KX boundaries or validated KX producer records. It never infers ownership from the shared extension-host process. A VS Code API rejecting a KX output commit is an observable KX operation failure; unrelated VS Code application errors are outside the collector.

| Producer | Eligible boundary and preserved behavior |
| --- | --- |
| Connection/query/editor execution | Central failed connect/handshake/query and unexpected conversion failures; outer UI handlers can add safe operation context without duplicate events; cancellation remains excluded |
| Notebook controller/mixed runner | Execution, exact encoding, output commit/verification failures; no extra q dispatch, changed output retry policy, focus movement or stale ownership |
| `.qnb` serialization | Unexpected KX encode/decode/resource exceptions without reading/attaching notebook content; intentional unsupported-file validation remains local |
| Results panel | KX data preparation/owned event callback failures and KX webview implementation exceptions; existing errors, chart request generations/reset and panel disposal remain authoritative |
| Live notebook renderer | KX render/callback failures with explicit producer/component attribution; current output ownership and live request generations still gate meaningful events |
| Saved notebook renderer | New renderer implementation exceptions only; historical q errors/invalid saved data are not replayed, no q queries or metadata/MIME rewrites |
| Language client/server | Host-observed startup/protocol failures and child implementation exceptions through a safe gated notification; ordinary diagnostics/source/ranges remain private and lexical/execution fallback survives |
| Local data server | Unexpected KX server lifecycle/handler exceptions; authentication failures, malformed client requests and unsupported inputs stay ordinary local validation outcomes |

Use bounded safe producer records with a reporting generation, producer instance ID, component/operation enum, exception category and relative frames. Extend existing renderer messaging and LSP notifications separately from notebook MIME/data contracts. Send only an enabled flag and generation to producers, never URLs/DSNs. Handshakes and enable/disable broadcasts allow already-open and newly created surfaces to follow current settings.

Producer forwarding is absent while disabled. Prefer explicit try/catch wrappers around owned render/command callbacks over window-wide listeners; do not subscribe to global browser/process failures shared with VS Code or Jupyter. The host validates schema, lengths, enums, generation and editor/panel/producer binding before accepting a record. No generic console/stderr harvesting. Sanitize within child/browser producers and again in the host. If a producer has no bridge, preserve rendering/fallback and drop reporting; optional messaging remains optional.

Alternative: a separate SDK in every webview and child. Rejected because it exposes destination details, duplicates policy/events and creates additional lifecycle/privacy boundaries.

### 6. Keep delivery bounded and revocable

Maintain independent sink generations/queues plus a shared capture generation for producer forwarding. Every SDK import, metadata snapshot, enqueue, scheduled send, producer message and final transport call verifies its generation. A newly configured sink gets only events created after its enablement. Replace/clear cancels old sink requests, discards its queue, resets its rate/dedup state and closes its client without flushing to an obsolete destination. Clearing the last sink also clears shared context/breadcrumbs and tells producers to detach forwarding.

Set one active request and 20 queued safe events per sink, five seconds per request, ten attempts per rolling minute and 60-second equivalent-failure suppression. Cap fingerprint entries at 200. Drop excess/duplicate events with bounded counters; never persist or retry. Maximal retained queue payload is consequently bounded by event count and the 256 KiB cap. JSON and Sentry ingestion use equivalent guardrails. Expose only bounded local status kinds (invalid config, unavailable sink, timeout, rejected, dropped), without URLs, response bodies or recursive reports. Reporting construction exceptions are swallowed at the diagnostics boundary.

JSON sends `POST` to the complete configured URL with `Content-Type: application/json`; 2xx is success and other statuses are dropped. HTTP(S) uses normal certificate verification, no redirects, no credential inheritance and no fallback destination. The general receiver contract is intentionally unauthenticated in this first version; an operator can use restricted/private ingress or request a later explicit authentication feature. Do not place bearer credentials in extension settings or URLs as a workaround.

Disposal first revokes all send guards and forwarding, then aborts owned requests and drops queues, and releases SDK/transport timers/resources. Avoid SDK close/flush behavior that initiates post-revocation sends; test against the pinned implementation. Bounded best-effort delivery cannot guarantee events during fatal host termination or after a request has already reached a server.

Alternative: persistent queue with retries. Rejected because it retains user diagnostics beyond the configured session and complicates immediate opt-out.

## Risks / Trade-offs

- **[Unexpected SDK side effects or packaging incompatibility]** → Prove isolated real-SDK initialization, disabled-mode import inactivity, no added global listeners/hooks, compatible Node runtime and packaged VSIX delivery before adding broad producers. Update the OpenSpec design if the pinned SDK cannot satisfy these contracts.
- **[Existing functional regressions]** → Add focused producer/observer tests alongside existing redaction/connection/notebook/renderer/language tests; preserve local outputs, exact MIME bytes, query counts, cancellation, reset/stale behavior and UI fallback. Run the full gate plus targeted host/cross-contract suites.
- **[Free-form messages disclose user data]** → Structured allowlists, known-template/category messages, bounded relative KX frames, secret replacement and a final wire-level sanitizer; assert literal sensitive fixture values are absent from both transports.
- **[Reduced diagnostic detail]** → Keep release/frame coordinates, error classifications, operation phase, safe settings/resource information and omission markers. Document that arbitrary q/Python source traces and process-fatal errors are outside scope.
- **[Duplicate/noisy reports]** → Explicit operation ownership, weak error identity, bounded safe fingerprints, rate limits, exclusion of normal cancellation/stale/validation/lint outcomes, and a tested per-surface matrix.
- **[Remote host differs from the user's desktop]** → Label execution kind and remote kind, use effective authorized settings, and describe where requests originate; omit remote authority/hostname identity.
- **[Host replacement races]** → Generation checks at every asynchronous boundary and in transport, with cancellation and no flush/replay to a new destination.
- **[Ingest server fails or is public]** → Short timeouts, no retries, strict limits, operator ingress controls and independent sinks. The extension performs no server deployment in this change.

## Migration Plan

1. Implement shared gating/sanitization and regression fixtures, then prove the isolated Sentry path and JSON transport using loopback fake receivers.
2. Integrate owned producers with the surface/lifecycle regression matrix; update package notices and docs, then run the required gates and packaged smoke check.
3. Ship empty defaults. Existing installations retain local behavior without migration, notebook rewriting, network collection, or a built-in DSN.
4. Operators can verify a configured destination with a synthetic KX-owned event from a designated test client; other installations remain off. Infrastructure details and organization-specific deployment instructions do not belong in this repository.
5. Clearing the destination settings rolls back remote collection immediately. Reverting the implementation leaves notebook/connection/settings data compatible because no saved-output schema was modified.
