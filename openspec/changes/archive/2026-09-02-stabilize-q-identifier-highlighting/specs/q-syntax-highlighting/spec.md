## MODIFIED Requirements

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
