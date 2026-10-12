## Purpose

Provide enough structured KX operation and host context to diagnose reported failures while preserving the active opt-in reporting contract and existing editor, Results and notebook behavior.

## ADDED Requirements

### Requirement: Eligible failures carry structured operation state and history

Reports SHALL include available, already-known operation surface, phase, status, elapsed/timeout timings, transport kind and protocol version, attempt count, execution/output mode, result shape counts, and cancellation/stale/connection/readiness state using approved enums, booleans and finite bounded numbers. Events and breadcrumbs SHALL use ephemeral activation-local operation identifiers for correlation without exposing connection, query, document or result identity. Missing fields SHALL be explicitly distinguished from false or zero.

The enabled reporter SHALL retain up to 100 KX-owned lifecycle breadcrumbs and 64 KiB total, including success/start/failed phase information and safe structured details. It SHALL never issue q queries, inspect user files or probe arbitrary sockets to fill gaps. Clearing the last destination SHALL remove this history; re-enabling SHALL never replay it.

#### Scenario: IPC failure after a successful handshake
- **WHEN** an enabled KX query fails after a known connection/handshake sequence
- **THEN** the report identifies its phase, known protocol/timings/state and correlated preceding lifecycle steps
- **AND** no endpoint, connection label, source text or returned data is included

#### Scenario: Results panel and live notebook parity
- **WHEN** equivalent owned execution, encoding, commit or rendering operations fail in Results or a live notebook
- **THEN** each report identifies its own surface and available safe state using the same schema
- **AND** exactly-once execution, output ownership, cancellation/stale rules and visible outcomes remain unchanged

#### Scenario: Saved output reopened
- **WHEN** saved output is reopened without a new owned implementation exception
- **THEN** no report or historical operation replay occurs, no q query is dispatched and persisted MIME bytes/metadata remain unchanged
- **AND** a new renderer exception uses only its available rendering state through a connected enabled host bridge

### Requirement: Diagnostic context describes the executing host and packaged build

Eligible reports SHALL include available allowlisted runtime-library versions, extension-host/process uptime, CPU/resource usage, free/total memory, process memory and V8 heap summaries, executing-host UI/remote kind, and relevant non-secret KX settings. Settings SHALL be individually allowlisted booleans, enums and bounded numeric values; raw configuration and arbitrary strings SHALL remain excluded. Existing bounded extension ID/version inventory SHALL remain available.

Reports SHALL identify the packaged KX build using release and reproducible artifact identifiers without absolute paths or repository/workspace contents. Standard Sentry runtime/OS contexts and searchable safe tags SHALL expose common versions and operation/surface identity; equivalent detailed context SHALL remain in JSON v1 and the KX context. Unavailable or truncated sections SHALL carry explicit markers.

#### Scenario: Rich host snapshot
- **WHEN** an eligible failure occurs while a valid destination is configured
- **THEN** available host/runtime/resource/settings/build fields are captured on demand and retained by the receiver
- **AND** no persistent monitor, command execution, workspace scan or environment-variable dump is introduced

#### Scenario: Remote or constrained host
- **WHEN** the extension executes remotely or a host API/field is unavailable
- **THEN** the report describes the executing host and marks unavailable information without inventing local-client details or collecting remote authority/host identity

### Requirement: Failure classification preserves actionable safe detail

Eligible reports SHALL preserve standard error class/code/category, audited non-data message classifications, bounded cause relationships and owned frame function/line/column information within existing exception/frame bounds. Arbitrary q/source messages, foreign frames, source snippets, locals, query/result values, credentials, document identities, personal identifiers and absolute paths SHALL remain excluded. Matching first-party debugging artifacts SHALL be tied to the actual packaged build; artifacts or source maps SHALL never be invented or automatically uploaded with administrative credentials.

#### Scenario: Detailed cause without user data
- **WHEN** a wrapped KX failure contains a recognized system code, safe classification and owned cause frames alongside sensitive fixture strings
- **THEN** both transports preserve the useful classification/causal context and exclude every sensitive fixture value

#### Scenario: Unknown or foreign exception
- **WHEN** error text is unaudited or the failure belongs to VS Code/another extension
- **THEN** unaudited text remains omitted and foreign failures remain ineligible, without global process/browser/console/network listeners

### Requirement: Richer reporting preserves bounded delivery and disabled behavior

Both destination defaults SHALL remain empty and only effective authorized User/Remote User configuration SHALL enable reporting. Disabled mode SHALL initialize no SDK/context collector, retain no breadcrumbs and send nothing. Existing private scopes, error-only envelopes, TLS checks, no redirects/retries, per-destination rate/dedup/queue/time limits and generation revocation SHALL remain unchanged. Richer events SHALL fit within 256 KiB by deterministic reduction of optional context with omission markers, preserving primary failure identity/classification and safe owned frames.

#### Scenario: Oversized optional context and receiver outage
- **WHEN** richer optional context exceeds bounds or a receiver is unavailable
- **THEN** optional fields are bounded/marked and delivery failure leaves execution, notebook output, Results and language behavior unchanged

#### Scenario: Disable with work in flight
- **WHEN** the last destination is cleared during rich-context collection or delivery
- **THEN** stale work cannot initialize or send, retained context is released and no event is backfilled after re-enablement

### Requirement: Packaged acceptance demonstrates retained rich context

Verification SHALL exercise a synthetic handled KX operation sequence in a compatible actual VS Code host with the packaged extension, not only a standalone transport. DEV acceptance SHALL match the printed event ID in the existing dedicated DEV project and inspect release/build, safe context, breadcrumbs, classification and frames. Temporary User settings SHALL be restored, and normal production activation SHALL expose no smoke API or DSN environment-variable opt-in.

#### Scenario: Actual enriched extension event
- **WHEN** the operator invokes the isolated synthetic sequence with the verified DEV DSN
- **THEN** its event ID is confirmed in DEV with the specified safe diagnostic sections and no session/transaction/log envelope traffic
- **AND** unrelated server environments and ordinary User settings remain unchanged
