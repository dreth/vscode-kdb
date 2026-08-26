## Purpose

Defines high-confidence q parse diagnostics and configurable lint findings for `.q` documents and q code cells, including q-only `.qnb` cells, without evaluating source or overwhelming normal editing.

## ADDED Requirements

### Requirement: lexical and structural errors produce precise diagnostics
The language server SHALL report high-confidence lexical and delimiter errors with stable codes, actionable messages, and the smallest useful source range.

#### Scenario: Invalid string escape
- **WHEN** a q string contains an escape other than a supported single-character or three-digit octal escape
- **THEN** an error with code `q.invalid-escape` identifies only the invalid escape

#### Scenario: Unterminated protected range
- **WHEN** a q string or multiline comment is unterminated at the current document version
- **THEN** an error with code `q.unterminated-string` or `q.unterminated-block-comment` identifies the opening token and does not misdiagnose its contents as ordinary q code

#### Scenario: Delimiter mismatch
- **WHEN** a bracket, parenthesis, or brace is unmatched or closed by the wrong delimiter
- **THEN** an error with code `q.unmatched-delimiter` identifies the offending delimiter and, where available, relates it to the opening location

#### Scenario: Valid slash constructs
- **WHEN** source uses slash as division, an iterator, a system-command path, or string content
- **THEN** no comment-related or delimiter diagnostic is emitted merely because a slash is present

### Requirement: the default lint set is conservative and stable
With linting enabled, the server SHALL implement the following default rules and SHALL NOT infer general q types or report unresolved dynamic names as errors:

- `q.deprecated-datetime` as a warning for deprecated `T` datetime literals;
- `q.unused-parameter` as a hint for a statically provable unused explicit lambda parameter;
- `q.unused-local` as a hint for a statically provable unused local assignment;
- `q.declared-after-use` as a warning when the same resolvable lexical binding is first used and only later declared in that scope; and
- `q.unindented-continuation` as a warning when a line that must continue the preceding parsed expression starts at column zero.

#### Scenario: Default findings
- **WHEN** valid source contains one of the listed high-confidence patterns and the applicable rule is enabled
- **THEN** the diagnostic uses the specified stable code and default severity at the relevant token

#### Scenario: Dynamic q constructs
- **WHEN** code uses `value`, `eval`, dynamic namespace lookup, process state, qSQL columns, symbols, or a global that cannot be proven unused
- **THEN** the default rules do not emit speculative undefined-name, type, or unused-global findings

#### Scenario: Shadowed scopes
- **WHEN** a local or parameter shadows an outer name
- **THEN** unused and declaration-order analysis treats the bindings independently

### Requirement: diagnostic policy is configurable
Syntax diagnostics SHALL be enabled whenever the q language server is enabled; linting SHALL be enabled by default and allow each stable lint code to be assigned `error`, `warning`, `information`, `hint`, or `off` at resource scope.

#### Scenario: Disable linting
- **WHEN** `vscode-kdb.languageServer.lint.enabled` is false for a resource
- **THEN** lint findings are cleared while lexical/structural error diagnostics and other language features remain active

#### Scenario: Override one rule
- **WHEN** a workspace configures a supported rule code to a different severity or `off`
- **THEN** subsequent diagnostics for that resource use the configured policy without changing other rules

#### Scenario: Unknown rule setting
- **WHEN** configuration contains an unknown lint rule code or severity
- **THEN** it is ignored safely, the default known-rule policy remains active, and one actionable configuration warning is logged without blocking analysis

### Requirement: source directives suppress only requested lint findings
The linter SHALL recognize `// vscode-kdb-lint-disable-next-line <codes>`, `// vscode-kdb-lint-disable <codes>`, and `// vscode-kdb-lint-enable <codes>` in q comments; suppression SHALL NOT hide lexical or structural errors.

#### Scenario: Disable next line
- **WHEN** a valid disable-next-line directive names one or more lint codes
- **THEN** only those lint findings on the immediately following source line are suppressed

#### Scenario: Disable and re-enable a region
- **WHEN** a disable directive is followed by a matching enable directive
- **THEN** the named lint rules are suppressed only between those directives and resume afterward

#### Scenario: Unknown or malformed code
- **WHEN** a directive names an unknown code or has malformed syntax
- **THEN** known valid codes still apply, unknown text suppresses nothing, and an information diagnostic with code `q.invalid-suppression` identifies the directive

#### Scenario: Syntax error in suppressed region
- **WHEN** a suppressed region contains an unmatched delimiter or unterminated string/comment
- **THEN** the applicable syntax error remains visible

### Requirement: diagnostics follow the current document lifecycle
Diagnostics SHALL be debounced, cancellable, capped, version-gated, and cleared when their source is no longer applicable.

#### Scenario: Normal editing debounce
- **WHEN** a q document changes repeatedly
- **THEN** analysis waits for the default 250 ms quiet period, cancels superseded work, and publishes findings only for the latest document version

#### Scenario: Document closes or feature disables
- **WHEN** a q document closes, the language server is disabled, or linting is disabled
- **THEN** diagnostics owned by the corresponding feature are cleared promptly and stale findings do not remain in Problems

#### Scenario: q-only notebook cell lifecycle
- **WHEN** a `.qnb` code cell is edited, deleted, changed to markdown, or its notebook closes
- **THEN** diagnostics are version-gated to the current q cell and findings for deleted, non-code, or closed cells are cleared promptly

#### Scenario: Diagnostic cap
- **WHEN** a document would produce more than the default 200 diagnostics
- **THEN** only the first 200 in source order are published together with one `q.too-many-diagnostics` information diagnostic explaining that more findings were omitted

#### Scenario: Oversized document
- **WHEN** a document exceeds the configured language-analysis size limit
- **THEN** expensive linting is skipped, previous findings are cleared, and the single large-document explanation defined by q language intelligence is used instead of thousands of Problems entries

### Requirement: diagnostics are advisory, private, and non-blocking
Diagnostic computation SHALL NOT execute q, transmit source or findings as telemetry, persist source text, or prevent any existing execution command.

#### Scenario: Run code with findings
- **WHEN** a document has error, warning, information, or hint diagnostics and the user runs it
- **THEN** the existing command sends the selected source through the existing execution path without a language-server gate

#### Scenario: Diagnostic logging
- **WHEN** diagnostic processing fails internally
- **THEN** the KX output channel receives a bounded redacted failure containing no source text, query text, values, connection credentials, or runtime metadata payload

### Requirement: lint behavior has focused regression coverage
Each stable syntax and lint code, severity override, suppression directive, scope rule, debounce/cancel path, cap, and clear lifecycle SHALL be covered by independently authored deterministic fixtures.

#### Scenario: Diagnostic verification suite
- **WHEN** diagnostic tests run
- **THEN** expected codes, ranges, severities, related locations, suppression results, and stale-result rejection match exactly, including negative fixtures that must produce no finding
