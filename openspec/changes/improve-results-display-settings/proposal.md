## Why

Enabling autofit can leave columns unchanged because persisted manual widths win over automatic sizing. The Results quick settings also mix frequent display choices with guardrails, while table decimals lack their own control and large chart tick labels can clip.

## What Changes

- Make explicitly enabling autofit clear manual widths for the current result's column positions and immediately fit headers and formatted data using the selected scope. Preserve manual resizing after fitting and ordinary persistence/reload behavior.
- Provide an explicit **Fit now** action in Results and notebook settings so an already-enabled autofit can be reapplied to the current columns without an off/on toggle.
- Make checked auto-fit default to the currently displayed rows and measure the actual rendered text, not a worst-case character count. Preserve explicit whole-result fitting as an opt-in and manual widths when auto-fit is off.
- Move limit/threshold controls, warning preferences, elapsed-time format, and array separator format out of Results quick preferences into extension settings; retain their values and enforcement. Keep elapsed-time status itself visible.
- Keep separate Table decimals and Chart decimals in quick preferences and extension settings. Table precision is display-only, with an unchanged-precision default.
- Add a shared numeric chart-axis scientific-notation magnitude threshold, default 1e6, configurable in extension settings. Apply at or above the threshold to positive and negative numeric X/Y ticks; preserve temporal X formatting and measure labels to prevent clipping.

## Capabilities

### New Capabilities
- `results-display-settings`: Autofit activation, quick preferences, independent precision, and readable numeric chart axes across Results and notebook renderers.

### Modified Capabilities
None. Chart resampling and q-list-grid requirements remain intact.

## Impact

Affected: package configuration, Results panel, shared result settings and formatting/sizing helpers, notebook settings messages and renderer, tests, README, changelog, and documentation source/generated output. No new dependency or notebook MIME version is intended. Existing chart precision and all moved settings retain their keys and values.

Preserve exact q values, typed nulls/infinities, temporal precision, list cardinality, sorting, copy/export, source guards, sampling density, reset/stale-response handling, and source-bounded saved notebooks. Non-goals: changing query execution, sampling algorithms, notebook retention, exported numeric precision, or removing elapsed-time and truncation diagnostics. Concurrent runtime-sidebar and unlimited-output changes must remain untouched.
