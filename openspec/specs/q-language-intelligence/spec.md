# Q Language Intelligence Specification

## Purpose

Defines offline-first q language intelligence, optional active-process metadata assistance, and the first-party q-only `.qnb` authoring and execution surface.

## Requirements

### Requirement: q language intelligence is offline-first and non-executing
The extension SHALL provide language intelligence for `.q` documents, q-language cells in mixed notebooks, and code cells in `.qnb` notebooks without requiring q, Python, a configured connection, or network access, and offline analysis SHALL NOT execute source text.

#### Scenario: No q runtime or connection
- **WHEN** a user opens q source with no q runtime and no configured KX connection
- **THEN** static completion, hover, signatures, diagnostics, symbols, navigation, folding, selection ranges, semantic tokens, and formatting remain available

#### Scenario: Equivalent q source surfaces
- **WHEN** equivalent q text is opened as a `.q` document, a q cell in `.ipynb`, and a code cell in `.qnb`
- **THEN** offline language features use the same lexical, parse, scope, formatting, and diagnostic contracts on all three surfaces

#### Scenario: Analysis never runs source
- **WHEN** a document opens, changes, saves, or closes
- **THEN** offline language analysis performs no q IPC request, shell command, source evaluation, telemetry submission, or query-history write

#### Scenario: Server failure is isolated
- **WHEN** the q language server fails to start or crashes
- **THEN** query execution, direct IPC, notebooks, Results panels, chart resampling, and grids remain usable and lexical TextMate highlighting remains available

### Requirement: q language tooling has an explicit host baseline
The extension SHALL support VS Code 1.101 and later compatible 1.x releases and SHALL declare that minimum in its extension manifest so the language server always runs on a Node 22-or-newer Extension Host.

#### Scenario: Supported VS Code host
- **WHEN** the extension is installed on VS Code 1.101 or a later compatible 1.x release
- **THEN** installation is allowed and the offline language server starts without requiring a separately installed Node runtime

#### Scenario: Older VS Code host
- **WHEN** a user on VS Code 1.96 through 1.100 views or attempts to install version 0.2.24
- **THEN** Marketplace and VS Code report the host-version requirement instead of installing a language server on an unsupported Node runtime, and extension 0.2.23 remains the compatible fallback

### Requirement: Static q completions are contextual
Completion SHALL include independently maintained q keywords, built-ins, qSQL words, system commands, system namespaces, and documented signatures, filtered by the prefix and syntactic context at the cursor.

#### Scenario: Built-in completion
- **WHEN** the cursor is in q code and the user types a built-in or keyword prefix
- **THEN** matching q entries are offered with a stable kind, concise independently authored detail, signature where applicable, and a link to official q documentation

#### Scenario: Namespace completion
- **WHEN** the user types a prefix such as `.Q.` or `.z.`
- **THEN** completion replaces the complete dotted prefix correctly and offers matching members without duplicating the namespace text

#### Scenario: Non-code context
- **WHEN** the cursor is inside a string, symbol literal, comment, or system-command argument where identifier completion is invalid
- **THEN** unrelated q identifier completions are not offered

### Requirement: Source identifiers are indexed with q scope rules
The server SHALL resolve explicit lambda parameters, implicit `x`/`y`/`z` parameters, locals, globals, namespace-qualified names, loaded workspace q files, and statically identifiable function definitions without treating qSQL columns or symbol values as ordinary variables.

#### Scenario: Local scope completion
- **WHEN** completion is requested inside a lambda
- **THEN** visible explicit parameters, applicable implicit parameters, locals declared before the cursor, and accessible globals are offered while shadowed outer locals are excluded

#### Scenario: Workspace completion
- **WHEN** an identifier is defined in an indexed `.q` file reachable from the current workspace or a statically resolved load/module reference
- **THEN** it is available with its qualified name and source location

#### Scenario: qSQL and symbols
- **WHEN** source contains qSQL column names or backtick symbol values
- **THEN** those tokens are not incorrectly indexed as variable declarations or references

### Requirement: Hover and signature help explain resolvable q constructs
Hover and signature help SHALL cover the static q reference catalog and statically resolved user functions, while clearly distinguishing known information from unknown dynamic behavior.

#### Scenario: Built-in hover
- **WHEN** the user hovers a recognized q built-in, system namespace member, or system command
- **THEN** the extension shows its q spelling, signature or rank where known, a concise independently authored summary, and an official documentation link

#### Scenario: User-function signature
- **WHEN** a call resolves to a lambda with explicit or implicit parameters
- **THEN** signature help shows those parameters and tracks the active argument for bracket calls without inventing a return type

#### Scenario: Dynamic or unresolved value
- **WHEN** a target cannot be resolved statically
- **THEN** hover/signature help returns no result or explicitly labels bounded runtime metadata; it does not guess a semantic type

### Requirement: Source navigation and symbols are scope-safe
The server SHALL provide document highlights, document symbols, workspace symbols, definitions, references, and call hierarchy for statically resolved q identifiers and calls.

#### Scenario: Definition and references
- **WHEN** a user requests definition or references for a resolvable local, parameter, global, or qualified workspace identifier
- **THEN** returned locations respect q lexical scope, namespace qualification, shadowing, and the user's include/exclude workspace settings

#### Scenario: Document and workspace symbols
- **WHEN** the user opens Outline or searches workspace symbols
- **THEN** statically defined globals, functions, and nested local scopes are returned with stable names, kinds, ranges, and containers

#### Scenario: Call hierarchy
- **WHEN** a function call and its target are both statically resolved
- **THEN** incoming and outgoing call hierarchy items identify the correct call sites; dynamic calls are omitted rather than guessed

#### Scenario: Comments and literals are excluded
- **WHEN** an identifier-shaped word appears only in a comment, string, or symbol literal
- **THEN** it is not returned as a definition, reference, highlight, workspace symbol, or call

### Requirement: Rename changes only the resolved symbol
Rename SHALL validate the requested q name and edit only references belonging to the selected resolved declaration.

#### Scenario: Scoped rename
- **WHEN** a user renames a local or workspace declaration to a valid q identifier or qualified name
- **THEN** VS Code previews edits for that declaration and its resolved references without changing shadowed names, comments, strings, symbols, qSQL columns, or unrelated server objects

#### Scenario: Invalid rename
- **WHEN** the requested name is empty, reserved, syntactically invalid, or incompatible with the declaration's namespace form
- **THEN** rename is rejected with an actionable explanation and no edits

#### Scenario: Ambiguous dynamic reference
- **WHEN** the server cannot prove which declaration a reference denotes
- **THEN** that reference is excluded from rename rather than edited speculatively

### Requirement: Structural editor features follow parsed q ranges
The extension SHALL provide activation-free, theme-neutral TextMate highlighting for q source, and the server SHALL provide folding ranges, expanding selection ranges, and semantic tokens from parsed q structure. Semantic highlighting SHALL refine the lexical scopes without changing a token to a conflicting semantic role, and source-highlighting changes SHALL NOT alter q execution or result presentation.

#### Scenario: Lexical highlighting roles
- **WHEN** q source contains comments, strings and escapes, symbols, numeric or temporal literals, qSQL words, built-ins, system names, operators, delimiters, and user identifiers
- **THEN** each recognized category receives a stable standard TextMate scope, user identifiers retain an identifier scope, and the grammar contains no hard-coded foreground color

#### Scenario: Activation-free lexical fallback
- **WHEN** the q language server is disabled, unavailable, crashed, or skips an oversized document
- **THEN** `.q` documents, q-language `.ipynb` cells, and `.qnb` code cells retain the same lexical TextMate categories without requiring q, Python, a connection, or extension-host analysis

#### Scenario: Folding
- **WHEN** a document contains multiline lambdas, parenthesized/bracketed expressions, qSQL blocks, or multiline comments
- **THEN** VS Code offers non-overlapping folding ranges that do not hide unrelated following expressions

#### Scenario: Expanding selection
- **WHEN** the user expands selection within a q token or nested expression
- **THEN** each returned range contains the previous range and progresses through token, expression, scope, and document boundaries where known

#### Scenario: Semantic roles
- **WHEN** declarations and references are resolved
- **THEN** semantic tokens distinguish user functions, parameters, local/global variables, declarations, read-only built-ins, documented system names, qSQL words, and statically known qSQL columns without coloring unresolved text as resolved

#### Scenario: Stable role across a resolved binding
- **WHEN** a local, global, namespace-qualified global, parameter, or user function has one statically resolved declaration and one or more references
- **THEN** every occurrence receives the declaration's same base semantic role, with modifiers allowed to describe declaration or read-only status without replacing that role

#### Scenario: Inline lambda does not reclassify its assignment target
- **WHEN** a value assignment such as `.r.stats:update hits:{deltas x & .r.thresholds} each count from .r.stats` contains a nested inline lambda but the assigned expression is not itself a lambda
- **THEN** `.r.stats` remains a variable at that declaration and at every resolved reference, while the inline lambda's parameters and locals receive their own roles

#### Scenario: Assigned lambda remains callable
- **WHEN** a binding's assigned expression is statically identifiable as a lambda and later references resolve to that binding
- **THEN** the declaration and every resolved reference receive the user-function role

#### Scenario: qSQL columns and unresolved identifiers fail closed
- **WHEN** an identifier is a statically recognized qSQL column or cannot be resolved safely as a source binding
- **THEN** the qSQL column receives a column/property role when known and the unresolved identifier retains lexical identifier highlighting, but neither is mislabeled as a resolved user function or variable

#### Scenario: Equivalent source surfaces
- **WHEN** equivalent q text is opened as a `.q` document, a q-language cell in `.ipynb`, and a code cell in `.qnb`
- **THEN** the same TextMate categories and semantic roles are produced for the source text on all three surfaces

#### Scenario: Result surfaces remain independent
- **WHEN** highlighted q source is executed into the KX Results panel, live notebook output, or saved notebook output
- **THEN** highlighting metadata does not enter, replace, recolor, or otherwise change the existing result payload and presentation contracts

### Requirement: Connected intelligence is explicit, bounded, and stale-safe
Active-process completion and hover SHALL be controlled by `vscode-kdb.languageServer.connectedIntelligence`, disabled by default, and limited to metadata from the active connected direct-q profile.

#### Scenario: Feature disabled
- **WHEN** connected intelligence is disabled
- **THEN** opening, editing, or completing q source performs no metadata query and offline intelligence remains unchanged

#### Scenario: Connected objects
- **WHEN** connected intelligence is enabled and an active direct-q profile is connected
- **THEN** completion may include bounded current-namespace tables, functions, variables, and table columns, labeled as runtime metadata and never including object values or credentials

#### Scenario: qSQL column completion
- **WHEN** a qSQL clause statically identifies a table whose cached metadata includes columns
- **THEN** matching column names are offered in column-valid positions and are labeled with their q metadata types

#### Scenario: Active connection changes
- **WHEN** the active connection, namespace, connection generation, or setting changes while metadata is loading
- **THEN** the response from the old snapshot is discarded, old entries disappear, and no result is attributed to the new connection

#### Scenario: Metadata failure
- **WHEN** the profile is disconnected, a metadata request times out, is canceled, exceeds its configured cap, or returns an unexpected shape
- **THEN** the request fails closed to offline intelligence, reports a redacted diagnostic once, and does not block completion or source editing

#### Scenario: Explicit refresh
- **WHEN** the user runs `KX: Refresh q Language Metadata`
- **THEN** the cache for the current active connection snapshot is invalidated and safely reloaded without previewing values

### Requirement: Workspace analysis is bounded and cancellable
Workspace indexing SHALL be lazy, versioned, cancellable, and restricted to configured q source globs inside workspace folders, excluding generated/vendor directories by default.

#### Scenario: Default workspace bounds
- **WHEN** indexing begins with default settings
- **THEN** it considers `**/*.q`, excludes `.git`, `node_modules`, `out`, `dist`, and `build`, does not follow a source file outside the workspace except an explicitly resolved q module path, and stops at 5,000 files

#### Scenario: Document edit wins over stale work
- **WHEN** a document changes while parsing, indexing, or a provider request is in flight
- **THEN** results for an older document version are canceled or discarded and never replace results for the current version

#### Scenario: Oversized document
- **WHEN** a q document exceeds the default 2 MiB analysis limit
- **THEN** lexical highlighting and execution remain available, expensive language-server features are skipped for that document, and the user receives one non-repeating explanation with the setting that controls the limit

### Requirement: qnb is a first-party q-only notebook
The extension SHALL contribute `*.qnb` as a dedicated VS Code notebook type whose code cells are q, whose non-executable cells are markdown, and whose only controller supplied or automatically selected by this extension is the dedicated direct-IPC q controller.

#### Scenario: Create a q notebook
- **WHEN** the user creates or saves a new q notebook through the extension or chooses the `.qnb` notebook type
- **THEN** VS Code opens a notebook with q as the language of every code cell, markdown available for narrative cells, and the dedicated q controller available without additional configuration

#### Scenario: q controller is independent of the Jupyter opt-in
- **WHEN** `vscode-kdb.notebook.enableDirectController` is false
- **THEN** the `.qnb` q controller remains registered and executable while the optional direct-q controller for `jupyter-notebook` remains disabled

#### Scenario: Code cell language is normalized
- **WHEN** a `.qnb` file contains a code cell with a missing or non-q language field, or a user inserts a new code cell
- **THEN** the extension presents and persists that code cell as q without changing markdown cells into code

#### Scenario: No Python or cell magic path
- **WHEN** a `.qnb` code cell is executed
- **THEN** the extension sends ordinary q source only through the active direct-q connection, never invokes Python or a Jupyter kernel, and rejects `%%q` because a q-only cell needs no mixed-notebook magic

#### Scenario: No active q connection
- **WHEN** the user executes a `.qnb` code cell without a usable active direct-q profile
- **THEN** execution fails with the same actionable connection guidance as existing direct-q notebook execution and the source and saved outputs remain intact

#### Scenario: Markdown is never executed
- **WHEN** Run All or an individual run command encounters a markdown cell in `.qnb`
- **THEN** the q controller does not send that cell to q and does not replace its content or attachments

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

### Requirement: qnb reuses the complete direct-q notebook result contract
Executing q in `.qnb` SHALL use the same execution, output conversion, durable MIME v2 identity, renderer, result actions, stale-response protection, and cancellation contracts as a direct-q cell in `.ipynb`.

#### Scenario: Rich live result parity
- **WHEN** q execution in `.qnb` returns any supported atom, vector, list, dictionary, table, keyed table, temporal, null, infinity, nested value, error, text, or byte result
- **THEN** its live output has the same exact q identity and the same grid, chart, text, error, export, copy, clear, and rerun behavior as the equivalent direct-q `.ipynb` result

#### Scenario: Save and reopen rich output
- **WHEN** a `.qnb` containing a supported rich result is saved, closed, and reopened without the original extension-host session
- **THEN** the durable MIME payload restores the same supported q value identity and saved grid/chart behavior, while transient live handles and stale request identities are not revived

#### Scenario: Legacy q Professional output
- **WHEN** an existing `.qnb` contains a recognized `x-application/q-notebook` result value
- **THEN** the extension renders or losslessly preserves the compatible result with an explicit fallback for unsupported shapes instead of silently discarding it

#### Scenario: List-grid behavior
- **WHEN** a `.qnb` result is a q list in grid mode
- **THEN** multi-element lists use the existing index-and-element grid contract and a one-element list such as `enlist 4` is shown as one cell, exactly as required on the other result surfaces

#### Scenario: Chart resampling behavior
- **WHEN** a `.qnb` result is charted, zoomed, or panned
- **THEN** every series follows the existing 7,000/3,000 resampling, zoom re-refinement, and pan sampling-reuse contract without a notebook-specific sampling policy

#### Scenario: Interrupt and stale completion
- **WHEN** a `.qnb` execution is interrupted, rerun, deleted, cleared, or completes after its cell or connection generation changed
- **THEN** the same current-source, execution-order, cancellation, clear, and stale-result protections used by existing direct-q notebook cells apply

### Requirement: mixed-language ipynb behavior remains independent
Adding `.qnb` SHALL NOT turn existing `.ipynb` notebooks into q-only notebooks or alter their serializer, kernel selection, cell-language commands, Python companion, or controller defaults.

#### Scenario: Existing ipynb opens
- **WHEN** a mixed-language `.ipynb` is opened after `.qnb` support is installed
- **THEN** it remains a `jupyter-notebook`, preserves its existing Python-first and per-cell language behavior, and does not get rewritten into the `.qnb` cell-array format

#### Scenario: Existing q cell commands
- **WHEN** the user invokes Make q Cell, Restore Notebook Cell, Tag for Python, or Prepare Python in `.ipynb`
- **THEN** those commands retain their existing behavior, while language-switching and Python-preparation commands are not offered for q-only `.qnb` code cells

#### Scenario: Controller settings remain scoped
- **WHEN** the user enables or disables the optional Jupyter direct controller
- **THEN** only the `jupyter-notebook` controller registration changes and the dedicated `.qnb` controller and saved notebook remain unaffected

### Requirement: Existing execution and persisted contracts remain unchanged
Language tooling SHALL be advisory and SHALL NOT alter the source selected for execution or any existing result/notebook contract.

#### Scenario: Run source after using language features
- **WHEN** a user invokes an existing run-selection, run-line, run-script, notebook-cell, or query-history command
- **THEN** the existing execution path receives the editor text exactly as it exists after any explicitly accepted rename or format edit, with no hidden language-server transformation

#### Scenario: Existing result behavior
- **WHEN** q execution returns any supported value after language tooling is installed
- **THEN** q value identity, Results panel and notebook rendering, persisted MIME v1/v2, chart resampling, pan/zoom behavior, and q-list grid behavior continue to follow their existing specifications
