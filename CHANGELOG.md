# Changelog

All notable changes to KX for VS Code are documented here.

## Unreleased

## 0.1.5 - 2026-07-22

- Added an accessible **Test Connection** button to the real Add/Edit form. It validates current unsaved fields and effective timeouts, uses a fresh cancellable direct q IPC socket, proves handshake/namespace/minimal-response phases, closes reliably, and never saves or disturbs an active profile.
- Preserved password boundaries while testing: typed secrets stay in memory, blank edits may resolve a saved SecretStorage value only in the extension host, Clear tests without it, and status reveals only whether a saved secret was used. Generation and disposal guards suppress stale results without logging or reflecting credentials or request text.
- Fixed standalone chart **Reset zoom** by retaining the original full sample and an immutable X-domain baseline across manual zoom, auto/explicit refinement, and rerender. Reset now restores numeric or temporal X, returns Y to auto-scale, and clears selection, tooltip, and refinement timers. The same known SQLTools UI defect is intentionally deferred to a later compatibility backport.
- Added disabled-by-default `vscode-kdb.results.qText.syntaxHighlighting` and `vscode-kdb.results.qText.displayFormatting`. Highlighting is dependency-free, theme-aware, qText-only, and text-node safe; formatting is a conservative non-mutating view transform with exact raw fallback for malformed or ambiguous input. Open/reused panels receive live setting updates.
- Added focused model/host/webview/source tests for temporary connection-test success/failure/cancel/close/stale/secret behavior, chart baseline/epsilon/refine/rerender/reset behavior, and qText lexer ordering, HTML safety, disabled exact output, setting propagation, supported formatting, content preservation, and fallback.
- Used q Professional documentation as product inspiration only and inspected KX qlint integration as linting rather than a general qText pretty-printer. No q Professional, KX extension, vscode-q, or SQLTools code/assets were copied; no dependency or third-party notice was added.
- Kept 0.1.5 focused, direct-q-IPC-only, and unpublished from Marketplace. Deterministic and live q checks do not constitute visual Extension Host E2E or complete parity evidence.

## 0.1.4 - 2026-07-22

- Added a disabled-by-default, first-party **KX Server Explorer** for the active direct q IPC profile, including clear disconnected/reconnect status. Manual connected refresh lists current-namespace tables through `tables[]`, classifies names conservatively as variables or safely identified functions, and expands table columns through `meta` without eagerly fetching values.
- Added separately confirmed table/variable previews through the normal KX Results panel, strict standard-q-identifier validation, generation-stamped stale-item protection, clear permission/timeout/cancellation diagnostics, and a bounded `vscode-kdb.serverExplorer.previewCellLimit` setting. Functions/projections remain metadata-only because captured values are not honestly limitable.
- Added disabled-by-default, privacy-aware **KX Query History** backed only by local VS Code workspace extension storage. It records actually issued editor line/selection/script text with connection identity, time, kind, duration, and outcome, never result payloads, settings, sync data, telemetry, or passwords.
- Added newest-first history actions for same-pipeline rerun with active-connection mismatch confirmation, copy, editor insertion, single-entry deletion, and confirmed clearing, plus the bounded `vscode-kdb.queryHistory.maxEntries` setting.
- Added end-to-end feature controls so disabled features stop providers and history writes and hide their views and commands. Retained history is cleared explicitly rather than silently deleted when the feature is disabled.
- Added focused pure/source-contract and live-q coverage for metadata construction, identifier and namespace safety, preview limits, stale states, history privacy/order/limits/rerun behavior, feature gates, table metadata, and q errors.
- Audited the existing q grammar without changing it or adding a `.k` association; no reliable compatibility need justified either change.
- Reviewed q Professional documentation at `jshinonome/vscode-q` commit `1481ba419edee8e53be6bb4f6f134d1fb04f1ed1` as design inspiration only; its public snapshot is all-rights-reserved and no code or assets were copied. Inspected Apache-2.0 `KxSystems/kx-vscode` at `1c745bf0221dd3cca85dce925c4d432d80bb5ef5`, but adapted no code or assets. SQLTools remains absent as a runtime/UI dependency.
- Kept 0.1.4 focused and direct-q-IPC-only. Server exploration and query history improve standalone capability without claiming full KDB-X or q Professional parity; notebooks remain a later experimental design question, not a shipped checkbox.

## 0.1.3 - 2026-07-22

- Replaced sequential Add/Edit prompts with one responsive, theme-aware **KX Connection** form containing the direct q IPC endpoint, namespace, authentication, and collapsible advanced timeout controls.
- Added keyboard and screen-reader form behavior, extension-host payload validation, field-focused errors, password-safe edit semantics, and modal VS Code confirmation for deletion.
- Added optional per-connection `connectTimeoutMs` and `queryTimeoutMs` overrides plus the global `vscode-kdb.queryTimeoutMs` setting. Blank overrides inherit global defaults, `null` preserves legacy query-timeout inheritance, and `0` disables the relevant bounded deadline.
- Applied separate full timeout budgets to TCP connect and q IPC handshake, and an end-to-end query-response timer that starts when a query is sent and drops an uncertain timed-out client.
- Made connected profile edits deterministic: safe settings and requested SecretStorage changes persist first, then session-affecting edits disconnect and reconnect; a failed reconnect leaves the saved profile clearly disconnected.
- Extended focused coverage for form parsing, timeout resolution and bounds, password keep/replace/clear behavior, safe persistence/redaction, connection-update lifecycle, and source/webview/command guards.
- Kept the release direct-q-IPC-only with no SQLTools dependency or SSH/TLS/gateway placeholder controls. No visual Extension Host E2E or screenshot evidence is claimed.

## 0.1.2 - 2026-07-22

- Added redacted connection, handshake, query, cancellation, and close diagnostics in the dedicated `KX` Output channel, with opt-in safe performance timings.
- Added strict, reproducible MkDocs sources, committed normalized output, and a build-only Pages drift/artifact gate.
- Added `PARITY.md` as a source-backed roadmap and evidence ledger; this release does not claim complete functional or visual parity.
- Hardened direct q IPC connection lifecycle, q-error and namespace handling, redaction, state refresh, and regression coverage.

## 0.1.1 - 2026-07-22

- Replaced the standalone extension's prior Marketplace and Activity Bar branding with recolored, transparently padded assets derived from the official KX logo.
- Added KX logo source attribution and an independent-project trademark notice.
- Made no product functionality changes.

## 0.1.0 - 2026-07-21

- Added a standalone KX activity-bar container and **KX Connections** view.
- Added extension-owned direct q IPC connection management with global safe metadata and per-connection passwords in VS Code `SecretStorage`.
- Added add, edit, remove, activate, connect, disconnect, and test connection commands.
- Added minimal `.q` language support and exact selection, current-line, and full-script execution.
- Added configured q namespace execution without SQL parsing or session-file behavior.
- Added the KX result panel with columnar virtualized tables, q-text rendering, selection, copy, multi-format export, charting, and an opt-in loopback data endpoint.
- Added focused tests for q IPC, q text handling, connection and namespace helpers, result conversion, and standalone manifest/source guards, plus an optional live q IPC test.
- Added VSIX packaging and release-artifact exclusion rules.
- Shipped with no SQLTools dependency, API path, command ID, UI integration, or `.session.sql` behavior.

The standalone product remains direct IPC only. SSH, TLS termination, gateway/broker setup, remote administration, and notebooks are not included.
