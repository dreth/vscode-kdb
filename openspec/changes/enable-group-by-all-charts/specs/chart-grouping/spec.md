## ADDED Requirements

### Requirement: Every chart family exposes scalar grouping
KX SHALL expose a **Group By** selector for line, scatter, step, bar, box, and candlestick charts in KX Results, live notebook output, and saved notebook output. The selector SHALL offer `None` plus columns whose non-null values have a stable bounded scalar representation, including categorical, boolean, GUID, numeric, and temporal q atoms; it SHALL exclude nested lists, dictionaries, tables, functions, projections, and other complex values. A selected grouping column SHALL be distinct from the active X, Y, and OHLC role columns.

Candidate discovery SHALL use the complete current chartable schema after explicit column hiding, not only the columns or rows currently materialized by horizontal or vertical virtualization. If no eligible grouping column remains, the selector SHALL stay visible but disabled with an explanatory state rather than disappearing for that chart family.

#### Scenario: Numeric line-chart grouping
- **WHEN** a line-chart source has numeric X and Y columns plus a distinct numeric identifier column
- **THEN** the identifier is available in **Group By**
- **AND** rendering produces separate bounded series for its represented group values

#### Scenario: Temporal or categorical grouping
- **WHEN** a chart source has a distinct scalar temporal, symbol, char, boolean, or GUID column
- **THEN** that column is eligible for grouping in every chart family

#### Scenario: Complex column
- **WHEN** a column contains nested or otherwise unsupported values without a stable scalar grouping representation
- **THEN** it is absent from the grouping choices
- **AND** a forged request naming it is rejected without partially rendering a chart

#### Scenario: Off-screen visible column
- **WHEN** an eligible grouping column is explicitly visible but outside the currently virtualized column window
- **THEN** it remains selectable in the Results or notebook chart controls

#### Scenario: No eligible grouping column
- **WHEN** the current chart roles and visible schema leave no distinct eligible grouping column
- **THEN** **Group By** remains visible and disabled with `None` selected
- **AND** the chart can still render ungrouped

### Requirement: Grouped families preserve their chart semantics
Line, scatter, step, and bar grouping SHALL retain their established behavior of splitting each selected Y measure into category series aligned on the shared X domain. Grouped box charts SHALL calculate each selected Y column's statistics independently for each retained category within the applicable X bucket. Grouped candlestick charts SHALL validate and aggregate Open, High, Low, and Close independently per retained category, and SHALL render category candles as distinct clustered series when categories share an X position.

Null, non-finite, or unrepresentable grouping values SHALL NOT be merged into a fabricated category. They SHALL be excluded with an honest bounded warning. Duplicate X values SHALL be handled only within the same retained category and family-specific rules; values from different categories SHALL NOT affect one another's statistics or OHLC envelope. Line, scatter, and step charts SHALL preserve multiple finite observations for the same retained category and normalized X value in stable source-occurrence slots rather than rejecting the whole chart. Their aligned X domain MAY therefore contain repeated X positions, with null slots for categories that have fewer occurrences at that position.

#### Scenario: Grouped box chart
- **WHEN** a box chart groups two categories over the same X bucket and selected Y column
- **THEN** it produces two independently calculated box-statistic items
- **AND** observations from one category do not affect the other's count, quartiles, median, minimum, or maximum

#### Scenario: Grouped candlestick chart
- **WHEN** a candlestick chart groups multiple categories that share X values
- **THEN** each category's OHLC rows are validated and aggregated independently
- **AND** the interactive renderer exposes distinct clustered category candles, legend entries, and tooltips

#### Scenario: Invalid OHLC in one category
- **WHEN** a row violates the candlestick envelope for one group
- **THEN** validation reports that category and row context
- **AND** the system does not silently combine it with another category to form a valid candle

#### Scenario: Missing grouping values
- **WHEN** otherwise chartable rows have null or unsupported values in the selected grouping column
- **THEN** those rows are excluded from grouped items
- **AND** status or warnings report the exclusion without inventing an empty group label

#### Scenario: Repeated X within one ordinary grouped series
- **WHEN** a line, scatter, or step chart has multiple finite Y observations for the same retained category and normalized X value
- **THEN** every observation is retained in stable source order up to the ordinary shared sampling bound
- **AND** the chart renders repeated aligned X occurrence slots instead of failing with a unique-X error

### Requirement: Grouping remains bounded, deterministic, and interactive
Grouping SHALL retain at most 12 categories and at most 36 generated series or family-specific series combinations, using stable first-source-occurrence ordering after the active range and validity rules. When eligible categories or generated combinations exceed those bounds, KX SHALL render the retained subset and report the omitted count. Legend labels, colors, tooltips, hidden-series state, and selection persistence SHALL identify both the source measure or OHLC role and group value without exposing unsafe markup.

Changing **Group By** SHALL mark the chart configuration dirty, invalidate incompatible sampling or pan state, and require the established explicit **Render** action. Compatible zoom, navigator, resize, settings, refresh, and reset flows SHALL preserve category identity and hidden-series state. A stale grouped response SHALL NOT replace a newer grouping, range, configuration, or reset state.

#### Scenario: Group and series caps
- **WHEN** a request would produce more than 12 categories or 36 generated combinations
- **THEN** KX retains a deterministic bounded subset
- **AND** reports the omitted categories or combinations without exceeding either cap

#### Scenario: Group selection changes
- **WHEN** a rendered chart's **Group By** selection changes
- **THEN** the previous chart remains visible but is marked as having unapplied settings until **Render**
- **AND** rendering uses a new configuration identity rather than reusing an incompatible sample or pan cache

#### Scenario: Hidden category survives compatible refresh
- **WHEN** a user hides a grouped series and the chart is compatibly zoomed, resized, refined, reset, or refreshed
- **THEN** the same category/measure series remains hidden

#### Scenario: Stale grouped response
- **WHEN** a response for an older group selection arrives after a newer selection or reset
- **THEN** the older response is rejected without changing the current chart

### Requirement: Results and notebook grouping contracts remain compatible
Equivalent source data and configuration SHALL produce equivalent group eligibility and grouped chart meaning in KX Results, live notebook output, and exact saved notebook output. Portable notebook chart version 1 SHALL accept `groupByColumn` for all six chart types while continuing to accept every previously valid ungrouped or grouped chart. The separately packaged Python companion SHALL emit the same valid contract for grouped box and candlestick charts.

Saved or historical output SHALL group only rows it actually owns and SHALL NOT claim access to omitted source rows. The network-free static HTML fallback MAY continue to omit interactive grouped drawing, but SHALL explicitly identify the chart as grouped and direct the user to the interactive VS Code renderer rather than drawing a misleading ungrouped substitute.

#### Scenario: Results and live notebook parity
- **WHEN** KX Results and a live notebook chart receive equivalent sources and grouped configurations
- **THEN** they expose the same eligible grouping columns, retained categories, family semantics, warnings, and bounds

#### Scenario: Saved grouped box or candlestick specification
- **WHEN** portable version-1 notebook output contains a valid grouped box or candlestick chart
- **THEN** reopening it in the interactive renderer preserves and renders the grouping
- **AND** no MIME version migration is required

#### Scenario: Existing notebook chart
- **WHEN** an existing valid notebook chart omits `groupByColumn` or uses it with line, scatter, step, or bar
- **THEN** validation and rendering remain backward compatible

#### Scenario: Static grouped fallback
- **WHEN** a grouped chart is viewed only through the static HTML fallback
- **THEN** the fallback states that grouped interactive rendering is unavailable
- **AND** does not silently render the data as one ungrouped series

### Requirement: Ungrouped chart behavior remains unchanged
Selecting `None` or omitting `groupByColumn` SHALL retain the existing chart data, geometry, labels, aggregation, sampling, warnings, zoom/refinement, persistence, and export behavior for every chart family. Grouping SHALL remain a client-side presentation operation over the result already owned by the surface and SHALL NOT rewrite or reissue the source q query.

#### Scenario: Group By is None
- **WHEN** any chart family renders with **Group By** set to `None`
- **THEN** its prepared data and visible output match the established ungrouped behavior

#### Scenario: Chart grouping does not rerun q
- **WHEN** the user changes or clears **Group By** for a chart backed by an existing result
- **THEN** KX prepares the chart from that surface's authoritative retained result
- **AND** does not issue the original user query again
