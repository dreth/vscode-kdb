# Changelog

All notable changes to KX for VS Code are documented here.

## Unreleased

## 0.2.5 - 2026-07-24

- Added **Run q Cell (KX)** for mixed Python/q Jupyter notebooks. A q-language cell can execute its complete source through the active KX connection, process, and namespace while the normal Python controller remains selected; Python and Markdown cells are never rewritten or rerouted.
- Kept the q-only path native: selecting **KX q (Direct IPC)** still owns ordinary Run Cell, Run All, and `Ctrl+Enter`. The mixed runner reuses the same direct-q query, session, namespace, live-result, bounded-snapshot, timeout, cancellation, sanitization, and routing core instead of maintaining a second behavior path.
- Recorded the supported mixed-output boundary: an unselected KX controller cannot own native cell execution, so **Run q Cell (KX)** retains old output while q runs and commits the finished result as one undoable notebook edit. The edit marks the notebook dirty, preserves q source/language/metadata and all sibling cells, clears stale native execution-summary state, rebinds the live result to the replacement cell, and refuses to overwrite a cell/output changed during the run.
- Added the q-cell toolbar/context/Command Palette action, `KX • <active connection> • <namespace>` status, actionable missing-connection output, and a guarded `Ctrl+Enter` / `Cmd+Enter` binding only while a q notebook-cell editor has text focus and the direct controller is not selected. Python, Markdown, cell-container, output, and ordinary editor shortcuts remain untouched.
- Consolidated notebook output around KX Results vocabulary: compact **KX Results** and **Settings** header actions, Search with accessible `Enter` / `Shift+Enter` match navigation, and a selection-only **Tools** menu with one format selector and one working Copy action. Removed inert Reset Size, default Previous/Next Match clutter, duplicate disabled Copy TSV/CSV buttons, and placeholders.
- Restored the real chart configuration model inline: line, scatter, step, bar, box, and candlestick; explicit X; multiple Y series; conditional Group By; and validated Open/High/Low/Close selectors. Removed the notebook-only visible Point cap while retaining shared source/sampling guardrails and status reporting.
- Made chart configuration explicit: changing selectors preserves the previously rendered chart until **Render**. Reset zoom/double-click restores the original X domain and sample. Legend-hidden series now remain hidden across every real refresh path: zoom/refinement/reset/rerender/resize/settings/configuration in standalone results, and the corresponding supported paths in notebook output and the compatible SQLTools backport.
- Landed that narrow SQLTools hidden-series/keyboard-legend/double-click compatibility backport separately as `kdb-sqltools` commit `ac41ccd6ab4baf4fde5a57d154920e108a6b2bf9`, with named refresh-path regression coverage in follow-up `879e2da649e5570f5f5645dac77e03574147af94`; neither commit adds a runtime dependency to this extension or includes the sibling checkout's pre-existing generated-doc changes.
- Kept durable notebook preferences under the shared `vscode-kdb.results.*` source of truth so supported renderer changes update other notebook outputs and open KX Results panels; output-local search, sort, selection, height, chart configuration, and zoom remain local.
- Changed the global `vscode-kdb.queryTimeoutMs` default to `1800000` milliseconds (30 minutes) and made it independent of the unchanged `30000` millisecond TCP connect/q IPC handshake default. Omitted profile values inherit the global query default, explicit per-profile values win, and `0` disables only its corresponding deadline.
- Expanded deterministic coverage for mixed-controller routing and guards, complete-source/session continuity, cancellation/races/errors, renderer controls/search/copy/settings, six-type chart capability/selection flows, hidden-series lifecycle, and independent timeout defaults/overrides/diagnostics.
- Updated the notebook, installation/commands, charting, settings, troubleshooting, copy/export, parity, and release documentation. This remains a non-Marketplace release.

## 0.2.4 - 2026-07-24

- Fixed q general null/no-value responses from assignments, declarations, and calls such as `hopen` so they render as compact qText (`::`) in `.q` results, native q notebook cells, and notebook-to-panel handoff. Empty generic values also use qText, while schema-bearing zero-row q tables remain tables.
- Removed normal live-session, transport, decoding, snapshot, and recovery prose from inline notebook results. Routine output now stays focused on the result, with status text reserved for errors, unavailable data, truncation, and explicit bounds.
- Reworked inline notebook tables around a stable scroll viewport: small results use their natural height, larger results use a bounded default, both saved and live tables can be resized vertically, horizontal and vertical scroll positions survive virtual updates, and sticky headers/row numbers no longer overlap data.
- Added theme-aware drag, Shift-range, and keyboard selection for notebook tables. Live selections copy bounded TSV or CSV ranges through the owning extension-host result, including rows outside the currently loaded virtual slice; saved selections support the same two formats.
- Added compact live search, three-state sort, selection copy, reset-size, chart, and KX Results controls without adding panel-only features to notebook cells.
- Expanded saved and live inline charts to support selectable X, chart type, and up to 16 selected numeric Y series through the shared charting model. Inline uPlot charts now use panel-aligned grid, background, legend, selection, drag zoom, reset, and clustered multi-series bars, and remain below the table only while shown.
- Added deterministic q IPC fixtures for real no-value, empty vector, and typed zero-row table payloads; pure renderer-model tests for sizing, virtualization, selection, copy, and multi-series controls; and validated live range-copy protocol bounds.

## 0.2.3 - 2026-07-23

- Added the supported VS Code `NotebookController` `vscode-kdb.q-notebook-controller` for ordinary `jupyter-notebook` documents. **KX q (Direct IPC)** is activated by `onNotebook:jupyter-notebook`, appears in the normal notebook kernel/controller picker, advertises only `q`, and is distinct from a Python controller's per-cell language picker.
- Made native notebook execution explicit and first-party: after the user selects **KX q (Direct IPC)**, normal Run Cell, Run All, and `Ctrl+Enter` execute each complete q code-cell source through the profile selected in **KX Connections**. The controller reuses that profile's existing `ConnectionManager` client/session and configured namespace wrapper, preserving assignments and q session state across normal `.q` editor and direct-controller runs without a per-cell or per-notebook connection. Complete-cell script grouping requires q 4.0 dated 2023-03-28 or newer, or q 4.1t dated 2022-11-01 or newer.
- Added inspectable controller detail and q cell status with **Direct IPC**, active profile name, endpoint, namespace, and connected/connect-on-Run state. A saved disconnected active profile may connect on demand only after explicit direct-controller selection, using its configured connect/query deadlines. With no active profile, the cell receives the actionable **Add or select a KX connection in the KX Connections view** error.
- Kept mixed notebooks safe. Markdown is ignored, non-q code cells are never sent to q and receive a clear unsupported-language output, and a Run owned by a selected Python controller is never routed to direct IPC. A leading `%%q` is rejected by the direct controller to prevent route confusion; it remains specific to the Python helper. The 0.2.2 set/restore toolbar and context actions remain secondary language-editing aids rather than the native execution path.
- Added cancellation through the existing connection/client queue. Pre-dispatch cancellation sends no q request; queued cancellation removes only that request; a locally canceled synchronous request already sent keeps its protocol response slot so later queries stay ordered. Notebook execution finishes once and discloses that already-issued q work or side effects may continue because 0.2.3 does not claim server-side interruption.
- Added a transient in-memory live notebook result store over the same decoded q value/result-view model used by first-party KX results. Live direct results support bounded virtual slices, qText/list/dictionary/table display policies, capped search and sort, mouse selection/TSV copy inside the loaded slice, chart data, and an explicit handoff to the full KX Results panel while the live record exists. Inline copy is capped at 20,000 cells, inline sort rejects values above 250,000 rows, and inline search is capped at 1,000 matches, 2,000,000 inspected cells, or about 1.5 seconds; keyboard grid navigation, hide/reorder/resize, broader copy/export, and panel confirmation flows remain in the full panel.
- Made `vscode-kdb.results.*` the common source for live notebook and KX panel presentation. Validated renderer messages carry shared density/sizing, array/qText/object display strategies, elapsed-time, and chart settings; supported changes update the same global VS Code configuration and refresh other live q cells and open KX panels.
- Persisted only the existing bounded `application/vnd.kx.result+json` plus `text/plain` snapshot. Direct output does not add `text/html` or a persisted chart specification. Portable limits include the configured row/byte bounds, a 256-column ceiling, and a 32,768-character cell-value ceiling. The cell's opaque live-result ID is not an IPC handle and cannot recover data. Live records are bound to notebook URI/cell URI for one extension-host session; rerun or cell removal removes the cell record, notebook close removes its records, deactivation clears the store, and the 512-record cap evicts the oldest. Reopened or expired output contains only the saved rows and cannot recover omitted data.
- Kept the focused `python/kx_notebook` `%%q` helper as a separate Python-controller route. It executes only through its explicitly configured callback or opt-in PyKX object and does not share direct-controller variables, namespace state, session, or live-result identity.
- Added pure/provider and faithful fake coverage for controller identity/registration/disposal, active-profile routing and session continuity, full-cell/q-only behavior, direct outputs/errors/connect failure, cancellation, live-result bounds/search/sort/chart/settings, portable snapshots, sanitized diagnostics, manifest activation, and the Python/direct-controller boundary. No visual kernel-picker or real Extension Host E2E claim is made.
- Hardened the non-publishing release audit to require compiled notebook controller/live-result modules, the notebook activation event, and absence of private `ms-toolsai.jupyter` / `vscode-jupyter` runtime or extension dependencies. Packaged raw VSIX and one-file wrapper delivery remain local release artifacts; no Marketplace upload was added.

## 0.2.2 - 2026-07-23

- Added **KX: Set Notebook Cell Language to q** for Jupyter/IPython code cells. The cell-toolbar, notebook-cell context, and Command Palette action uses VS Code's supported document-language API across every selected code cell, reports changed/already-q/failed counts, skips Markdown, and provides actual q TextMate highlighting.
- Preserved non-default q cell language through VS Code's built-in `.ipynb` serializer as raw `metadata.vscode.languageId: "q"` when the active controller permits it. No unsupported notebook-scoping language manifest field was invented; the generic language picker remains kernel/controller-filtered, so the KX action is the reliable route.
- Added **KX: Restore Notebook Cell Language**, which safely resolves the notebook default from Jupyter `language_info` or `kernelspec` metadata and restores selected code cells without changing Markdown. This supports the normal Python Jupyter controller, which does not advertise or Run q-language cells and may normalize them to Python when a kernel is selected.
- Improved **KX: Tag Notebook Cell as q** to set actual q language mode first, then preserve or insert one leading `%%q` marker and merge nested KX limit metadata without deleting code or unrelated metadata. q selects highlighting; `%%q` remains the configured Python-kernel evaluator convention.
- Added the contextual **Prepare this q cell for the active Python kernel** action and cell status item for q-language cells missing `%%q`. After preparation, restore the notebook default/Python language before normal Run when using the standard Python controller; the extension does not intercept Jupyter Run.
- Recognized a top-line `%%q` as a notebook directive in the q TextMate grammar while retaining normal q highlighting below it. Standalone q editor keybindings and code lenses are excluded from notebook cell documents.
- Kept the execution boundary explicit: no NotebookController, private Jupyter interception, hidden second q connection, or direct IPC invocation was added for notebook cells. A future persistent q evaluator must bridge the active Python kernel's q session through supported same-kernel ownership.
- Added pure language-provider/selection/default-language and marker/metadata tests plus faithful fake-provider, grammar, source, and manifest guards for multiple selection, idempotency, Markdown rejection, partial failure, menu discovery, serializer-owned metadata preservation, and the no-direct-IPC boundary. No visual or real VS Code Extension Host E2E is claimed.
- Packaged for direct VSIX testing only. Marketplace publication remains deferred.

## 0.2.1 - 2026-07-23

- Added **KX: Import SQLTools KDB Connections**, an explicit one-shot migration bridge that discovers legacy KDB profiles already present in VS Code's `sqltools.connections` setting. Discovery covers user, workspace, and workspace-folder scopes, deduplicates equivalent candidates while retaining source labels, and does not require SQLTools to be installed or activated.
- Limited discovery to the normalized legacy aliases `KDB`, `kdb+`, `kdb`, `kdb-sqltools`, and `DanielAlonso.kdb-sqltools`. Other SQLTools drivers are ignored before their connection fields or passwords are inspected.
- Added a KX-owned multi-select review showing sanitized profile name, direct endpoint, namespace, source scope, password presence without its value, and timeout behavior. Malformed profiles and SSH-enabled profiles remain visible with safe non-importable reasons; SSH options and credentials are never copied.
- Mapped the legacy name, server, port, database namespace, username, and connection timeout into validated KX-owned direct IPC profiles. The legacy timeout is converted from seconds to the KX connect/handshake timeout only, including `0`; the KX query timeout remains unset and continues to inherit its global KX default.
- Added an explicit modal choice before selected plaintext passwords are re-read and copied once into VS Code SecretStorage. Users can instead import without passwords or cancel. The original SQLTools setting remains unchanged, and passwords are excluded from labels, logs, diagnostics, history, telemetry, errors, snapshots, and saved KX settings.
- Made conflicts safe by default: an existing KX name or equivalent direct endpoint is skipped unless the user explicitly chooses **Import as new name**. This release never overwrites or replaces a saved KX profile. Import summaries report imported, skipped, unsupported, and failed counts, explain that there is no ongoing sync, and offer review in the KX connection editor.
- Added deterministic parsing, configuration-provider, conflict, SecretStorage, lifecycle, tree-refresh, and no-leakage coverage. Configuration inspection is exercised with faithful fakes because no VS Code Extension Host is available; this is not visual or real Extension Host end-to-end evidence.
- Kept the extension standalone: no SQLTools package, extension dependency, API, command, view, result target, runtime session behavior, `.session.sql` support, or Marketplace publication was added.

## 0.2.0 - 2026-07-22

- Added a real VS Code NotebookRenderer for the versioned `application/vnd.kx.result+json` v1 MIME contract. Ordinary Jupyter/IPython `.ipynb` files can now retain bounded KX/q table data, schema, row counts, safe provenance, elapsed time, truncation state, and an optional chart specification directly in code-cell output.
- Added the focused `python/kx_notebook` IPython helper. It publishes the KX MIME result together with escaped `text/html` and `text/plain` fallbacks, provides an explicit callback-backed `%%q` magic, and offers an opt-in adapter for an already installed/licensed PyKX runtime. The package bundles no q runtime, PyKX binary, credential, IPC handle, or remote bridge.
- Added compact inline tables, bounded CSV copy, and local uPlot line/scatter/step/bar charts with column controls and Reset zoom. The emitted chart specification persists; renderer-only control changes remain session state. Static export uses the emitted chart specification to include a network-free SVG rather than promising interactive HTML/PDF charts.
- Added **KX: Tag Notebook Cell as q** using a durable `%%q --max-rows ... --max-bytes ...` marker plus `vscode-kdb` namespaced cell metadata, and **KX: Open Saved Notebook Preview in Results Panel** for bounded-preview handoff to the existing full-screen panel.
- Added `inline`, `panel`, and `both` notebook presentation, defaulting to `inline`, plus explicit persisted-output limits defaulting to 1,000 rows and 1,000,000 bytes. Valid ranges are 1-10,000 rows and 16,384-10,000,000 bytes; truncation and the absence of omitted data are displayed clearly.
- Preserved normal Jupyter controller and Python-cell behavior. The extension does not intercept Jupyter execution, create a second direct q connection for notebook cells, or claim recovery of omitted/full results. Extension-driven same-session routing remains deliberately disabled; `%%q` executes only through the evaluator explicitly configured in that Python kernel.
- Kept normal `.q` editor execution and the existing high-performance KX Results panel unchanged. This focused notebook renderer/protocol is not a full KDB-X or q Professional parity claim.

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

Extension-owned `.q` execution and the 0.2.3 native q notebook controller remain direct IPC only. SSH, TLS termination, gateway/broker setup, remote administration, private Microsoft Jupyter integration, Python-controller interception, server-side interruption, and persisted full-result recovery are not included. The Python `%%q` helper remains a separate same-Python-kernel route.
