# Parity Roadmap & Architecture

KX for VS Code is being developed as the future first-party KX product. During the parity phase, useful capabilities are ported from `kdb-sqltools` into this standalone architecture. Functional parity must be verified by evidence and user testing before the standalone repository becomes the source of truth.

The detailed, source-backed status is maintained in the repository's [`PARITY.md`](https://github.com/dreth/vscode-kdb/blob/main/PARITY.md). Its Present/Partial/Missing rows and exact source/test references are authoritative; this page is a user-facing architecture summary, not a second parity claim.

The repository manifest remains at `0.1.1` for this foundation pass. The documentation and generated-site artifact do not constitute a development release, VSIX validation, Marketplace publication, or parity sign-off.

## Current standalone architecture

The extension has five deliberate layers:

1. **VS Code surface:** q language contribution, editor commands, KX activity-bar connection tree, notifications, and `KX` Output channel.
2. **Connection ownership:** application-scoped safe metadata, global active-connection state, and per-connection VS Code SecretStorage keys.
3. **Direct q IPC:** handshake, serialization/deserialization, ordered queries, timeouts, q errors, transport lifecycle, and namespace/script wrappers.
4. **Result capabilities:** columnar storage, virtual grid/q-text presentation, search/sort/selection, copy/export, and safe chart transformations.
5. **Optional local access:** per-panel tokenized HTTP endpoints bound to loopback.

There are no SQLTools runtime imports, APIs, result targets, connection forms, object-explorer nodes, or session-file hooks in this graph.

## Phase 1 boundary

Present foundations include direct connections, authentication and SecretStorage implementation, exact editor execution, result viewing, charting including candlesticks, copy/export, local data endpoints, diagnostics, tests, and reproducible documentation. Authenticated live-path verification remains partial as recorded in `PARITY.md`.

Known gaps and partial areas remain. In particular, Phase 1 does not provide an object explorer, built-in SSH/TLS or gateway orchestration, every historical editor convenience, complete visual/manual Extension Host coverage, or proof of end-user functional parity. Packaging, release identity, and Marketplace readiness remain evidence gates rather than documentation claims.

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

## Future shared-core boundary

No monorepo or cross-repository code move is part of the foundation pass. A later extraction should start only after interfaces are stable and both repositories have contract tests.

Good candidates are pure or host-neutral code:

- q IPC codec/value/error contracts;
- namespace and script-wrapping helpers;
- columnar result and q-text transformations;
- copy/export and chart data algorithms; and
- structured diagnostics schemas and redaction helpers.

VS Code commands, panels, tree providers, SecretStorage, standalone connection state, and SQLTools adapters should remain in their owning products. Shared code should flow from standalone product requirements, then be consumed by deliberate compatible backports; it should not reintroduce a SQLTools runtime dependency.
