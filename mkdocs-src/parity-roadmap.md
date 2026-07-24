# Parity Roadmap & Architecture

KX for VS Code is being developed as the future first-party KX product. During the parity phase, useful capabilities are ported from `kdb-sqltools` into this standalone architecture. Functional parity must be verified by evidence and user testing before the standalone repository becomes the source of truth.

The detailed, source-backed status is maintained in the repository's [`PARITY.md`](https://github.com/dreth/vscode-kdb/blob/main/PARITY.md). Its Present/Partial/Missing rows and exact source/test references are authoritative; this page is a user-facing architecture summary, not a second parity claim. The checked [`PARITY_RUN.md`](https://github.com/dreth/vscode-kdb/blob/main/PARITY_RUN.md) and [machine-readable JSON](https://github.com/dreth/vscode-kdb/blob/main/PARITY_RUN.json) record 63 classified cases / 381 assertions: 49 `PASS`, 5 `DIFFERENT_BY_DESIGN`, 3 `GAP`, and 6 `NOT_TESTABLE_HERE`, split into 38 deterministic, 14 live-q, and 11 boundary cases. The result is valid executable evidence with known gaps, not source-of-truth sign-off or a claim that the products are functionally or visually identical.

The repository manifest is at `0.2.7` for direct user testing. This package is not a KDB-X or q Professional parity sign-off or Marketplace-readiness claim; Marketplace publication remains deferred pending separate upload evidence.

## Current standalone architecture

The extension has nine deliberate layers:

1. **VS Code surface:** q language contribution, a supported native q Jupyter NotebookController, leading mixed-notebook Make/Run actions, q-cell route status and target chooser, a focused-editor shortcut, cell-language/Python-helper actions, editor commands, KX activity-bar views, the KX-owned single-screen connection form and unsaved-value test path, notifications, and `KX` Output channel.
2. **Migration ingress:** an explicitly invoked, read-only inspection of existing legacy KDB settings, followed by KX-owned review, validation, optional one-time SecretStorage transfer, and standalone profile creation without replacement or sync.
3. **Connection ownership:** verified application-scoped multi-profile safe metadata and optional timeout overrides, explicit global active-connection state, and per-connection VS Code SecretStorage keys.
4. **Direct q IPC:** handshake, serialization/deserialization, ordered queries, separate connect/query deadlines, q errors, transport lifecycle, configured-namespace wrappers, and client-side q source-line grouping followed by ordinary `value` evaluation.
5. **Optional server metadata:** disabled-by-default manual `tables[]`, conservative name/type categories, on-demand `meta`, and confirmed bounded previews for one active configured namespace.
6. **Optional local history:** disabled-by-default workspace `Memento` records for actually issued editor queries, with no results, sync, settings, telemetry, or passwords.
7. **Notebook execution/results:** native **KX q (Direct IPC)** selection for q-only normal Run plus leading **Make q Cell (KX)** / **Run q Cell (KX)** controls while a Python controller remains selected; explicit safe notebook-level profile targeting; shared complete-cell connection/session/namespace machinery; a transient live result registry; a versioned 20-row-default bounded KX MIME snapshot; and a separate callback-backed Python `%%q` helper.
8. **Result capabilities:** columnar storage, virtual grid/q-text presentation, opt-in safe qText readability, search/sort/selection, compact selection copy, capability-valid six-type charts, immutable original-domain zoom reset, and stable hidden-series state.
9. **Optional local access:** per-panel tokenized HTTP endpoints bound to loopback.

There are no SQLTools runtime imports, APIs, result targets, connection/session UI hooks, or session-file hooks in this graph. The migration ingress uses VS Code's configuration API to read matching candidates; SQLTools need not exist, source settings are unchanged, and no runtime/session relationship follows. The **KX Connection** form, migration review, focused Server Explorer, Query History, and their storage/lifecycle behavior are owned entirely by this extension.

## Focused standalone boundary

Present foundations include a responsive multi-profile direct-connection form, verified save/active state, temporary connection testing, a one-shot migration bridge, independent per-profile/global timeouts, SecretStorage, exact editor execution, client-grouped complete q source without a q release-date gate, q-only and explicitly targeted mixed-notebook direct q paths with shared session/namespace continuity, live notebook result records with shared settings, a 20-row-default bounded portable snapshot/renderer, the separate Python helper, focused server metadata/history, qText/grid result viewing, charting, copy/export, local data endpoints, diagnostics, tests, and reproducible documentation. A scoped non-visual Extension Host smoke covers activation and real notebook cell-language conversion/restoration; providers/source/manifest tests cover the remaining controller and renderer contracts. Authenticated live-path and visual verification remain partial as recorded in `PARITY.md`.

Known gaps and partial areas remain. The three ranked executable gaps in the checked pre-0.2.0 parity run are standalone Extension Host automation, a compatible reference multiline script-grouping adapter, and an explicit standalone q-block product decision. That report is historical and does not evaluate 0.2.7's client-side legacy-compatible source path. The current compatibility fixture proves generated direct-cell/script source does not require `.Q.ld`, but the available live run used the installed modern q runtime; no exact minimum q version or live historical-q result is claimed. Server Explorer remains one active direct profile/namespace. Direct notebook live records are extension-host memory only, bound to notebook/cell URI, removed on rerun/cell removal/close/deactivation, and capped at 512 oldest-first; reopened output is the bounded snapshot and cannot recover omitted rows. The Python `%%q` route remains a separate kernel-owned evaluator. Deterministic provider/renderer/source guards are not visual E2E. Packaging, release identity, and Marketplace readiness remain evidence gates.

Some SQLTools behaviors are deliberately omitted rather than missing:

- SQLTools as a runtime dependency;
- SQLTools connection/session UI;
- SQLTools result-grid routing;
- `.session.sql` creation or interpretation; and
- compatibility commands whose only purpose is to reproduce SQLTools ownership.

The one-shot importer is not one of those omitted runtime behaviors. It accepts only the five documented legacy KDB driver aliases as data classification, ignores other drivers before inspecting their fields/passwords, and creates only validated KX-owned profiles. SSH-enabled profiles are non-importable. Existing profiles are skipped or explicitly renamed, never replaced.

## Planned milestones

1. **Foundation:** maintain the standalone docs, diagnostics/redaction, connection-state reliability, execution semantics, and source-backed parity matrix.
2. **Useful capability parity:** port remaining product-value gaps in bounded changes, with standalone UI and direct tests rather than SQLTools adapters.
3. **User verification:** exercise connection, editor, viewer, chart, export, local-server, failure, cancellation, and large-result workflows in a real VS Code/q environment. Record exceptions instead of relabeling partial features as complete.
4. **Source-of-truth transition:** after verified functional parity, develop new KX behavior in `vscode-kdb` first.
5. **Deliberate backports:** make compatible, reviewed backports to `kdb-sqltools` only where its SQLTools architecture can support them without making it the design authority again.

The user-requested 0.2.5 chart-state work includes one such bounded backport: `kdb-sqltools` commit `ac41ccd6ab4baf4fde5a57d154920e108a6b2bf9` contains the stable hidden-series identity helper, compatible panel lifecycle/keyboard/double-click wiring, and focused tests; follow-up `879e2da649e5570f5f5645dac77e03574147af94` adds named zoom/reset/refine/rerender/resize/settings/configuration regression coverage. It adds no cross-repository runtime dependency and excludes unrelated generated-doc changes already present in that checkout.

## Competitive capability audit

The TextMate q grammar, q-only and mixed-notebook direct paths, optional qText result presentation, Server Explorer, Query History, migration review, and portable notebook snapshots move useful standalone capability forward without reproducing the breadth of KDB-X or q Professional. The product remains intentionally strongest at direct q execution and table/result visualization, with bounded first-party surfaces instead of a q LSP, lint engine, source-document formatter, remote Jupyter runtime, bundled gateway, administration, or compatibility subsystem.

- [q Professional / `jshinonome/vscode-k-pro` at `fc9afacaeaf5e90eb013eb34426488841cc24f2a`](https://github.com/jshinonome/vscode-k-pro/tree/fc9afacaeaf5e90eb013eb34426488841cc24f2a) documents a formatter and supplied product-level readability inspiration only. Its public repository is all-rights-reserved; no code, logic, or assets were copied.
- [KX's `KxSystems/kx-vscode` at `1c745bf0221dd3cca85dce925c4d432d80bb5ef5`](https://github.com/KxSystems/kx-vscode/tree/1c745bf0221dd3cca85dce925c4d432d80bb5ef5) was inspected under Apache-2.0. Its qlint command is linting, not a general qText result pretty-printer. No source code, logic, or assets were adapted for 0.2.5.
- SQLTools remains absent as a runtime or UI dependency. The importer, views, and local storage do not depend on SQLTools connection, result, or session abstractions.

The native TextMate q grammar now recognizes a leading `%%q` notebook directive and retains normal q highlighting below it; ordinary q token rules remain unchanged. `.k` remains unassociated until a demonstrated, testable need justifies the compatibility risk. Optional qText formatting is display-only, not a source formatter.

## One-shot migration bridge

Version 0.2.3 retains the ability to inspect existing `sqltools.connections` values as untrusted import candidates when the user invokes **KX: Import SQLTools KDB Connections**. It recognizes only `KDB`, `kdb+`, `kdb`, `kdb-sqltools`, and `DanielAlonso.kdb-sqltools`, discovers user/workspace/workspace-folder scopes, retains scope labels after deduplication, and maps validated direct fields into KX storage. Legacy seconds become connect timeout milliseconds only; query timeout keeps the KX default.

Unsupported and SSH-tunnel-dependent candidates remain visible but disabled. Password presence is visible but its value is not; selected plaintext passwords require a modal copy-once choice before SecretStorage. Conflicts default to skip and may only be imported under a new validated name. The bridge has no Replace action, does not alter source settings, and creates no sync, SQLTools activation, API call, view, result target, or session behavior.

Unit tests exercise pure parsing and faithful fake configuration/provider/store adapters. Without an actual Extension Host run, those tests do not prove visual QuickPick behavior or real configuration-scope integration.

## Bounded notebook milestone

Version 0.2.0 shipped a real NotebookRenderer and a focused Python/IPython helper for ordinary `.ipynb` files. The versioned `application/vnd.kx.result+json` contract persists bounded typed table data, schema/count/truncation metadata, and safe provenance. The Python helper can add an optional chart specification and escaped static HTML/text fallbacks.

Version 0.2.2 added actual q cell language through the supported VS Code document-language API, editing actions, safe default restoration, and durable `%%q` preparation.

Version 0.2.3 adds `vscode-kdb.q-notebook-controller` through the public `createNotebookController` API. **KX q (Direct IPC)** appears in VS Code's normal kernel/controller selector, advertises q, and executes complete cells through the active first-party q client and namespace. It does not intercept Microsoft Jupyter, use private APIs, create a second connection, or reroute a Python controller.

Version 0.2.5 added **Run q Cell (KX)** for q-language cells while a Python controller remained selected.

Version 0.2.6 makes that path discoverable with leading **Make q Cell (KX)** / **Run q Cell (KX)** actions, q-cell route status, an explicit notebook-level saved-profile target, and a focused q-editor shortcut. The globally active profile is offered as a labeled convenience, never an invisible mixed-mode fallback. Missing/removed targets require selection, and notebook metadata stores only safe profile ID/name. Because the unselected KX controller cannot own native execution, mixed output remains one stale-checked, undoable notebook edit that marks the notebook dirty. Persisted table previews now default to 20 rows while the transient live result stays full.

The direct live value uses the first-party result model only while its transient record exists. Direct saved output is KX MIME plus `text/plain`; it has no persisted chart specification or `text/html`, and omitted data cannot be recovered. The Python `%%q` helper remains a separate same-Python-kernel route that can emit its bounded static HTML/chart fallback, with no implied extension-managed state sharing or Direct IPC live-result identity.

## Future shared-core boundary

No monorepo or cross-repository product code move is part of this pass. Shared executable contract fixtures now cover selected pure/core boundaries, but extraction remains deferred until interfaces are stable, the ranked product decisions are resolved, and both owning repositories can carry their own approved tests.

Good candidates are pure or host-neutral code:

- q IPC codec/value/error contracts;
- namespace and script-wrapping helpers;
- columnar result and q-text transformations;
- copy/export and chart data algorithms; and
- structured diagnostics schemas and redaction helpers.

VS Code commands, panels, tree providers, SecretStorage, standalone connection state, and SQLTools adapters should remain in their owning products. Shared code should flow from standalone product requirements, then be consumed by deliberate compatible backports; it should not reintroduce a SQLTools runtime dependency.
