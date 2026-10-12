## ADDED Requirements

### Requirement: qnb save and reopen preserve valid complete output regardless of serialized file size
The `.qnb` serializer SHALL NOT reject a valid notebook solely because its UTF-8 JSON file exceeds a fixed byte threshold. It SHALL preserve every supported complete Direct IPC output through save and reopen without silently truncating it. Existing structural, UTF-8, JSON, MIME, exact-result, and transient-field safety checks SHALL continue to apply.

#### Scenario: Complete qnb output exceeds the former ceiling
- **WHEN** a valid `.qnb` contains complete first-party q output and its serialized JSON exceeds 16 MiB
- **THEN** Save succeeds when the host can write the file, and reopen restores the complete output and durable identity

#### Scenario: Large existing qnb opens
- **WHEN** a valid existing `.qnb` file exceeds 16 MiB
- **THEN** it opens with its cells and outputs intact rather than failing a fixed file-size check

#### Scenario: Invalid input still fails visibly
- **WHEN** a `.qnb` contains malformed UTF-8 or JSON, an invalid top-level shape, excessive nesting/cell/output counts, or unsafe result content
- **THEN** the existing validation rejects it visibly without replacing it with an empty notebook or truncating its output

#### Scenario: Jupyter persistence remains owned by Jupyter
- **WHEN** the same Direct IPC output is in a mixed `.ipynb`
- **THEN** its complete MIME v2 output continues through the existing Jupyter save and reopen route without a `.qnb` codec byte policy

#### Scenario: Large table save avoids indentation expansion
- **WHEN** a `.qnb` saves a complete table containing many typed cells
- **THEN** its result is written as compact JSON without formatting whitespace proportional to the number of cells
- **AND** reopening restores the same exact cells, schema, metadata, source, and output identity

#### Scenario: Existing indented notebooks remain compatible
- **WHEN** an existing indented `.qnb` is opened and saved with the compact writer
- **THEN** all supported content and unknown fields survive, with only JSON whitespace changed
- **AND** credentials and transient live handles are still removed without mutating in-memory output

#### Scenario: Large result persistence avoids duplicate typed-node allocation
- **WHEN** a large complete typed table is executed or a notebook containing indented MIME output is saved
- **THEN** Direct IPC emits compact MIME JSON and `.qnb` saving validates and writes JSON output without constructing a second complete typed-node tree
- **AND** saved values, durable identity, metadata sanitization, malformed JSON handling, finite-number, field-name, depth, MIME, and UTF-8 validation survive
- **AND** reopening does not deep-copy the freshly parsed output tree before recreating its MIME bytes

#### Scenario: Save diagnostics distinguish serialization from writing
- **WHEN** `.qnb` serialization starts, completes, or fails
- **THEN** the KX output channel records cell count, input/output byte counts, duration, and serialization status without query text, result content, paths, or credentials
- **AND** serialization completion is not reported as confirmation that VS Code finished writing the file

### Requirement: Notebook table scrolling remains at the user's position
The inline result renderer SHALL retain the user's vertical and horizontal table scroll positions as live slices arrive, visible rows change, columns are measured, and compatible output UI refreshes. Live and saved notebook tables SHALL preserve their existing grid, selection, search, sort, paging, and sizing behavior.

#### Scenario: Live table scrolls through virtual slices
- **WHEN** the user scrolls down or across a live Direct IPC table in `.qnb` or `.ipynb` and a new slice or visible-row width measurement arrives
- **THEN** the viewport stays at the requested scroll position and shows the corresponding source rows and columns without jumping toward the top

#### Scenario: Saved table scrolls with visible-row auto-fit
- **WHEN** the user scrolls down or across a saved table while visible-row auto-fit is enabled
- **THEN** widths update for the visible rows without rebuilding or resetting the scroll viewport

#### Scenario: Reopened table remains navigable
- **WHEN** a saved `.qnb` or `.ipynb` output is reopened and its table is scrolled
- **THEN** the saved table remains scrollable while preserving the complete persisted cells

#### Scenario: Results panel remains consistent
- **WHEN** the same q table is opened in KX Results
- **THEN** its panel scrolling, virtualization, and result identity retain the existing behavior

#### Scenario: Live slices overlap autosave
- **WHEN** live table slice or sizing requests arrive while a notebook containing large complete MIME output autosaves
- **THEN** host ownership checks reuse full validation only while the exact output bytes remain unchanged rather than repeatedly parsing the complete result
- **AND** strict current direct/nested metadata, duplicate claims, bounded scans, and notebook/cell/session ownership continue to fail closed
- **AND** byte mutation, output replacement, clearing, and close invalidate reuse; no parsed result tree is retained by the proof cache
- **AND** saved output, legacy/value-backed validation, passive-action q execution policy, and KX Results behavior remain unchanged
