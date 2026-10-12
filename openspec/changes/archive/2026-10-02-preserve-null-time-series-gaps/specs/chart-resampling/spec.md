## ADDED Requirements

### Requirement: Null time-series observations create real gaps
Line and step charts SHALL omit null, non-finite and invalid Y values without replacing them with zero or interpolated values. Their source occurrence SHALL interrupt the series between surrounding finite observations, including observations sharing a normalized temporal X. Results, live notebook and saved notebook charts SHALL derive equivalent gaps from equivalent sources. Genuine numeric zero and negative zero SHALL remain valid observations. Structural missing slots belonging to another group SHALL NOT interrupt a group's valid continuous series.

#### Scenario: Null shares a timestamp with its neighbour
- **WHEN** a null Y occurs between two finite source observations and shares the normalized timestamp of either or both neighbours
- **THEN** line/step plotting leaves a gap rather than drawing a segment across the null
- **AND** finite observations and repeated timestamp ordering remain unchanged

#### Scenario: Series and groups have independent nulls
- **WHEN** one selected series or retained group contains a null while another has finite values
- **THEN** only the affected series has a real discontinuity
- **AND** other-group structural alignment slots do not create false gaps

#### Scenario: Sampling omits a null row
- **WHEN** bounded sampling omits a source null between retained finite observations
- **THEN** its real gap still interrupts line/step drawing
- **AND** the existing exact aligned point budget, extrema and refinement/cache contracts are preserved

#### Scenario: Static notebook fallback
- **WHEN** an ungrouped line/step SVG fallback is generated from saved output containing nulls, non-finite values or empty values
- **THEN** it renders separate finite runs, preserves breaks across omitted sampled rows and never plots a missing value as zero
- **AND** valid zero values, its existing bounded point count and explicit unsupported grouped/family fallback behavior remain intact

#### Scenario: Existing output and actions remain exact
- **WHEN** a chart with nulls is opened, zoomed, panned, reset, saved or reopened
- **THEN** stored table values, types, attributes, keys and identity remain unchanged and no passive action executes q
- **AND** scatter/bar/box/candlestick keep their existing null and family aggregation policies

#### Scenario: Pan introduces a missing stretch
- **WHEN** a compatible temporal pan reuses a gap-free overlap and exposes a new null stretch, including one that starts at the refill boundary
- **THEN** the merged chart preserves the new discontinuity across the missing stretch
- **AND** bounded merge thinning carries any removed break to the next retained finite observation without rescanning source rows in the overlap
