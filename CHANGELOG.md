# Changelog

All notable changes to KX for VS Code are documented here.

## Unreleased

- Added a source-backed standalone parity matrix, phased architecture roadmap, and post-verification backport policy.
- Added a reproducible MkDocs Material site with committed generated output and a build-only Pages drift/artifact workflow.
- Added the `KX` Output channel with redacted connection, handshake, query, cancellation, and close diagnostics plus opt-in safe performance timings.
- Added direct IPC reliability, q-error, namespace, redaction, and connection-state regression coverage without changing the `0.1.1` version or producing a new VSIX.

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

Phase 1 is direct IPC only. SSH, TLS termination, gateway/broker setup, and object exploration are not included.
