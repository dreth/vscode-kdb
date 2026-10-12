## Purpose

Defines automatic, explicitly configured failure reporting for KX for VS Code, including diagnostic JSON receivers and Sentry-compatible GlitchTip projects, without collecting remote-reporting data before opt-in or weakening existing privacy and execution contracts.

## ADDED Requirements

### Requirement: Remote failure reporting is inactive until a destination is configured

The extension SHALL expose machine-scoped string settings `vscode-kdb.diagnostics.reportServerUrl` and `vscode-kdb.diagnostics.sentryDsn`, both defaulting to the empty string. A valid nonempty setting SHALL enable automatic reporting only to that destination. Workspace and Workspace Folder values SHALL NOT enable or redirect reporting. Empty, whitespace-only, invalid, or unsupported destinations SHALL remain disabled. The extension SHALL NOT use environment variables, built-in public hosts, or saved notebook metadata as implicit reporting configuration.

When neither destination is enabled, the extension SHALL NOT initialize a reporting SDK/client, collect reporting environment snapshots or breadcrumbs, retain failure events for later upload, install reporting listeners in renderers or the language server, or initiate reporting network activity. Existing local KX diagnostics SHALL continue under their established policy.

#### Scenario: Default installation and failures
- **WHEN** both settings are empty and a KX execution, notebook, renderer, or language-service operation fails
- **THEN** existing local messages and diagnostics remain available and no remote collection, SDK initialization, reporting buffer, reporting listener, or reporting request occurs

#### Scenario: Either or both destinations
- **WHEN** only the JSON URL, only the DSN, or both are validly configured
- **THEN** new eligible failures are automatically delivered only to the configured destination or destinations, without requiring a manual command or per-event prompt

#### Scenario: Workspace or environment attempts to opt in
- **WHEN** a repository sets a destination in workspace settings, a notebook contains a destination, or the process has `SENTRY_DSN` while the authorized machine-scoped DSN is empty
- **THEN** that value does not activate or redirect reporting

#### Scenario: Invalid setting
- **WHEN** a destination is malformed or uses an unsupported scheme
- **THEN** that destination stays disabled, the other valid destination remains independent, and a bounded local configuration notice excludes destination credentials

### Requirement: Configuration changes revoke collection and delivery without backfill

Reporting SHALL follow the current authorized destination configuration without requiring VS Code reload. Clearing or replacing a destination SHALL discard its pending events, invalidate old asynchronous initialization and send completions, and abort its in-flight requests where supported. Clearing the last destination SHALL clear shared reporting context and disable producer forwarding. An already received request cannot be recalled. Newly enabled or replacement destinations SHALL NOT receive historical buffered failures or events from an earlier configuration generation.

#### Scenario: Enable after failures
- **WHEN** KX failed while reporting was disabled and a user subsequently configures a destination
- **THEN** only failures occurring after enablement are eligible, with no replay of local logs or previous exceptions

#### Scenario: Disable during initialization or delivery
- **WHEN** a user clears the last destination while SDK loading, context gathering, forwarding, or network delivery is pending
- **THEN** no obsolete work can initialize a new client or begin another request, retained context is cleared, producer forwarding stops, and existing extension work continues

#### Scenario: Change hosts
- **WHEN** a user replaces one destination while events for its old configuration remain queued
- **THEN** old events are discarded instead of being delivered to either the replacement host or another sink

### Requirement: Reports contain useful versioned environment and failure context

Automatic JSON reports SHALL declare `schemaVersion: 1` and include an ephemeral event identity, timestamp, KX release, failure component/surface/operation, safe error classification and available sanitized stack frames, and a bounded environment snapshot. Both destinations SHALL apply the same field/privacy policy and expose a common event identity for correlation when both are enabled. Sentry-compatible exception events SHALL preserve available exception types, frame locations, and safe cause context for grouping and debugging.

Environment information SHALL cover VS Code and KX versions, available Node/Electron/browser runtime versions, OS platform/release/architecture, local versus remote execution kind without remote authority identifiers, relevant allowlisted non-secret KX settings, bounded installed-extension IDs/versions, process memory and host resource summaries, and safe already-known execution/transport metadata. Reports SHALL mark omitted/unavailable/truncated sections explicitly rather than fabricating data or claiming completeness. Gathering SHALL NOT execute additional q queries, inspect workspace/notebook files, or launch Python/system diagnostic commands.

#### Scenario: Handled execution failure
- **WHEN** a current KX-owned operation throws an exception with a stack and reporting is enabled
- **THEN** receivers obtain a versioned bounded report with the runtime/operation context and sanitized exception frames even though the extension handles the error locally

#### Scenario: Partial information
- **WHEN** a runtime field, q transport fact, or stack is unavailable, or an extension inventory exceeds the report bound
- **THEN** the report identifies missing or truncated information and does not probe q or read user files to fill the gap

#### Scenario: Both sinks correlate a failure
- **WHEN** both destinations accept one failure
- **THEN** the JSON report and Sentry-compatible event share its event identity and equivalent safe failure/environment context

### Requirement: Remote diagnostics preserve source and secret exclusions

Reports, forwarded failure messages, breadcrumbs, exception messages/causes/frames, and SDK-added fields SHALL exclude credentials, authorization headers, DSN keys, connection profile names/hosts/users, local-server tokens, query or document source, q traceback source lines, result values/column names, notebook contents/URIs, personal identifiers, absolute local paths, and arbitrary environment variables or settings dumps. Relative KX artifact locations and line/column numbers SHALL be retained where available; source snippets and local-variable values SHALL NOT be collected. Any ephemeral correlation identifiers SHALL NOT persist across extension activations.

The system SHALL construct remote reports from an allowlisted schema, preserve existing diagnostic redaction, and sanitize again before delivery. Arbitrary q error text or unstructured exception strings SHALL NOT be assumed safe because they lack a password label; approved error categories and structured frames SHALL remain available when message text must be omitted. Normal q Problems/lint findings SHALL NOT be transmitted. No user/source data SHALL be attached to a Sentry-compatible event automatically.

#### Scenario: Secrets nested in error context
- **WHEN** a failure contains credentials, a token-bearing URL, query text, result content, paths, nested causes, or circular/oversized details
- **THEN** neither destination, forwarding boundary, nor reporting-status log exposes those values, while bounded safe error classification and KX frame locations remain useful

#### Scenario: q error includes user data
- **WHEN** q returns an error string containing source, user-defined names, or data values
- **THEN** reporting retains the safe failure phase/category and available KX client frames while omitting the arbitrary q string and server-side source traceback

#### Scenario: Local privacy continues
- **WHEN** reporting is enabled or disabled
- **THEN** the existing local diagnostics still omit credentials, query/source text, result values, and local-data-server tokens, and source diagnostics remain advisory and private

### Requirement: Capture is limited to KX-owned failures across explicit surfaces

Reporting SHALL cover current, unexpected KX-owned transport/handshake/query failures, execution conversion and notebook encoding/output-commit exceptions, Results-panel and live/saved notebook renderer exceptions, language-service implementation/startup/protocol failures, and local-data-server failures observable at KX-owned boundaries. Handled exceptions SHALL remain eligible. Routine cancellation, superseded/stale requests, normal lint findings, unsupported inputs handled by intentional validation, and successful operations SHALL NOT create failure reports. One underlying failure SHALL produce at most one eligible event per destination within the deduplication window even if it crosses multiple KX layers.

VS Code's own application failures and unrelated extensions' failures SHALL NOT be captured. Eligibility SHALL require a KX-owned operation boundary or a validated KX producer record; being in the same extension-host process SHALL NOT imply ownership. A VS Code API rejection encountered during a KX-owned operation SHALL be attributed only to that KX operation and SHALL NOT authorize collecting unrelated VS Code exception traffic.

Browser surfaces and the bundled language server SHALL forward only strictly validated bounded safe failure records to the extension host while forwarding is enabled. They SHALL NOT receive reporting destination configuration, create independent reporting network clients, or capture other components' failures. A saved notebook's previous q error/output SHALL NOT be interpreted as a new failure merely because it is reopened.

#### Scenario: Results panel
- **WHEN** a current Results query or rendering operation fails
- **THEN** the existing panel error/cancellation behavior survives, eligible failures are reported once, and reporting does not change query execution, result identity, chart sampling, selection, or copy/export behavior

#### Scenario: Live notebook
- **WHEN** a live `.qnb` or Direct IPC `.ipynb` run encounters an eligible execution, encoding, commit, or renderer exception
- **THEN** its failure is reported once while existing inline output, ownership cleanup, exactly-once execution, focus/move rules, and stale/cancellation protections survive

#### Scenario: Saved notebook
- **WHEN** a saved notebook is reopened
- **THEN** stored errors are not replayed, saved MIME bytes and metadata are unchanged, and no q query is issued for reporting
- **AND** a new KX renderer implementation exception is eligible only when a connected enabled extension-host reporting bridge is available

#### Scenario: Renderer without reporting host
- **WHEN** renderer messaging is unavailable or host reporting is disabled
- **THEN** saved/live rendering and fallback behavior remain available without reporting collection or network delivery

#### Scenario: Language-service failure versus lint finding
- **WHEN** the bundled language service fails internally or to start
- **THEN** its observable safe exception or startup failure is eligible and lexical highlighting/q execution remain available
- **AND** ordinary syntax/lint findings and their source/ranges are not reported

#### Scenario: Foreign failure or malformed forwarded message
- **WHEN** VS Code itself or another extension fails, or a producer sends an unrecognized, oversized, stale, or invalid failure message
- **THEN** KX does not report that failure or let that message change destination configuration

### Requirement: Sentry-compatible delivery is isolated and error-only

Configuring the DSN SHALL deliver current KX exception events to that DSN's project using Sentry-compatible error ingestion supported by GlitchTip, including reverse-proxy path prefixes. The integration SHALL NOT replace another client's global state, install extension-host-wide exception/rejection/console/network instrumentation, change process exit behavior, enable session tracking, performance tracing/profiling/replay, or send usage/log/client-outcome telemetry. SDK environment defaults SHALL NOT override the authorized configuration.

#### Scenario: GlitchTip exception ingestion
- **WHEN** a valid GlitchTip project DSN is configured and a KX-owned handled exception occurs
- **THEN** a compatible exception event reaches that project with release, operation/environment tags, sanitized stack frames, and safe context, without session or transaction envelopes

#### Scenario: Shared extension host
- **WHEN** another extension uses its own Sentry client or the process has Sentry environment variables
- **THEN** KX reporting leaves that client's scope, process listeners, console, network hooks, and exit behavior unchanged

### Requirement: JSON delivery and both transports are bounded and non-disruptive

The JSON receiver SHALL receive an HTTP POST to the configured full URL with `Content-Type: application/json` and the versioned report; a 2xx response SHALL count as success. Supported destinations SHALL use HTTP or HTTPS, preserve configured reverse-proxy paths, and never disable TLS validation. General report URLs SHALL NOT contain embedded credentials. Reporting SHALL NOT follow redirects or deliver to an implicit fallback host. Public DSN key authentication SHALL be used only for its intended Sentry project request.

Delivery SHALL be asynchronous and SHALL NOT block normal extension operations. Each destination SHALL impose a five-second request timeout, a maximum of 20 pending events, one concurrent delivery, and at most 10 new event deliveries per rolling minute. Equivalent failures SHALL be suppressed for at least 60 seconds using bounded deduplication state. Each serialized JSON report or Sentry event SHALL fit within 256 KiB; reporting breadcrumbs SHALL have a total retained bound of 64 KiB and at most 100 entries. Reporting SHALL NOT persist events, retry failed deliveries, or report its own collection/transport/SDK failures recursively. Disposal SHALL cancel queued delivery and release reporter-owned resources.

#### Scenario: Endpoint unavailable or rejects report
- **WHEN** a destination stalls, rejects delivery, redirects, rate-limits, or has a certificate/SDK failure
- **THEN** delivery stops within its time bound, the event is dropped for that destination, a bounded credential-free local status is available, the other sink remains independent, and q/rendering/language operations retain their normal outcome

#### Scenario: Failure storm and oversized context
- **WHEN** failures repeat rapidly or a report/context exceeds its bounds
- **THEN** duplicates and excess events are dropped, context is safely reduced with truncation markers, retained memory stays bounded, and normal extension work remains responsive

#### Scenario: Dispose
- **WHEN** the extension deactivates or the reporting service is disposed
- **THEN** queued events, forwarding, timers, and owned requests are released without persistent spooling or prolonged shutdown

### Requirement: Settings and reporting limits are documented

Documentation SHALL describe empty defaults, independent automatic opt-ins, effective machine/remote settings, collected/excluded fields, the receiver request schema, GlitchTip/Sentry DSN setup, delivery bounds, and coverage limits including unavailable q/Python/foreign-extension/fatal-process traces. Documentation SHALL explain that collecting remote reports is inactive by default while existing local KX diagnostics remain active.

#### Scenario: Configure a receiver
- **WHEN** a user follows the settings/troubleshooting documentation
- **THEN** they can configure either destination independently, understand what is sent and from which extension-host environment, and disable it by clearing its setting
