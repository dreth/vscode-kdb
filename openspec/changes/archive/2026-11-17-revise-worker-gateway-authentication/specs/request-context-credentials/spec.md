## Purpose

Carry optional credentials with individual q executions without requiring worker-login authentication or retaining passwords in server sessions.

## ADDED Requirements

### Requirement: Explicit optional request credentials
An explicit request mode SHALL connect to the worker anonymously and send no saved pair as worker-login credentials.
It SHALL resolve the current configured pair for each execution, preserving the existing canonical source and explicit-caller precedence.
Absent/incomplete request credentials SHALL permit local execution without credential context, with a non-secret configuration diagnostic and no legacy/shared-secret fallback.
Malformed, unreadable or untrusted configuration SHALL retain explicit safe configuration failures.
Default connection mode and unrelated profiles SHALL remain unchanged.

#### Scenario: Compute before receiving credentials
- **GIVEN** request mode and no saved pair
- **WHEN** the user connects and evaluates local q
- **THEN** local execution succeeds without a credential prompt or downstream authentication probe.

#### Scenario: Rotate the saved pair between executions
- **GIVEN** an existing request-mode worker connection and a changed local credential file
- **WHEN** another execution is requested
- **THEN** only that execution carries the new complete pair without reconnecting or registering it on the worker.

### Requirement: Typed secret-free execution protocol
Request mode SHALL verify the configured peer's protocol/version using a credential-free probe before sending credential-bearing frames.
Unsupported peers SHALL fail clearly without a silent fallback or disclosure of credentials to an unprepared execution handler.
The execution envelope SHALL carry version, operation kind, optional credentials and original typed q payload as distinct binary IPC arguments.
Credentials SHALL NOT be interpolated into q source or persisted in history, exports, diagnostics, saved outputs or error reports.
Connection testing SHALL report worker/protocol reachability without claiming that request credentials have been authenticated.

#### Scenario: Mismatched peer
- **GIVEN** request mode and a peer without the required handler/version
- **WHEN** the client tests or executes
- **THEN** it reports a compatibility error before sending the supplied pair and preserves unrelated active sessions.

#### Scenario: Execution and cancellation preserve secrets
- **GIVEN** a complete pair with literal supported special characters and an execution that succeeds, errors or is cancelled
- **WHEN** execution and result/error handling complete
- **THEN** the exact pair is sent only as request context and no automatically supplied secret reaches persisted query or diagnostic artifacts.

### Requirement: Execution surface parity
The request-mode policy SHALL apply consistently to editor, Results panel, q-only/mixed live notebooks and the Python companion.
Namespace, typed results, original source positions, timeout, cancellation/stale-response and exactly-once behavior SHALL remain compatible.
Saved notebook MIME/output SHALL remain readable without connecting, replaying or resolving credentials.

#### Scenario: Preserve notebook and editor behavior
- **GIVEN** the same request-mode profile
- **WHEN** editor and notebook actions execute or saved output is reopened
- **THEN** live executions use the same protocol and saved outputs remain offline and secret-free.
