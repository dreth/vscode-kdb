## Why

q identifiers can receive conflicting TextMate and semantic-token roles, so a namespace-qualified value such as `.demo.summary` may change color between its assignment and its reads. Inline lambdas in qSQL/update expressions expose the problem by incorrectly making the surrounding assignment target look callable, while the current tests verify grammar contents rather than the scopes and semantic roles users actually receive.

## What Changes

- Define a consistent, theme-neutral highlighting contract for comments, literals, qSQL words and columns, built-ins, system names, operators, user functions, parameters, locals, globals, and namespace-qualified globals.
- Correct static callable classification so only a lambda assigned as a binding's value makes that binding callable; an inline lambda nested later in an expression does not reclassify the assignment target.
- Propagate a resolved declaration's semantic role to every resolved reference, so a user function stays a function and a user value stays a variable at declaration and use sites.
- Preserve conservative handling for unresolved identifiers and qSQL columns: they retain lexical highlighting without being presented as resolved functions or variables.
- Add scope-level and semantic-token regression fixtures based on realistic q scripts, including repeated namespace assignments, inline lambdas, qSQL, trailing comments, and equivalent `.q`, `.ipynb` q-cell, and `.qnb` q-cell source.
- Keep TextMate highlighting available when the language server is disabled, unavailable, or skips an oversized document; do not hard-code colors, execute q, add `.k` support, or alter formatting, linting, execution, Results, notebook serialization, or saved-output contracts.
- Use an independent clean-room implementation derived from this repository's Apache-licensed q lexer/parser and documented q behavior. Only public behavior from an all-rights-reserved third-party q extension may be used for black-box comparison; its grammar will not be copied or adapted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `q-language-intelligence`: Strengthen lexical and semantic highlighting requirements so equivalent q source has stable semantic roles across standalone and notebook editors, with an activation-free TextMate fallback.

## Impact

- Affected implementation: `language-server/src/parser/language.ts`, `language-server/src/parser/source.ts`, `language-server/src/q-source.ts`, `language-server/src/providers.ts`, the generated `syntaxes/q.tmLanguage.json`, and language-server registration only if the semantic legend must expand.
- Affected verification: q lexer/source-model/provider tests, generated-grammar tests, new real tokenization/scope assertions, language-server protocol tests, and notebook-language equivalence coverage.
- Affected documentation: `mkdocs-src/q-language.md`, generated MkDocs output, and the changelog.
- Compatibility: no setting, command, file-format, IPC, persisted notebook MIME, Results-panel, or q execution contract changes; installed color themes remain responsible for actual colors through standard TextMate scopes and semantic-token types.
