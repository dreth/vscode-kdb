## MODIFIED Requirements

### Requirement: Structural editor features follow parsed q ranges
The extension SHALL provide activation-free, theme-neutral TextMate highlighting for q source, and the server SHALL provide folding ranges, expanding selection ranges, and semantic tokens from parsed q structure. Semantic highlighting SHALL refine the lexical scopes without changing a token to a conflicting semantic role, source-resolution facts SHALL remain separate from generic visual classification, and source-highlighting changes SHALL NOT alter q execution or result presentation.

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
- **WHEN** q source is semantically highlighted
- **THEN** semantic tokens distinguish user functions, parameters, ordinary user data identifiers, read-only built-ins, documented system names, qSQL words, and statically known qSQL columns, while generic visual classification alone does not claim that an identifier is resolved

#### Scenario: Stable complete selector across an ordinary data name
- **WHEN** a local, global, namespace-qualified global, repeated assignment target, syntactically identifiable write target, resolved reference, or conservatively unresolved user data identifier is highlighted
- **THEN** every applicable occurrence receives the exact base `variable` semantic selector without declaration, local, global, or modification modifiers, regardless of the internal scope and resolution facts used by other providers

#### Scenario: Inline lambda does not reclassify its assignment target
- **WHEN** a value assignment such as `.r.stats:update hits:{deltas x & .r.thresholds} each count from .r.stats` contains a nested inline lambda but the assigned expression is not itself a lambda
- **THEN** `.r.stats` remains a variable at that assignment and at every occurrence, while the inline lambda's parameters and locals receive their own roles

#### Scenario: Assigned lambda remains callable
- **WHEN** a binding's assigned expression is statically identifiable as a lambda and later references resolve to that binding
- **THEN** the definition and every resolved reference receive the exact user-function selector without declaration or local/global modifiers

#### Scenario: Parameters remain parameters
- **WHEN** an explicit lambda parameter or statically recognized implicit `x`, `y`, or `z` parameter appears at its definition or use sites
- **THEN** every occurrence receives the exact parameter selector without declaration or local modifiers

#### Scenario: qSQL columns and unresolved identifiers remain conservative
- **WHEN** an identifier is a statically recognized qSQL column or cannot be resolved safely as a source binding
- **THEN** the qSQL column receives a property role, while the unresolved identifier receives only the neutral user-variable visual category and gains no resolved declaration, callable role, navigation, rename eligibility, diagnostic inference, or connected-metadata fact

#### Scenario: Equivalent source surfaces
- **WHEN** equivalent q text is opened as a `.q` document, a q-language cell in `.ipynb`, and a code cell in `.qnb`
- **THEN** the same TextMate categories and complete semantic selectors are produced for the source text on all three surfaces

#### Scenario: Result surfaces remain independent
- **WHEN** highlighted q source is executed into the KX Results panel, live notebook output, or saved notebook output
- **THEN** highlighting metadata does not enter, replace, recolor, or otherwise change the existing result payload and presentation contracts
