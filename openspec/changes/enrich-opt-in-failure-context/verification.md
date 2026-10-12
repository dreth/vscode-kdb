# Rich opt-in failure context verification — 2026-10-07

## Requested change and preserved baseline

The approved change enriches already eligible KX failures with typed operation state/history, lazy resource/runtime/settings facts, safe classification/causes, standard receiver contexts and reproducible packaged-build identity. The original sparse fixture failed the new `operation.surface` assertion before implementation. The inspected baseline and preserved contracts are recorded in proposal/design; pre-edit reporter/schema/host/package/diagnostics copies are in `/tmp/vscode-kdb-rich-baseline/`.

The active `add-opt-in-failure-reporting` specification remains authoritative: release 0.2.43, SDK 10.76.1 and VS Code ^1.101.0; both distributed destination defaults remain empty. Shared-host SDK isolation, source/result/credential/identity/path exclusions, exactly-once dispatch, stale/cancellation handling, complete output bytes, saved reopen and existing fallback outcomes were retained. Unrelated in-progress work was preserved. No q/workspace/socket probes, global error listeners, background resource poller, SDK environment opt-in, or normal production smoke API was added.

## Implementation and deterministic gates

The shared schema accepts approved enums, finite bounded numbers, booleans and ephemeral operation tokens. Unknown/mistyped/oversized/stale/foreign records remain rejected. The host gathers independent process/OS/V8 measurements only for an eligible current failure; unavailable APIs carry explicit markers. Settings are individually audited against the manifest; resolved dependency versions come from generated packaged metadata. Both JSON v1 and the Sentry event retain equivalent details. Primary failure/frames survive deterministic optional-context reduction under 256 KiB; history remains at most 100 entries/64 KiB and clears when disabled.

| Check | Result/evidence |
| --- | --- |
| Focused rich schema/privacy/bounds/build fixtures | Passed; false/zero preserved, missing fields omitted/marked, hostile enums/nested keys rejected, sensitive values absent, collector revocation blocks delivery, unavailable API does not discard other facts, oversized optional inventory reduced, primary frames retained and corrupted build identity rejected. |
| `npm run test:failure-reporting` | Passed SDK/HTTP/ownership/privacy/outage/child-language tests and 54 producer fault-isolation groups; `/tmp/vscode-kdb-rich-focused.log`. |
| `npm test` | Passed all core, notebook memory, language and reporting groups; `/tmp/vscode-kdb-rich-full-test.log`. |
| `npm run test:notebook-cross` | Passed released Python helper interoperability; `/tmp/vscode-kdb-rich-cross.log`. |
| `npm run test:results-display-browser` | Passed Results/live/saved renderer privacy, clearing, original exception, grid/actions/chart/null-gap regressions; `/tmp/vscode-kdb-rich-browser.log`. |
| `VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q` | Passed installed local q 5 direct IPC and complete-source fixtures with `.Q.ld` poisoned; `/tmp/vscode-kdb-rich-live-q.log`. This is not an older-q runtime check. |
| `npm run test:failure-reporting-host` | Passed actual VS Code 1.101 / Node 22.15.1 JSON and real SDK ingestion in a temporary profile, enriched context/history/causes, private frames and clearing; `/tmp/vscode-kdb-rich-host.log`. |
| `npm run package:vsix` | Passed compile/prepublish/confidentiality/VSIX audits; `/tmp/vscode-kdb-rich-package.log`. |
| Extracted VSIX build provenance and wrapper auditor | Passed exact three-bundle SHA-256/release/library metadata checks and one-member wrapper byte identity. The auditor permits only the existing Sentry notice within `third-party/`; it rejects extra notice files and mismatched build metadata. |
| Strict generated documentation | Passed pinned MkDocs build, normalizer and repeated byte-for-byte comparison of 63 files; `/tmp/vscode-kdb-rich-docs.log`, `/tmp/vscode-kdb-rich-docs-repeat.log`. |

The exact tested packaged build ID is `f8df9a084d3f36efbbd15e735c7588e8636416d591045545e6a7073fe01a56e9`. The metadata contains artifact hashes and resolved versions, with no timestamps, git identity, absolute paths or workspace contents. No source maps exist in this distributed build or were uploaded; documentation explains matching-artifact and supported server-workflow checks before any separately authorized upload.

## Native UI gate retained separately

The full native VS Code 1.101 gate was rerun (`/tmp/vscode-kdb-rich-native.log`). Save assertions passed activation/store lifecycle, active query target, language commands, durable mixed notebook reopen, stale protections, repeated identities and actual save/tab close. Reopen again failed at the same native saved-column double-click width-reset assertion. The exact pre-change reproduction remains `/tmp/kdb-reporting-baseline-extension-host.log`, documented in the original reporting verification. No assertion or column behavior was weakened. Original change task 6.1 remains unchecked; neither change is archived while that dependent baseline gate is unresolved.

## Packaged retained-event acceptance

The synthetic handled smoke ran from `/tmp/vscode-kdb-rich-vsix/extension` in an isolated VS Code 1.101 profile, against the separately authorized existing DEV project only. It emitted one event after an explicit synthetic owned operation sequence and nested network cause, without executing q or using a user's notebook/source. Queue completion was followed by a server-side read lookup: the printed event ID matched the intended project, release and exact packaged build.

Operator evidence and the protected DSN handoff are recorded in the private analytics repository's `deploy/glitchtip/VSCODE-KDB-VERIFICATION.md`. The retained event has four correlated breadcrumbs, 35 KX context fields, 50 audited settings, 92 extension IDs/versions, two owned relative frames, runtime/OS sections, process/resource/V8/library details, structured operation state and both exception classifications. Sensitive fixture strings, arbitrary exception text, populated user fields and ingestion errors are absent. Loopback real-SDK envelope assertions establish error-only traffic and shared-host isolation; the retained event contains exception/breadcrumb entries only. No other server environment was configured. Temporary User settings were restored; clearing is asserted to prevent subsequent capture and the runner removes its temporary profile. No destination is enabled in the distributed extension.

## Scenario audit and workflow state

All rich-diagnostics scenarios were reviewed against typed/wire fixtures, real child-language/producer fault isolation, browser/live-q/actual-host gates, build integrity and retained packaged-event inspection. Unknown/foreign errors stay ineligible; saved outputs neither replay historical errors nor issue q for reporting; disabled/cleared generations retain no history or delivery; optional unavailable context remains explicit. The pre-existing native reset failure is a preserved non-goal, not a passed gate. This extension change remains reviewable in the working tree with the original reporting change; server changes alone are committed/pushed as requested.
