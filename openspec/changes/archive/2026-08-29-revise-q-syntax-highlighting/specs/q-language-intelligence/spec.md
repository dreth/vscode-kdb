## MODIFIED Requirements

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
