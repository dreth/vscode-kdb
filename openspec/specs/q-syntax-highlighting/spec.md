# Q Syntax Highlighting Specification

## Purpose

Defines reliable q lexical highlighting and editing behavior shared by standalone q source documents, mixed-notebook q cells, and q-only `.qnb` code cells.

## Requirements

### Requirement: q source surfaces use the same lexical contract
The extension SHALL apply the same q token boundaries and scope categories to `.q` documents, mixed-notebook code cells whose language identifier is `q`, and every code cell in a `.qnb` notebook.

#### Scenario: Standalone q document
- **WHEN** a user opens a file with the `.q` extension
- **THEN** VS Code identifies it as q and applies the first-party q grammar and language configuration

#### Scenario: q notebook cell
- **WHEN** a Jupyter notebook code cell has the language identifier `q`
- **THEN** the cell receives the same q token scopes as equivalent text in a `.q` document

#### Scenario: q-only notebook code cell
- **WHEN** a user creates or opens a code cell in a `.qnb` notebook
- **THEN** the cell is identified as q and receives the same token scopes and language configuration as equivalent text in a `.q` document

#### Scenario: q-only notebook markdown cell
- **WHEN** a `.qnb` cell is a markdown cell
- **THEN** it remains markdown and is not reclassified or highlighted as q source

#### Scenario: Result text remains a separate surface
- **WHEN** qText is shown in a Results panel, live notebook result, or saved notebook result
- **THEN** its existing presentation and `vscode-kdb.results.qText.syntaxHighlighting` policy remain unchanged by source-language highlighting

### Requirement: q lexical constructs are classified accurately
The grammar SHALL distinguish q comments, block comments, system commands, strings and escapes, symbols, temporal and numeric literals, control words, qSQL words, built-ins, system namespaces, identifiers, punctuation, iterators, and overloaded operators without consuming adjacent source tokens.

#### Scenario: Trailing and whole-line comments
- **WHEN** `/` occurs outside a string at the start of a line or after horizontal whitespace
- **THEN** the slash and remainder of that line are highlighted as a comment

#### Scenario: Slash remains an operator when appropriate
- **WHEN** `/` is part of an expression such as `+/`, `2/3`, or an iterator and is not preceded by comment-introducing whitespace
- **THEN** it is highlighted as an operator or iterator rather than a comment

#### Scenario: System command path is not a comment
- **WHEN** a line contains a q system command such as `\l /data/file.q`
- **THEN** the command and its argument remain a system command and the slash in the path does not start a comment

#### Scenario: Strings shield q syntax
- **WHEN** a string contains slashes, backslashes, symbols, keywords, or escaped quotes
- **THEN** those characters remain within the string scope and valid q escapes receive an escape scope

#### Scenario: Literal and namespace coverage
- **WHEN** source contains q atoms or vectors using supported numeric suffixes, nulls, infinities, GUID/byte data, temporal types, symbols, `.Q`, `.q`, `.z`, or user namespaces
- **THEN** each complete token receives its applicable literal, system, or namespace scope without coloring neighboring identifiers

### Requirement: Script-only ranges are recognized without corrupting following code
The grammar SHALL recognize q multiline-comment delimiters and script-exit lines only in their valid line-oriented positions, and SHALL recover highlighting after malformed or incomplete input.

#### Scenario: Multiline comment
- **WHEN** a script line containing only `/` begins a comment block and a later line containing only `\` ends it
- **THEN** the enclosed lines are highlighted as a block comment and later source resumes normal q highlighting

#### Scenario: Script exit
- **WHEN** a line containing only `\` occurs outside a block comment
- **THEN** it is highlighted as a script-exit/system construct rather than as a block-comment terminator

#### Scenario: Incomplete source recovery
- **WHEN** an unterminated string, comment, or delimiter is followed by additional edited lines
- **THEN** highlighting remains deterministic and resumes at the earliest lexically valid boundary instead of corrupting the entire document

### Requirement: Semantic and TextMate scopes do not fight
Semantic highlighting SHALL refine q roles while preserving the lexical boundaries established by the TextMate grammar. Every ordinary user data identifier SHALL use the same complete semantic `variable` selector without declaration, local, global, or modification modifiers, while static-resolution facts remain available internally to language features that require proof of identity.

#### Scenario: Semantic highlighting enabled
- **WHEN** a theme enables semantic highlighting for q source
- **THEN** only complete identifier ranges and recognized catalog tokens are semantically classified, while strings, comments, literals, punctuation, and neighboring source keep their lexical scopes

#### Scenario: Stable ordinary data identifier
- **WHEN** an ordinary q data name appears as a `:` definition, `::` or augmented write target, local or global assignment, namespace-qualified assignment, repeated assignment, resolved read, or read before its statically known definition
- **THEN** every occurrence receives the exact `variable` semantic selector with no declaration, local, global, or modification modifier that could cause the theme to recolor one occurrence differently

#### Scenario: Conservative unresolved identifier styling
- **WHEN** an ordinary identifier such as an external namespace-qualified name cannot be resolved to one source declaration
- **THEN** it receives the same neutral `variable` visual category and q-specific TextMate fallback as ordinary data identifiers, but it remains unresolved for hover, definition, references, rename, call hierarchy, and lint analysis

#### Scenario: Distinct q roles remain distinct
- **WHEN** a token is a directly assigned user lambda, explicit or implicit lambda parameter, statically recognized qSQL column, built-in, documented system name, qSQL word, literal, or operator
- **THEN** it retains its applicable function, parameter, property, default-library, keyword, literal, or operator role instead of being flattened into the ordinary data-variable category

#### Scenario: q-specific semantic fallback scopes
- **WHEN** a semantic token has no matching explicit rule in the active theme
- **THEN** VS Code can resolve its q-specific fallback through contributed `semanticTokenScopes`, and the ordinary `variable` token maps to the same `variable.other.q` scope used by activation-free lexical highlighting

#### Scenario: Semantic highlighting disabled
- **WHEN** semantic highlighting is disabled or the language server is unavailable
- **THEN** the TextMate grammar still provides complete lexical highlighting without requiring extension-host activation or a q runtime

### Requirement: q editor configuration is syntax-safe
Comment toggling, word selection, bracket pairing, quote pairing, and indentation triggers SHALL follow q token and script-continuation rules.

#### Scenario: Toggle line comment
- **WHEN** the user toggles line comments on one or more q lines
- **THEN** VS Code inserts or removes `/` at a position that produces valid q comments and does not rewrite expression-internal slash operators

#### Scenario: Pair insertion
- **WHEN** the user types an opening bracket, parenthesis, brace, or quote outside an excluded string/comment context
- **THEN** VS Code inserts the matching pair and word navigation continues to treat dotted q names as one identifier

#### Scenario: Closing delimiter continuation
- **WHEN** a closing delimiter belongs to a multiline q expression
- **THEN** indentation behavior keeps it within the continuation instead of forcing it to column zero, where q would treat it as a new expression

### Requirement: Highlighting is theme-compatible and independently verified
The extension SHALL use standard TextMate and semantic token categories without hard-coded colors, and SHALL test the grammar against independently authored q fixtures derived from public q syntax documentation.

#### Scenario: Built-in themes
- **WHEN** source is viewed with VS Code light, dark, or high-contrast built-in themes
- **THEN** all q categories inherit theme colors and remain distinguishable without extension-defined foreground colors

#### Scenario: Grammar regression fixture
- **WHEN** the grammar verification suite tokenizes its canonical q fixture corpus
- **THEN** every expected range and scope matches and the suite detects accidental drift between lexical highlighting and language-server token boundaries
