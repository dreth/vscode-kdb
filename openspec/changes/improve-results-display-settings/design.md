## Context

See proposal.md for motivation. Inspection found Results columnWidth gives positional manual overrides priority, refreshAutoColumnWidths skips those positions, and setAutoFitEnabled only changes the boolean. This explains one failure mode; browser regressions must also verify sizing arrival and actual layout. Whole-result widths use host-provided text lengths with bounded automatic width; visible rows use slice text. Current docs explicitly promise manual-width persistence, so clearing is limited to explicit user activation, not settings hydration.

SharedKxResultSettings and the shared control definitions feed the host and notebook renderer, while Results embeds its own controls and browser settings normalization. Notebook message validation enumerates settings. Numeric axis layout also has separate consumers (notebook uPlot measures labels). Existing tests cover positional widths, disabled scans, shared controls, and notebook transport.

## Goals / Non-Goals

Goals: one display policy, explicit autofit activation semantics, independent precision, and consistent UI/configuration behavior.

Non-goals: new sampling policy, altered export precision, MIME migration, changing notebook retention, or rewriting rendering architecture. Preserve active unlimited-output and runtime-sidebar changes.

## Decisions

1. Treat explicit off-to-on autofit as an intentional reset for current source positions. Use the existing ordered width-persistence mechanism and distinguish UI activation from configuration hydration. Preserve unrelated positions and subsequent manual resizes. Merely ignoring overrides would let stale widths reappear after restart; globally deleting the map would discard unrelated choices. Invalidate width caches on precision/font/layout changes and render after new measurements arrive. Keep existing width bounds; test actual text/headers rather than only checkbox state. Expose the same reset-and-recompute operation as **Fit now** so users can intentionally refit while autofit is already enabled. The action updates local state immediately, sends the existing positional-clear messages through the ordered persistence queue, and enables autofit when required; it does not change reload hydration semantics.
   Follow-up correction: default the scope to visible rows, and calculate its widths from actual formatted header/cell strings with canvas text metrics and existing padding/bounds. When checked, automatic widths win over any stale persisted manual widths; a new manual drag turns auto-fit off before persisting its width. Explicit whole-result selection remains available and retains its bounded length-hint behavior. No q execution or extra offscreen scan is introduced for visible fitting.
2. Extend the shared setting schema with tableDecimalPlaces (-1 for Auto; 0–12 explicit) and chartScientificNotationThreshold (finite positive, default 1e6). Preserve chartDecimalPlaces and existing moved keys. Update defaults, package configuration, host reads/writes, browser normalization, notebook allowlists, and settings-change listeners together. Treat absent new fields in older messages as defaults where compatibility permits; reject invalid explicit messages according to the existing transport policy.
3. Put floating-point display formatting in host-neutral helpers used by table cell presentation and sizing. Use q metadata to avoid treating dates, longs, numeric strings, or special tokens as floats. Do not round source values or reuse rounded display strings for sorting/export/persistence. Auto preserves historical output. A shared chart numeric formatter selects notation by absolute unrounded magnitude and chart precision; it applies only to numeric axes, not epoch values on time axes.
4. Keep configuration support independent of quick-control visibility. Remove the listed controls and their DOM wiring from Results and filter the corresponding notebook quick definitions, without deleting setting validators or host support. Keep an extension-settings entry point. Keep list Grid/qText strategy controls: moving separator formatting does not remove the separate result-shape choice. Interpret elapsed time as moving its preference, preserving execution status.
5. Measure chart labels after formatting and reserve adequate axis and edge space in both renderers. Preserve viewport and hidden series on settings redraw; formatting changes must not trigger a source query or undermine refinement request identities. Scientific notation alone does not guarantee unclipped labels, so include visual checks at narrow widths and larger fonts.

## Risks / Trade-offs

- Explicit activation changes documented precedence → document the narrow reset exception and test reload/manual resize separately.
- Display formatting can accidentally leak into export or q identity → separate display helpers/options and add exact-value round-trip tests.
- Duplicated host/browser settings wiring can diverge → validate settings and UI parity across all three surfaces.
- Large-result whole-source sizing can be expensive → retain yielding, bounds, caching and stale-result protection; do not add repeated scans per frame.
- Concurrent uncommitted work touches settings, tests and docs → edit only relevant sections and record baseline failures separately.

## Migration Plan

Add settings with backward-compatible defaults; retain existing configuration keys and MIME versions. Update documented manual-width activation semantics and quick-menu locations. Run focused behavior and visual regressions, npm test, and the documented docs build. Rollback can remove new display controls/keys without changing stored q data; widths intentionally reset by a user are not reconstructed. Archive only after implementation and verification.
