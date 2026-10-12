## Why

KX currently reports failures locally, which makes intermittent user-environment bugs difficult to diagnose remotely. Add automatic diagnostic delivery and, as the priority integration, live exception reporting through the Sentry SDK to a user-configured GlitchTip or Sentry project, with no remote collection or delivery before configuration.

## What Changes

- Add independent, empty-by-default `vscode-kdb.diagnostics.reportServerUrl` and `vscode-kdb.diagnostics.sentryDsn` settings. Configuring a valid destination enables only that destination; removing it stops collection/delivery for that destination immediately. Destination settings are machine-scoped and cannot be supplied by a repository's workspace settings.
- Automatically send bounded, versioned JSON reports on KX failures to the report-server URL. The user selected **automatic reports only**; no manual bug-report command or preview/approval step is included.
- Integrate an isolated, lazily loaded Sentry Node SDK client for immediate exception delivery to a configured GlitchTip/Sentry DSN, without global extension-host instrumentation.
- Include useful diagnostic environment information: extension/VS Code/runtime/OS versions, remote execution mode, relevant non-secret KX settings, bounded installed-extension identifiers/versions, resource snapshots, safe operation context, and sanitized exception frames and lifecycle breadcrumbs. Preserve existing exclusions for credentials, query/source text, results, and local-data-server tokens.
- Cover KX-owned execution/transport, notebook encoding/output, Results panel/notebook renderer, language-server, and local-data-server failures through one host-owned reporting policy. Normal lint findings, cancellation, and intentional stale-result rejection are not failures to report.
- Capture only failures attributable to extension functionality; VS Code's own failures and unrelated extension failures are excluded. Add regression verification before enabling either reporting transport.
- Bound memory, payload sizes, queue lengths, timeouts, duplicate reports, and delivery frequency. Delivery failures must not affect q execution or recursively create more reports.
- Document the settings, collected fields, JSON receiver contract, GlitchTip setup, and coverage limitations.

### Existing behavior and regression risks

`src/diagnostics.ts` writes redacted connection/query lifecycle events to the local KX Output channel. README and settings documentation explicitly exclude credentials, query text, result values, and server tokens. `test/run.js` already tests those exclusions and the non-disruptive diagnostics boundary. These local diagnostics must continue even when both remote destinations are empty; the requested default-off behavior applies to the **new remote reporting machinery**.

Errors already preserve specific Results-panel messages, notebook output/ownership behavior, language-service fallback, exactly-once q execution, cancellation, and stale-response protection. Reporting must observe those boundaries without changing their outcome, awaiting a server, rerunning q, or modifying saved notebook MIME bytes. Remote diagnostics cannot simply upload the local Output channel, which may legitimately contain endpoint context unsuitable for remote reporting.

### Non-goals

- Implementing or deploying a diagnostic receiver, GlitchTip server, or hosted destination.
- Manual reports, usage analytics, performance tracing, session replay, profiling, global console/process hooks, persistent offline report spooling, or historical backfill.
- Uploading environment-variable dumps, connection profiles/credentials, q code or server-side q source tracebacks, result data, notebook contents, local filesystem paths, or other extensions' logs.
- Instrumenting the separately packaged Python companion or Python/Jupyter kernels; capturing arbitrary other-extension failures or guaranteeing reporting after a fatal extension-host crash.
- Changing q result presentation, chart sampling, notebook formats, or current active changes' display/lifecycle policies.

## Capabilities

### New Capabilities

- `opt-in-failure-reporting`: Configuration-gated automatic diagnostic reports and isolated Sentry/GlitchTip exception capture, shared sanitization, multi-surface failure ownership, and bounded delivery lifecycle.

### Modified Capabilities

None. Existing q diagnostic privacy/advisory requirements and result/notebook contracts remain authoritative; internal implementation exceptions can be reported without transmitting source or lint findings.

## Impact

- Settings/dependency/packaging declarations in `package.json` and `package-lock.json`; third-party notices; bundled `@sentry/node` support for the supported VS Code Node runtime.
- A new shared reporting service and host-neutral diagnostic schema/sanitizer; `src/extension.ts`, `src/diagnostics.ts`, connection/query handling, notebook/controller/integration/serialization paths, Results-panel messaging, and `src/q-language-client.ts`.
- Controlled, strictly validated failure forwarding from `renderer/index.ts`, Results webviews, and the bundled language-server process. Browsers and child processes never receive destination credentials or own network delivery.
- Focused deterministic reporting/redaction/transport tests, existing regression suites, Extension Host and notebook cross-contract checks, and receiver/GlitchTip smoke verification.
- README, CHANGELOG, `mkdocs-src/settings.md`, troubleshooting and architecture docs, and generated `docs/` through the documented build workflow. No main-spec synchronization or archive until implementation and verification finish.
