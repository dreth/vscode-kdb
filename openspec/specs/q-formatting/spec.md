# Q Formatting Specification

## Purpose

Defines a conservative q formatter that improves indentation and trivia consistently without changing q evaluation or script-continuation semantics.

## Requirements

### Requirement: q formatting is explicit and available on both source surfaces
The extension SHALL register whole-document and range formatting for `.q` documents, mixed-notebook q cells, and `.qnb` code cells, compatible with VS Code's Format Document, Format Selection, format-on-save, and default-formatter mechanisms.

#### Scenario: Format document
- **WHEN** the user explicitly formats a valid `.q` document or q notebook cell
- **THEN** the extension returns one deterministic set of minimal text edits for that document version

#### Scenario: Format q-only notebook code
- **WHEN** the user explicitly formats a code cell in a `.qnb` notebook
- **THEN** the q formatter applies the same policy as it does to equivalent `.q` text and does not modify markdown cells or notebook-level data

#### Scenario: Format on save
- **WHEN** VS Code format-on-save is enabled and this extension is selected as the q formatter
- **THEN** the same policy used by explicit Format Document is applied before save

#### Scenario: Formatter not selected
- **WHEN** formatting is not invoked and format-on-save does not select this formatter
- **THEN** opening, analyzing, highlighting, or executing q source never reformats it implicitly

### Requirement: formatting preserves q tokens and line semantics
The formatter SHALL preserve every non-trivia token, token order, string, symbol, comment text, system command, newline count, and the distinction between top-level and indented continuation lines.

#### Scenario: Token-equivalent output
- **WHEN** valid q source is formatted
- **THEN** lexing before and after formatting yields the same ordered non-trivia tokens and the formatter changes only permitted indentation or trailing trivia

#### Scenario: Strings, comments, and commands
- **WHEN** source contains escaped strings, line/block comments, formatter directives, or q system commands with paths and arguments
- **THEN** their content remains byte-for-byte unchanged except for an allowed line-leading indent outside the token itself

#### Scenario: Continuation significance
- **WHEN** a line is top-level before formatting or is an indented continuation before formatting
- **THEN** it retains that status after formatting, including right delimiters that q would treat as new expressions if moved to column zero

#### Scenario: Existing line breaks
- **WHEN** formatting source with blank lines or multiline expressions
- **THEN** no line is joined, split, inserted, removed, or reordered and the existing final-newline state is preserved

### Requirement: indentation is structural, configurable, and idempotent
Within the semantic-safety boundary, the formatter SHALL normalize leading indentation from parsed delimiter, lambda, qSQL, and multiline-expression structure using the VS Code formatting options supplied for the request.

#### Scenario: Nested q structure
- **WHEN** valid multiline source contains nested braces, brackets, parentheses, or qSQL clauses
- **THEN** continuation lines receive one configured indentation level per applicable containing structure without unindenting them to top level

#### Scenario: Editor indentation options
- **WHEN** VS Code requests formatting with tabs or spaces and a tab size
- **THEN** the formatter uses those options for indentation it rewrites and does not impose a hidden project-wide tab width

#### Scenario: Internal expression whitespace
- **WHEN** code contains meaningful or stylistic spaces between q tokens on a line
- **THEN** the conservative 0.2.24 formatter leaves that internal whitespace unchanged rather than risking a change to list formation, application, iterator, projection, or qSQL meaning

#### Scenario: Idempotence
- **WHEN** already formatted q text is formatted again with the same options
- **THEN** the second request returns no edits and the text is byte-identical

### Requirement: trailing trivia is changed only when safe
The formatter SHALL remove trailing horizontal whitespace only from parsed code lines where it cannot be part of a string, comment, block-comment delimiter, or system-command argument.

#### Scenario: Code-line trailing spaces
- **WHEN** a normal code line ends with horizontal whitespace outside all protected tokens
- **THEN** that trailing whitespace is removed

#### Scenario: Protected line content
- **WHEN** trailing characters belong to a string, comment, comment delimiter, or system command
- **THEN** the formatter preserves them exactly

### Requirement: range formatting is contained and structurally safe
Range formatting SHALL operate on complete selected lines and SHALL NOT edit outside the requested range unless VS Code's formatting contract explicitly includes an intersecting line boundary.

#### Scenario: Complete selected block
- **WHEN** the selection covers a complete, parseable multiline q block
- **THEN** lines inside the selected range are indented relative to their existing outer context and no line outside the range changes

#### Scenario: Partial protected or ambiguous construct
- **WHEN** the selection starts or ends inside a string, comment block, system command, or structurally incomplete expression
- **THEN** the formatter returns no unsafe edit and explains the skipped range through the KX output channel without modifying the document

### Requirement: formatting can be suppressed locally
The formatter SHALL recognize q comment directives `// vscode-kdb-format-off` and `// vscode-kdb-format-on`, preserving the disabled region exactly.

#### Scenario: Matched suppression region
- **WHEN** a format-off directive is followed by a format-on directive
- **THEN** all bytes from the end of the off-directive line through the start of the on-directive line remain unchanged while eligible surrounding code can be formatted

#### Scenario: Unmatched format-off
- **WHEN** a format-off directive has no later format-on directive
- **THEN** formatting is disabled from that point to the end of the document and no synthetic format-on directive is inserted

#### Scenario: Directive-like string
- **WHEN** directive text occurs inside a q string or non-comment token
- **THEN** it has no effect on formatting

### Requirement: invalid or uncertain source is never rewritten speculatively
The formatter SHALL fail closed when lexical errors, mismatched delimiters, unterminated protected ranges, or an internal token-equivalence check prevent a confident edit.

#### Scenario: Invalid document
- **WHEN** whole-document formatting encounters an unbalanced delimiter, unterminated string/comment, or lexer error outside a suppressed region
- **THEN** it returns no edits and reports the first actionable location without changing the source

#### Scenario: Safety assertion fails
- **WHEN** proposed formatted text changes a non-trivia token sequence or top-level/continuation classification
- **THEN** the entire format operation is discarded, a redacted diagnostic is logged, and source execution remains available

### Requirement: formatter behavior is regression-tested
The formatter SHALL have independently authored golden fixtures for q lambdas, qSQL, comments, system commands, literals, namespaces, projections, iterators, multiline continuations, malformed input, and suppression regions.

#### Scenario: Golden and semantic-safety suite
- **WHEN** formatter verification runs
- **THEN** every fixture matches its expected output, is idempotent, preserves the non-trivia token stream, and keeps each line's top-level-versus-continuation status
