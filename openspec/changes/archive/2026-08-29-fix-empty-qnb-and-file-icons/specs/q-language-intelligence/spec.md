## MODIFIED Requirements

### Requirement: qnb files are compatible, portable JSON
The extension SHALL read and write the established qnb top-level cell-array format in which each cell has `kind`, `language`, `value`, and an array of `{mime, value}` outputs, while accepting optional extension fields and preserving JSON-compatible data it does not own. As the sole bootstrap exception, a zero-byte, BOM-only, or whitespace-only `.qnb` SHALL open as a new, unsaved notebook with one empty q code cell and SHALL become the compatible cell-array format when the user first saves it.

#### Scenario: Open an existing q Professional qnb
- **WHEN** a valid `.qnb` cell array contains q code, markdown, plain-text or HTML output, or `x-application/q-notebook` result output
- **THEN** the extension opens the same ordered cell sources and compatible outputs without requiring another q extension to be installed

#### Scenario: Save in the compatible shape
- **WHEN** a `.qnb` notebook is saved
- **THEN** its top level remains a JSON cell array and each persisted cell retains compatible `kind`, `language`, `value`, and MIME-output fields so a consumer of the established format can recover its core cells and outputs

#### Scenario: Preserve unknown compatible data
- **WHEN** an opened `.qnb` contains JSON-compatible unknown cell fields, output fields, or MIME types
- **THEN** editing and saving unrelated content preserves those fields and values semantically unless the user explicitly deletes the owning cell or output

#### Scenario: Stable round trip
- **WHEN** a valid `.qnb` is opened and saved without notebook edits
- **THEN** the decoded cell order, kinds, sources, q languages, output order, MIME types, values, and unknown compatible data are unchanged even if insignificant JSON whitespace differs

#### Scenario: Blank filesystem-created notebook
- **WHEN** the user creates a zero-byte, BOM-only, or whitespace-only `*.qnb` through Explorer, `touch`, or an equivalent flat-file operation and opens it
- **THEN** VS Code opens the dedicated qnb notebook surface with one empty q code cell, the dedicated direct-q controller available, and the notebook marked dirty so ordinary Save is enabled

#### Scenario: Blank bootstrap persistence
- **WHEN** a blank filesystem-created qnb is opened and then saved
- **THEN** opening alone does not mutate the bytes on disk, while the save writes one empty q cell in the compatible top-level cell-array format, clears the dirty state, and the file reopens identically as a clean notebook

#### Scenario: Invalid JSON is not erased
- **WHEN** a nonblank `.qnb` file is malformed, is not a supported cell array, exceeds a documented safety bound, or contains an unsupported field value that cannot be preserved safely
- **THEN** opening or saving fails visibly with an actionable error and the extension does not replace the file with a new or empty notebook or silently drop the unsupported data

#### Scenario: Newline and empty-source handling
- **WHEN** source text is empty, contains multiple lines, or the compatible file uses any JSON string representation accepted by the format
- **THEN** the editor presents the same source text and a save/reopen cycle preserves its line content and final-newline state

## ADDED Requirements

### Requirement: qnb has a distinct file identity without changing cell language
The extension SHALL associate `.qnb` with a minimal `qnb` language contribution that supplies the qnb artwork for light and dark language-icon fallback, while the existing notebook contribution SHALL continue to own `*.qnb` opening and every qnb code cell SHALL continue to use language identifier `q`.

#### Scenario: qnb Explorer artwork
- **WHEN** VS Code resolves a `.qnb` file and the active file-icon theme permits contributed language icons
- **THEN** Explorer and editor file labels are eligible to display the supplied qnb PNG rather than a generic file icon

#### Scenario: qnb opens as a notebook
- **WHEN** the user opens a blank or valid `.qnb` after the file association is installed
- **THEN** the `vscode-kdb-q-notebook` serializer/controller owns the document and its code cells are q, not `qnb`, Python, or plaintext

#### Scenario: Existing q artwork remains available
- **WHEN** the installed extension version contains the q and qnb icon contributions and the active file-icon theme permits contributed language icons
- **THEN** `.q` remains associated with language `q` and q artwork while `.qnb` uses its distinct qnb artwork

#### Scenario: Theme and unrelated-file precedence
- **WHEN** a selected file-icon theme supplies or suppresses its own icon, or VS Code resolves `.k`, `.ipynb`, Python, Markdown, or another unrelated file
- **THEN** the extension does not override that theme and does not change the unrelated file's language, notebook, or icon association
