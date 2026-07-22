# Changelog

All notable changes to KX for VS Code are documented here.

## Unreleased

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

Phase 1 is direct IPC only. SSH, TLS termination, gateway/broker setup, and object exploration are not included.
