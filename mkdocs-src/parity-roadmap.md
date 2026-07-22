# Parity Roadmap & Architecture

KX for VS Code is being developed as the future first-party KX product. During the parity phase, useful capabilities are ported from `kdb-sqltools` into this standalone architecture. Functional parity must be verified by evidence and user testing before the standalone repository becomes the source of truth.

The detailed, source-backed status is maintained in the repository's [`PARITY.md`](https://github.com/dreth/vscode-kdb/blob/main/PARITY.md). Its Present/Partial/Missing rows and exact source/test references are authoritative; this page is a user-facing architecture summary, not a second parity claim. The checked [`PARITY_RUN.md`](https://github.com/dreth/vscode-kdb/blob/main/PARITY_RUN.md) and [machine-readable JSON](https://github.com/dreth/vscode-kdb/blob/main/PARITY_RUN.json) record 63 classified cases / 381 assertions: 49 `PASS`, 5 `DIFFERENT_BY_DESIGN`, 3 `GAP`, and 6 `NOT_TESTABLE_HERE`, split into 38 deterministic, 14 live-q, and 11 boundary cases. The result is valid executable evidence with known gaps, not source-of-truth sign-off or a claim that the products are functionally or visually identical.

The repository manifest is at `0.1.5` for direct user testing. This package is not a KDB-X or q Professional parity sign-off or Marketplace-readiness claim; Marketplace publication remains deferred pending separate upload evidence.

## Current standalone architecture

The extension has seven deliberate layers:

1. **VS Code surface:** q language contribution, editor commands, KX activity-bar views, the KX-owned single-screen connection form and unsaved-value test path, notifications, and `KX` Output channel.
2. **Connection ownership:** application-scoped safe metadata and optional timeout overrides, global active-connection state, and per-connection VS Code SecretStorage keys.
3. **Direct q IPC:** handshake, serialization/deserialization, ordered queries, separate connect/query deadlines, q errors, transport lifecycle, and namespace/script wrappers.
4. **Optional server metadata:** disabled-by-default manual `tables[]`, conservative name/type categories, on-demand `meta`, and confirmed bounded previews for one active configured namespace.
5. **Optional local history:** disabled-by-default workspace `Memento` records for actually issued editor queries, with no results, sync, settings, telemetry, or passwords.
6. **Result capabilities:** columnar storage, virtual grid/q-text presentation, opt-in safe qText readability, search/sort/selection, copy/export, safe chart transformations, and immutable original-domain zoom reset.
7. **Optional local access:** per-panel tokenized HTTP endpoints bound to loopback.

There are no SQLTools runtime imports, APIs, result targets, connection/session UI hooks, or session-file hooks in this graph. The **KX Connection** form, focused Server Explorer, Query History, and their storage/lifecycle behavior are owned entirely by this extension.

## Focused standalone boundary

Present foundations include a responsive single-screen direct-connection form, extension-host validation, temporary unsaved-value connection testing, optional per-profile connect/query timeouts, deterministic connected-edit lifecycle, authentication and SecretStorage implementation, exact editor execution, opt-in focused server metadata and previews, opt-in privacy-aware local history, result viewing with optional safe qText readability, charting including candlesticks and original-domain reset, copy/export, local data endpoints, diagnostics, tests, and reproducible documentation. Authenticated live-path and visual verification remain partial as recorded in `PARITY.md`.

Known gaps and partial areas remain. The three ranked executable gaps are standalone Extension Host automation, a compatible reference multiline script-grouping adapter, and an explicit standalone q-block product decision. The six recorded external boundaries are Extension Host/visual/manual UX, authenticated q, remote/SSH/TLS/IPv6/multi-version q, spreadsheet rendering, VSIX/Marketplace evidence, and server-side cancellation after dispatch. The Server Explorer is deliberately limited to the active direct profile and configured namespace; it is not broad namespace navigation, Insights/gateway integration, server administration, or a write surface. Deterministic model/host/webview/source guards are not visual E2E, and release 0.1.5 has no screenshot evidence. Packaging, release identity, and Marketplace readiness remain evidence gates rather than documentation claims.

Some SQLTools behaviors are deliberately omitted rather than missing:

- SQLTools as a runtime dependency;
- SQLTools connection/session UI;
- SQLTools result-grid routing;
- `.session.sql` creation or interpretation; and
- compatibility commands whose only purpose is to reproduce SQLTools ownership.

## Planned milestones

1. **Foundation:** maintain the standalone docs, diagnostics/redaction, connection-state reliability, execution semantics, and source-backed parity matrix.
2. **Useful capability parity:** port remaining product-value gaps in bounded changes, with standalone UI and direct tests rather than SQLTools adapters.
3. **User verification:** exercise connection, editor, viewer, chart, export, local-server, failure, cancellation, and large-result workflows in a real VS Code/q environment. Record exceptions instead of relabeling partial features as complete.
4. **Source-of-truth transition:** after verified functional parity, develop new KX behavior in `vscode-kdb` first.
5. **Deliberate backports:** make compatible, reviewed backports to `kdb-sqltools` only where its SQLTools architecture can support them without making it the design authority again.

## Competitive capability audit

Server Explorer and Query History move useful standalone parity forward without reproducing the breadth of KDB-X or q Professional. The product remains intentionally strongest at direct q execution and table/result visualization, with small opt-in workflow surfaces instead of bundled gateway, administration, notebook, or compatibility subsystems.

- [q Professional / `jshinonome/vscode-k-pro` at `fc9afacaeaf5e90eb013eb34426488841cc24f2a`](https://github.com/jshinonome/vscode-k-pro/tree/fc9afacaeaf5e90eb013eb34426488841cc24f2a) documents a formatter and supplied product-level readability inspiration only. Its public repository is all-rights-reserved; no code, logic, or assets were copied.
- [KX's `KxSystems/kx-vscode` at `1c745bf0221dd3cca85dce925c4d432d80bb5ef5`](https://github.com/KxSystems/kx-vscode/tree/1c745bf0221dd3cca85dce925c4d432d80bb5ef5) was inspected under Apache-2.0. Its qlint command is linting, not a general qText result pretty-printer. No source code, logic, or assets were adapted for 0.1.5.
- SQLTools remains absent as a runtime or UI dependency. The new views and local storage do not depend on SQLTools connection, result, or session abstractions.

The native q grammar was also audited and left unchanged because no reliable token-coverage defect was found. `.k` remains unassociated until a demonstrated, testable need justifies the compatibility risk.

## Later experimental notebook milestone

q notebooks belong to a later experimental milestone, not a fake parity checkbox. A viable proposal must define a durable document format and serializer, stable cell identities and execution-state restoration, cross-cell stale/error/cancellation semantics, renderer/controller and Extension Host tests, interoperability expectations, and the package-weight cost of VS Code notebook infrastructure. Until those questions have evidence-backed answers, the extension will not contribute a placeholder notebook controller or reinterpret `.q` files as notebooks.

## Future shared-core boundary

No monorepo or cross-repository product code move is part of this pass. Shared executable contract fixtures now cover selected pure/core boundaries, but extraction remains deferred until interfaces are stable, the ranked product decisions are resolved, and both owning repositories can carry their own approved tests.

Good candidates are pure or host-neutral code:

- q IPC codec/value/error contracts;
- namespace and script-wrapping helpers;
- columnar result and q-text transformations;
- copy/export and chart data algorithms; and
- structured diagnostics schemas and redaction helpers.

VS Code commands, panels, tree providers, SecretStorage, standalone connection state, and SQLTools adapters should remain in their owning products. Shared code should flow from standalone product requirements, then be consumed by deliberate compatible backports; it should not reintroduce a SQLTools runtime dependency.
