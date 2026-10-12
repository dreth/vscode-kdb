# Verification

## Baseline

Before implementation, `npm test` passed on Node 24.16.0, including repository confidentiality fixtures, compilation, 54 focused groups, both notebook save/memory fixtures and language-server IPC smoke. Log: `/tmp/kdb-reporting-baseline.log`. The sandbox initially denied spawning fixture Git processes; the same gate succeeded outside the sandbox.

## Preserved contracts

Local KX diagnostics remain active and redact credentials, query/source, result values and tokens. Remote reporting is independent and inactive without authorized machine-scoped configuration. q execution counts, notebook exact MIME bytes/ownership/focus/cancellation/stale behavior, Results rendering/chart reset/sampling/copy/export, and language fallback remain authoritative across Results, live and saved notebooks. Existing unrelated working-tree edits are backed up in `/tmp/kdb-reporting-before/` and preserved.

## Implementation verification

Implemented for release `0.2.43`. Both destinations retain empty machine-scoped defaults; only authorized User/remote User values can enable reporting. The VS Code minimum remains `1.101`. The SDK dependencies are pinned to `@sentry/node` and `@sentry/core` `10.76.1`; capture uses the approved isolated core-base client with private scopes rather than global SDK initialization. The initial new reporting fixture failed with the missing reporting module before implementation.

### Completed checks

| Check | Outcome and evidence |
| --- | --- |
| `npm test` on Node 24.16.0 | Passed compilation, confidentiality checks, 54 existing groups, reporting/real-SDK/language fixtures, a second run of all 54 groups with a throwing reporting observer, both notebook memory fixtures, and language IPC smoke. `/tmp/kdb-reporting-full-test.log`. |
| `npm run test:failure-reporting` | Passed disabled-mode, schema/privacy, configuration generations, bounds, real SDK isolation, real HTTP delivery, child-language forwarding, and producer fault isolation. `/tmp/kdb-reporting-focused.log`. The final package rebuild compiled the subsequent Results message-boundary adjustment; final browser verification exercised it. |
| `npm run test:notebook-cross` | Passed shared notebook contract checks. `/tmp/kdb-reporting-cross.log`. |
| `npm run test:live-q` | Passed actual direct IPC with installed q 5 and complete-source cases with `.Q.ld` poisoned. This does not constitute an old-q runtime test. `/tmp/kdb-reporting-live-q.log`. |
| Chromium Results/notebook verification | Passed enabled/cleared forwarding, foreign browser-error exclusion, nested callback deduplication, delivery failure isolation, original exception preservation, chart/reset/null-gap behavior, saved v3/v4 grids and standalone symbol output. `/tmp/kdb-reporting-browser.log`; final screenshots/state evidence `/tmp/kx-results-display-X0l4B9`. |
| Actual VS Code 1.101 reporting host | Passed default-off, automatic JSON/Sentry ingestion, private sanitized frames and clearing each destination. `/tmp/kdb-reporting-minimum-host.log`. |
| Final extracted VSIX on VS Code 1.101 | Passed the same actual extension-host ingestion fixture using `/tmp/kdb-reporting-vsix/extension`, without development `node_modules`. `/tmp/kdb-reporting-packaged-host.log`. |
| `npm run package:vsix` | Passed bundle/VSIX confidentiality audits and packaging. `vscode-kdb-0.2.43.vsix`, 21 files, approximately 1.91 MB. SDK notices and dependency licenses are included. `/tmp/kdb-reporting-package.log`. |
| Strict MkDocs build, cleanup and Pages routing | Passed using the pinned docs requirements. A second normalized build reproduced all 63 generated files byte-for-byte, compared with `/tmp/kdb-reporting-docs-hashes.json`. `/tmp/kdb-reporting-docs.log`. |
| Standard HTTPS certificate validation | A controlled self-signed receiver was rejected with `DEPTH_ZERO_SELF_SIGNED_CERT`, including when the isolated test process had `NODE_TLS_REJECT_UNAUTHORIZED=0`; the reporter explicitly requires certificate validation. Temporary certificates stayed outside the repository. |

The HTTP fixtures cover full receiver paths/query strings, reverse-proxy DSN paths, shared event IDs, redirects without follow/retry, active cancellation, five-second timeout including a stalled successful response body, per-sink concurrency/queue/rate limits and independent destination replacement. Real SDK fixtures compare process listeners and foreign global/current/isolation clients, processors, sessions and last-event IDs before/after capture. Ambient Sentry DSN/release/environment/Spotlight values cannot override configuration or leak into events. Windows artifact paths containing spaces and parentheses retain only relative owned frames.

The host fixtures use temporary VS Code profiles and handled synthetic KX exceptions. The production extension does not expose the fixture API or read the live-smoke environment variable. Ordinary editor/notebook/language/server fixtures run with reporting unavailable and retain their established outcomes. No Python companion source was changed by this feature, so its conditional gate was not required.

### Known pre-existing full extension-host gate failure

`npm run test:extension-host` does **not** pass the complete native visual reopen gate. The save phase passes actual activation/store lifecycle, reporting ingestion, query connection selection, language commands, mixed notebook execution/save, ownership and stale-race assertions. The reopen phase times out waiting for the native saved-column double-click width reset. Current-build logs: `/tmp/kdb-reporting-extension-host.log` (VS Code 1.140) and `/tmp/kdb-reporting-extension-host-minimum-full.log` (VS Code 1.101).

The identical failure was reproduced using an isolated extension compiled from the exact pre-change source backup and the pre-change extension-host test fixture: `/tmp/kdb-reporting-baseline-extension-host.log`, build `/tmp/kdb-reporting-baseline-extension`. Pointer/geometry evidence suggests the click target changes position between the clicks, but the cause has not been established. Neither the existing assertion nor unrelated column/reset behavior was weakened. Focused browser reset regressions pass, but they do not replace this complete native UI gate. Task 6.1 stays unchecked, and the change remains unarchived.

### Scenario traceability

All 25 delta-spec scenarios were reviewed against the following evidence. These checks establish client behavior and loopback protocol compatibility; receipt by an operator's configured destination requires separate verification.

| Spec scenarios | Evidence |
| --- | --- |
| Default installation and failures; Either or both destinations; Workspace or environment attempts to opt in; Invalid setting | `test/failure-reporting.js`, `test/failure-reporting-sentry.js`, manifest assertions in `test/run.js`, actual host fixture. Disabled mode does not load the SDK or gather context; settings inspection excludes workspace values. |
| Enable after failures; Disable during initialization or delivery; Change hosts | Controlled delayed SDK/context/request fixtures, independent sink replacement, producer generations including previous activation rejection, actual host clear tests. |
| Handled execution failure; Partial information; Both sinks correlate a failure | JSON and decoded real-SDK loopback envelopes, bounded extension inventory, omissions/cause/stack truncation, identical JSON/Sentry event IDs. |
| Secrets nested in error context; q error includes user data; Local privacy continues | Wire-level sensitive fixtures, strict producer schema, foreign-frame/path/string rejection, nested/cyclic error handling, existing diagnostics/server confidentiality tests. |
| Results panel; Live notebook; Saved notebook; Renderer without reporting host | Existing execution/ownership/byte/focus/stale/cancellation groups and throwing-observer rerun; Chromium Results and saved/live renderer fixtures; actual host save assertions. Complete native reopen UI verification has the baseline failure described above. |
| Language-service failure versus lint finding; Foreign failure or malformed forwarded message | Real language IPC rejection/ordinary findings/disable fixtures, ownership and schema/generation bounds, Chromium foreign error fixture, SDK/process isolation checks. |
| GlitchTip exception ingestion; Shared extension host | Correct project/reverse-proxy error-only envelopes verified against loopback and inside actual VS Code 1.101, including the extracted VSIX; real-SDK foreign scope/client/session/listener preservation. Actual live GlitchTip receipt is not claimed. |
| Endpoint unavailable or rejects report; Failure storm and oversized context; Dispose | Stalled/failing/redirecting HTTP receivers, TLS rejection, fake-clock rate/dedup/queue bounds, unavailable SDK, active request revocation/disposal and throwing reporting observers. |
| Configure a receiver | Manifest-aligned README/settings/troubleshooting/architecture, versioned receiver example, strict reproducible docs build and generic synthetic ingestion smoke. |

### Review and remaining work

The implementation was compared with `/tmp/kdb-reporting-before/`; pre-existing edits to chart sampling, notebook contracts, Python companion, other active changes and unrelated files were preserved. Generated docs incorporate the existing source edits as well as this feature. `git diff --check` and `openspec validate add-opt-in-failure-reporting --strict` passed on 2026-10-07. Task 6.3 is complete; task 6.1 remains unchecked because of the full native UI gate above.

No external server was accessed or configured. The documented temporary-profile synthetic exception procedure requires matching the printed event ID in the configured GlitchTip project before claiming end-to-end success. An SDK event ID or completed delivery queue alone is not proof of receipt. Organization-specific infrastructure details and deployment instructions are excluded from this repository.
