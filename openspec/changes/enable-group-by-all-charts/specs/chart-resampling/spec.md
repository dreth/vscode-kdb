## ADDED Requirements

### Requirement: Grouped family charts share one bounded visual-item budget
Grouped bar, box, and candlestick charts SHALL retain their family-specific consolidation and aggregation semantics while counting each rendered category bar, box, or candle as a visual item under the existing 7,000-item ceiling and any stricter family or width-derived bound. A group SHALL NOT receive an independent full ceiling that allows total output to grow by the number of categories. Allocation and reduction across retained groups SHALL be deterministic for identical source, configuration, range, and sampling inputs.

#### Scenario: Grouped candlestick visual budget
- **WHEN** multiple candlestick categories together contain more eligible candles than the active family-specific or 7,000-item ceiling
- **THEN** the returned category candles are deterministically reduced within one shared total budget
- **AND** OHLC aggregation remains independent per category

#### Scenario: Grouped box visual budget
- **WHEN** category and selected-Y combinations would produce more box items than the applicable bound
- **THEN** the returned boxes remain within one shared total budget
- **AND** every retained statistic is calculated only from its own category, Y column, and X bucket

### Requirement: Grouped range and cache behavior remains source-faithful
The selected grouping column and normalized category identity SHALL participate in chart configuration, pan-cache, prepared-result, hidden-series, and stale-response identities. A grouped refill SHALL use the authoritative retained source and the active absolute X range; it SHALL NOT derive omitted category observations from a prior sample. Existing local-versus-refill thresholds for ordinary line, scatter, and step charts SHALL remain unchanged, while family-specific grouped charts SHALL use their established bounded aggregation path.

#### Scenario: Grouping changes after a sampled chart
- **WHEN** the user changes the grouping column on a sampled or refined chart
- **THEN** KX performs a clean build from the authoritative retained source
- **AND** does not reuse a sample or pan cache created for the previous grouping

#### Scenario: Grouped reset
- **WHEN** a grouped chart is refined and then reset
- **THEN** the immutable original grouped chart and full grouped domain are restored without rerunning q

#### Scenario: Grouped diagnostic status
- **WHEN** a grouped family chart is rendered or refined
- **THEN** status distinguishes eligible source rows, retained categories, and returned samples or visual items
- **AND** does not multiply or conflate those counts
