## Purpose

Defines the authoritative chart-density and viewport-refinement contract so large kdb+/q results remain truthful, predictable, and fast across Results and notebook charts.

## ADDED Requirements

### Requirement: Ordinary charts use one exact aligned density contract
For line, scatter, and step charts, the system SHALL determine eligible source observations within the active absolute X range using the existing X validity, selected-series, grouping, duplicate-X, and gap rules. If the range contains at most 7,000 eligible observations, the system SHALL retain every eligible observation. If it contains more than 7,000 eligible observations, the system SHALL return exactly 7,000 deterministic aligned X samples.

Every selected or generated Y series SHALL contain one value slot for every returned X sample. Sampling SHALL consider the extrema and real discontinuities of every selected series when choosing the shared X sample, but SHALL NOT fabricate finite values for source nulls or invalid observations. Bar, box, and candlestick charts SHALL retain their family-specific aggregation semantics and SHALL NOT exceed 7,000 returned visual items merely to satisfy the ordinary-series exact-count rule.

#### Scenario: Large two-series range
- **WHEN** a line chart has two selected Y series and more than 7,000 eligible source observations in its active X range
- **THEN** the chart data contains exactly 7,000 X samples and each Y series contains exactly 7,000 aligned value slots
- **AND** both series influence retained extrema and discontinuities

#### Scenario: Small source range
- **WHEN** an ordinary chart range contains 7,000 or fewer eligible source observations
- **THEN** every eligible observation is returned without downsampling
- **AND** every selected series remains aligned with the returned X observations

#### Scenario: Missing source values
- **WHEN** a selected series contains null, non-finite, or otherwise invalid Y observations
- **THEN** the sampler preserves the applicable gap semantics without inventing finite values
- **AND** the aligned series length still matches the returned X sample length

#### Scenario: Family-specific chart
- **WHEN** a bar, box, or candlestick chart consolidates or aggregates eligible observations
- **THEN** it retains its documented family-specific semantics and remains bounded to at most 7,000 visual items

### Requirement: Zoom refinement follows 7,000/3,000 hysteresis
The system SHALL apply zoom refinement from the count of currently retained samples visible inside the completed absolute viewport, not from a fixed number of user gestures. While at least 3,000 retained samples are visible, zooming SHALL remain local and SHALL naturally show the visible subset without a source refill.

When fewer than 3,000 retained samples remain visible, the system SHALL inspect the authoritative source range. If that range has more than 7,000 eligible observations, it SHALL refill the viewport to exactly 7,000 samples. If that range has 7,000 or fewer eligible observations, it SHALL show all eligible observations. Results panel and live notebook refinement SHALL use this same decision.

#### Scenario: First local zoom remains dense
- **WHEN** a completed zoom leaves 5,000 of the current 7,000 samples visible
- **THEN** the chart shows those 5,000 samples locally
- **AND** no source resampling request is issued

#### Scenario: Local zoom reaches the lower bound
- **WHEN** a completed zoom leaves exactly 3,000 retained samples visible
- **THEN** the chart shows those 3,000 samples locally
- **AND** no source resampling request is issued

#### Scenario: Underfilled viewport has abundant source data
- **WHEN** a completed zoom leaves fewer than 3,000 retained samples visible and its source range contains more than 7,000 eligible observations
- **THEN** the system resamples that absolute source range to exactly 7,000 aligned samples

#### Scenario: Underfilled viewport has a bounded source range
- **WHEN** a completed zoom leaves fewer than 3,000 retained samples visible and its source range contains 7,000 or fewer eligible observations
- **THEN** the system returns every eligible observation in that source range

#### Scenario: Gesture count does not control density
- **WHEN** multiple zoom gestures leave differing numbers of retained samples visible
- **THEN** refinement is determined only by the 3,000-point threshold and authoritative source availability

### Requirement: Panning preserves a compatible sampling level
The system SHALL classify temporal X axes from q type metadata when available and from the established chart inference only when authoritative metadata is absent. After a temporal viewport is sampled, a same-configuration, same-span pan SHALL retain the same epoch-anchored time sampling level and selection policy. Samples in the overlapping region SHALL remain identical, and newly exposed source intervals SHALL be sampled at the same points-per-time density before the pieces are combined under the 7,000-point ceiling.

For non-temporal X axes, the system SHALL use a deterministic observation-based sampling level anchored to stable source/X ordering. A compatible same-span pan SHALL retain the overlap and apply the same observations-per-sample policy to newly exposed source observations. A changed chart configuration, materially changed viewport span, incompatible source, or invalid cache SHALL establish a new sampling level rather than reuse incompatible samples.

#### Scenario: Same-span temporal pan
- **WHEN** a sampled temporal line chart is panned to an overlapping range with the same span and chart configuration
- **THEN** the overlapping samples are retained exactly
- **AND** newly exposed time intervals use the same epoch-anchored sampling level
- **AND** the combined result does not exceed 7,000 aligned samples

#### Scenario: Temporal source can fill the panned range
- **WHEN** a temporal pan requires a refill and the selected source range contains more than 7,000 eligible observations
- **THEN** the resulting range contains exactly 7,000 aligned samples at a sampling level compatible with the preceding viewport

#### Scenario: Non-temporal same-span pan
- **WHEN** a sampled numeric X chart is panned to a compatible overlapping range
- **THEN** the overlap remains stable and newly exposed observations use the same deterministic observation-based sampling policy

#### Scenario: Incompatible pan cache
- **WHEN** the selected columns, grouping, chart type, source identity, source limit, or viewport sampling level is incompatible with the retained pan state
- **THEN** the system performs a clean authoritative range build and replaces the incompatible state

### Requirement: Sampling remains source-faithful and lifecycle-safe
Every refill SHALL use the authoritative retained source rather than a prior sample. Sampling SHALL be deterministic for identical source/configuration/range inputs, preserve applicable first/last observations, per-series extrema, duplicate-X semantics, and real source gaps, and keep X/Y alignment intact. Existing absolute-range clamping, request deduplication, stale-response rejection, reset-without-query, hidden-series, and source-row guard behavior SHALL remain intact.

#### Scenario: Nested zoom recovers omitted observations
- **WHEN** a nested zoom range contains source observations that were not retained by the preceding sample
- **THEN** a required refill can select those observations from the authoritative source

#### Scenario: Stale refinement arrives
- **WHEN** a chart response belongs to a superseded viewport request or arrives after Reset
- **THEN** it is rejected without replacing the current chart

#### Scenario: Reset after refinement
- **WHEN** the user resets a refined chart
- **THEN** the immutable original full chart and domain are restored without rerunning q

#### Scenario: Identical sampling input
- **WHEN** source identity, chart configuration, absolute range, and sampling level are identical
- **THEN** the returned aligned samples and gap metadata are identical

### Requirement: Resampling work is bounded and measured
The system SHALL avoid repeated full-source scans for one range build. After a compatible pan state or X-range index exists, panning SHALL process only newly exposed source observations plus work bounded by the retained sample size; it SHALL NOT rescan observations wholly contained in the reused overlap merely to reconstruct counts, domain, sorting, or warnings. Sampling caches SHALL be bounded, scoped to one source/configuration identity, and invalidated on incompatible changes.

The project SHALL maintain a reproducible benchmark covering numeric and temporal initial builds, deep zoom refills, and compatible pans with one, four, eight, and sixteen Y series. Completion evidence SHALL compare source reads, output density, preparation latency, and browser-visible interaction cost with `v0.2.13` and `v0.2.22`. The preparation target SHALL be `v0.2.13` or better; any unmet target requires explicit approval and documented evidence rather than silent acceptance.

#### Scenario: Compatible cached temporal pan
- **WHEN** a temporal viewport pans with a compatible retained overlap
- **THEN** source Y values wholly inside the overlap are not decoded again
- **AND** the implementation performs no full-source summary pass for that pan

#### Scenario: Instrumented range refill
- **WHEN** an automated performance fixture records X and Y source reads for one refill
- **THEN** read counts are linear in the indexed selected range plus bounded inference/cache work rather than repeated multiples of the complete source

#### Scenario: Performance acceptance evidence
- **WHEN** implementation is proposed as complete
- **THEN** reproducible benchmark results report density, source-read counts, preparation latency, and interaction timing against both historical baselines
- **AND** a result slower than the stated target is not accepted without explicit approval

### Requirement: Results, notebook, and status behavior remain honest
The Results panel and live notebook renderer SHALL implement the same ordinary-series density, zoom threshold, sampling-level, and stale/reset contracts. A saved or otherwise source-bounded notebook chart SHALL apply the density rules only to the exact data it owns and SHALL NOT claim that omitted authoritative source rows can be refilled. Chart status SHALL distinguish eligible source observations from returned samples and identify the active point-count or temporal sampling level sufficiently for diagnostics.

#### Scenario: Results and live notebook parity
- **WHEN** Results and live notebook charts receive equivalent source data, chart configuration, and viewport ranges
- **THEN** they make the same refill decision and return equivalent aligned sampling density

#### Scenario: Saved notebook without live source
- **WHEN** a reopened saved chart has no authoritative live source binding
- **THEN** it samples or navigates only its exact persisted data
- **AND** it does not report a source refill that cannot occur

#### Scenario: Diagnostic chart status
- **WHEN** a chart is rendered or refined
- **THEN** its status reports eligible observations and returned sample/visual-item counts without conflating them
