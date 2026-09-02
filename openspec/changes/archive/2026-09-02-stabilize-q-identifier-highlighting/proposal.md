## Why

Release 0.2.28 stabilized each resolved binding's base semantic type, but VS Code still receives different selectors for ordinary q names: declarations add `declaration`/`global` or `local` modifiers, reads use a different modifier set, and unresolved external names receive only the lexical fallback. Themes may therefore render variable-like names purple in one occurrence and white in another even when the source author expects one visual category.

## What Changes

- Give ordinary user data identifiers one exact semantic `variable` selector across definitions, reads, qualified names, repeated assignments, syntactically identifiable write targets, and conservative unresolved/external-name fallback. Styling fallback SHALL remain `variable.other.q`, with no hard-coded foreground color.
- Stop exposing declaration and local/global facts as foreground-affecting semantic modifiers for user bindings. Retain those facts internally for scope, diagnostics, completion, navigation, rename, symbols, and call hierarchy.
- Keep genuinely different q roles distinct: directly assigned lambdas remain functions, explicit/implicit lambda arguments remain parameters, qSQL columns remain properties, and built-ins, documented system names, qSQL words, literals, and operators retain their existing categories.
- Treat generic visual classification separately from static resolution. An unresolved identifier may receive the neutral variable styling category without becoming a resolved declaration/reference or gaining hover, navigation, rename, lint, or inferred callable behavior.
- Add q-specific semantic-to-TextMate fallback mappings through VS Code's supported contribution point and verify the complete emitted selector—not merely the base token type—against realistic `.r.*`, local/global, `::`, assignment-update, qSQL, external-name, and mixed callable/value fixtures.
- Preserve activation-free TextMate highlighting and equivalent behavior in `.q`, q-language `.ipynb` cells, and `.qnb` code cells. Do not change formatting, diagnostics, execution, notebook serialization, Results, live/saved output, connected metadata, or persisted contracts.
- Remove every tracked plaintext reference to the prohibited third-party author identity and package-owner handle, including references in documentation, provenance, changelog entries, tests, scripts, and archived OpenSpec intent. Preserve the underlying clean-room and release-safety constraints using identity-neutral wording, and add a digest-based repository audit that does not store the prohibited plaintext.
- Ship the verified compatibility change as extension version `0.2.29`, including an audited VSIX, changelog/docs updates, a signed-off main-branch commit using the configured repository identity, and the matching release tag.

## Capabilities

### New Capabilities

- `repository-identity-hygiene`: Require tracked repository content to exclude the prohibited third-party identity and handle while retaining generic clean-room provenance and release-audit safeguards.

### Modified Capabilities

- `q-syntax-highlighting`: Require stable complete semantic selectors for ordinary q data identifiers and explicit q-specific TextMate fallback mappings.
- `q-language-intelligence`: Separate theme-neutral identifier styling from proof of symbol resolution while preserving every conservative language-intelligence boundary.

## Impact

- Affected implementation: q source occurrence facts and semantic-token classification in `language-server/src/`, semantic-token contribution metadata in `package.json`, and the generated grammar only if the shared scope registry changes.
- Affected verification: TextMate/semantic fixtures, language-server protocol tests, equivalent notebook-cell coverage, built-in-theme or scope-mapping acceptance, the q-language benchmark, and production package inventory.
- Affected documentation: q-language guidance, changelog, and generated MkDocs output.
- Affected repository hygiene: tracked documentation, provenance, changelog, scripts, tests, and archived OpenSpec artifacts that currently contain identity-specific attribution.
- Compatibility: semantic token selectors for user identifiers change intentionally; no command, setting, IPC behavior, file format, q execution path, result payload, or runtime dependency changes.
- Release: version `0.2.29`, production VSIX inventory/audit, main-branch push, and matching tag push after every required gate passes.

## Non-goals

- Guaranteeing one literal RGB value across third-party themes or overriding user theme customization.
- Presenting qSQL columns, lambda parameters, or statically known functions as ordinary data variables merely to make all identifiers one color.
- Inferring whether an unresolved q name holds a function, table, dictionary, list, or atom at runtime.
- Broadening definition/reference resolution, rename eligibility, diagnostics, or connected-intelligence queries for names that remain unresolved.
- Rewriting existing Git commit objects, tags, or remote history; this change governs tracked repository content and future contributions.
