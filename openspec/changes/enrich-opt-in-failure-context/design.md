## Context

See `proposal.md` and the active `add-opt-in-failure-reporting` design/spec. The reporter already owns sanitization, context, generations and transports. Producers have narrow numeric/boolean details; `KxDiagnostics` provides some IPC timings, while renderer/language forwarding has no shared rich operation payload. The retained packaged DEV smoke has a useful environment snapshot but no preceding operation sequence. Its bundle is minified and supplies one safe owned frame.

## Goals / Non-Goals

**Goals:** Extend that shared reporter so operators can reconstruct an owned failure without user data, and expose useful sections clearly in GlitchTip.

**Non-Goals:** A second telemetry system, global instrumentation, persistent monitors/history, q/workspace probing, raw messages, stack source excerpts or fleet-wide configuration. Infrastructure remains the already verified DEV project.

## Decisions

### Extend one shared allowlist and producer contract

Extend `failure-record.ts` with explicit phase/status/surface/transport/output enums and safe state/timing/count fields. Host producers provide facts they already own; browser/language bridges receive stricter bounded records with generation and sender validation. Operation IDs are random activation-local tokens, never URI/endpoint/query hashes. Enrich existing lifecycle breadcrumbs rather than collecting Output or console text. Cancellation/stale events may describe owned lifecycle state but never independently become errors.

Alternative: attach arbitrary producer objects. Rejected because those retain source/results/identity and make privacy unverifiable.

### Gather only bounded host facts on eligible failures

Add safe Node `os`, `process` and V8 resource/version summaries using direct APIs, with independently caught unavailable fields. No polling or shell commands. Enumerate safe settings explicitly after reviewing manifest names/types; include operational limits and display/output/transport enums, excluding connection/history/source/destination strings. Browser facts come only from the corresponding owned producer; never pretend host facts describe a remote client UI.

Alternative: SDK default integrations or a settings/environment dump. Rejected because both violate shared-host isolation and collection exclusions.

### Preserve classifications and build provenance

Keep conservative text omission and add audited standard code/category/template mappings, preserving bounded cause order and owned frames. Record a reproducible hash of packaged first-party artifacts through build-generated metadata; package and test that metadata alongside the actual bundle. Match any debugging/source-map workflow to that identifier/release and the supported GlitchTip project release mechanism; do not upload maps automatically or include user source. Source-map generation/upload is optional supplementary work, not a blocker for rich context.

Alternative: sending raw messages, arbitrary stacks or repository contents. Rejected because a useful message can also contain user q/source/identity.

### Make context useful in both receivers

Keep JSON schema v1 additive and the detailed KX context, while duplicating only selected safe common facts into standard Sentry `runtime`/`os` contexts and tags. Bound and sanitize the final event after projection so SDK additions cannot escape. Retain failure/classification/owned frames first, then drop optional extended resource details, excess inventory and older breadcrumbs deterministically when necessary, with omissions.

### Prove meaningful history with an actual operation fixture

Extend the test-only smoke to emit an explicit synthetic owned start/phase/failure sequence with safe fixture state and nested causes; no actual q session or user notebook is needed. Verify both decoded real-SDK envelopes and the retained DEV event. Keep Results/live/saved surfaces' execution and output contracts under observer failure/outage fixtures. The smoke stays available only in ExtensionMode.Test and restores temporary settings.

## Risks / Trade-offs

- Larger context can exceed the envelope bound → deterministic per-section bounds and final wire-size assertions, with primary failure preservation.
- New enum/detail fields can weaken producer validation → reject unknown keys/types/senders/generations and test hostile nested data.
- Context collection can disrupt failing operations → lazy no-throw collection and throwing/unavailable collector regressions.
- Resource values vary and remote UI facts can be absent → assert types/bounds/omissions rather than fixed measurements.
- The existing full native column-reset gate fails before this work → preserve the assertion, record its baseline and keep its gate pending rather than claiming full completion.

## Migration Plan

Additive reporter fields require no persisted notebook or destination-setting migration. Build/package and test before the isolated DEV smoke; restore its DSN and retain empty distributed defaults. Roll back the extension context additions if necessary; no GlitchTip organization, key, ingress or other environment change is required.
