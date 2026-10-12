## Purpose

Define predictable column fitting, accessible display preferences, and independent numeric presentation across Results and live or saved notebook output.

## ADDED Requirements

### Requirement: Explicit autofit activation fits current data
Turning autofit on SHALL clear persisted manual overrides for the current result's source column positions and recompute widths from headers and formatted values using the selected whole-result or visible-rows scope. Fitting SHALL respect existing minimum and maximum automatic widths, and refresh when formatting changes. Automatic settings hydration SHALL NOT clear manual widths. Manual resizing after fitting SHALL continue to take precedence and persist by source position.

The default selected scope SHALL be visible rows. While the checkbox is checked, the widths of currently displayed columns SHALL reflect the actual rendered header and on-screen cell text, within the existing width bounds; stale manual widths SHALL NOT mask the fit. A user-selected whole-result scope SHALL remain available and retain stable offscreen-aware fitting. Manual dragging SHALL turn auto-fit off and preserve the chosen manual width. No fit operation SHALL execute q.

Results, live notebook output, and saved notebook output SHALL expose an explicit **Fit now** action. Activating it SHALL enable autofit if necessary, clear manual overrides only for the current result's source positions, and immediately recompute the selected scope even when autofit was already enabled. It SHALL preserve unrelated positional widths and SHALL NOT execute q.

#### Scenario: Enable after manual resizing
- **WHEN** the user unchecks and checks autofit after manually sizing columns
- **THEN** those current-result columns fit the selected data scope immediately, without rerunning q or requiring Reset widths
- **AND** unrelated persisted column positions remain unchanged

#### Scenario: Whole result and visible rows
- **WHEN** a longer value exists outside the visible rows
- **THEN** whole-result fitting includes it while visible-row fitting measures currently rendered rows
- **AND** an empty result fits its headers without errors

#### Scenario: Persisted manual widths and disabled fitting
- **WHEN** a result reopens with a saved manual width, or autofit is disabled
- **THEN** the manual width survives and disabled autofit performs no sizing scan
- **AND** switching density or base cell width retains its established override-reset semantics

#### Scenario: Refit while autofit is already enabled
- **WHEN** autofit is checked but one or more current columns still have manual overrides
- **AND** the user activates **Fit now**
- **THEN** current-column overrides are cleared and headers plus formatted values are remeasured using the selected scope
- **AND** unrelated positional widths remain stored without executing q

#### Scenario: Checked autofit tracks visible text
- **WHEN** autofit is checked in Results, a live notebook grid, or a saved notebook grid with the default scope
- **THEN** each displayed column fits its rendered header and currently shown cells, including narrower text than an equally long wide-glyph string
- **AND** scrolling or paging updates widths for the newly shown cells without loading offscreen rows solely for fitting
- **AND** any stale persisted manual width cannot prevent the checked fit

### Requirement: Quick preferences emphasize display choices
Results quick preferences SHALL retain autofit and separate Table decimals and Chart decimals. Limit and threshold inputs (large-sort rows, copy/export cells, local-server export cells, chart source rows), large-result/sort warning preferences, elapsed-time format, and array separator format SHALL be available in extension settings instead of quick preferences. Existing configuration keys, values, enforcement, elapsed-time status, sampling diagnostics, and truncation indicators SHALL remain effective. The notebook quick-settings surface SHALL follow the same classification.

#### Scenario: Existing configured limits
- **WHEN** the quick preferences open with nondefault limit and separator settings
- **THEN** those controls are absent, both decimal controls are present, and the configured limits and separators still apply
- **AND** changing the corresponding extension setting updates affected output without executing q

### Requirement: Independent display-only table precision
Table decimals SHALL accept Auto (the default, preserving current display) or an integer from 0 through 12. Explicit precision SHALL round finite floating-point table values to that number of fractional places, including floating-point elements rendered inside nested cells. Chart decimals SHALL remain independent with its existing default and range. Invalid settings SHALL fall back safely. Formatting SHALL preserve exact source and persisted values, integer identity, q null/infinity tokens, strings, temporal precision, list cardinality, sorting, and existing copy/export behavior.

#### Scenario: Separate precisions
- **WHEN** Table decimals is 2 and Chart decimals is 4
- **THEN** a floating-point table cell containing 1.23456 displays 1.23 and charts use their own precision
- **AND** switching table precision to Auto restores its established representation

#### Scenario: Exact identity survives
- **WHEN** formatted output is sorted, copied, exported, saved, and reopened
- **THEN** its underlying q values remain unchanged and existing copy/export semantics survive
- **AND** integers, q special values, strings, and temporal values are not rounded as floating-point cells

### Requirement: Numeric chart axes use configurable scientific notation
Extension settings SHALL expose a finite positive scientific-notation threshold, default 1000000. Numeric X and Y tick labels with absolute value at or above the threshold SHALL use scientific notation with chart precision; smaller magnitudes SHALL keep existing numeric formatting. Temporal and categorical X labels SHALL retain their established formatting. Axis space SHALL account for formatted label widths and edge labels so values do not clip during render, resize, zoom, or settings changes.

#### Scenario: Default magnitude boundary
- **WHEN** numeric ticks include 999999, 1000000, -1000000, and zero
- **THEN** the million-magnitude ticks use scientific notation while 999999 and zero retain ordinary formatting

#### Scenario: Custom threshold and time axis
- **WHEN** the threshold changes to 10000 on a chart with temporal X and numeric Y
- **THEN** Y ticks at magnitude 10000 or greater use scientific notation, X remains temporal, and labels remain visible
- **AND** invalid, zero, negative, or non-finite threshold values safely use the default

### Requirement: Results and notebook compatibility survives
The fitting and numeric display policies SHALL apply consistently to Results, live notebook output, and saved notebook output. Live fitting SHALL use its authoritative source; saved fitting SHALL use only the exact rows the payload owns. No display change SHALL execute q, create a live binding for saved output, mutate MIME identity, or alter chart sampling, zoom, reset, hidden-series, source guards, or stale-response rejection.

#### Scenario: Saved preview and complete output
- **WHEN** historical preview output or complete MIME v2 output is reopened
- **THEN** fitting and decimals work on its owned data without claiming access to omitted rows or needing a live source

#### Scenario: Settings change during chart refinement
- **WHEN** display settings change while a chart refinement is pending
- **THEN** stale responses remain rejected, hidden-series state survives, and Reset restores the original chart without a query
