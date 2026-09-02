## 1. Lock the highlighting and hygiene regressions

- [x] 1.1 Add realistic q fixtures covering `:`, `::`, augmented writes, destructuring, local/global and namespace-qualified names, repeated assignment, read-before-definition, unresolved external names, qSQL names, directly assigned lambdas, inline lambdas, parameters, and mixed callable/value bindings.
- [x] 1.2 Make semantic-token tests compare every complete `{type, modifiers}` selector in the fixtures and require identical unmodified `variable` selectors for ordinary data names while retaining function, parameter, property, catalog, literal, and operator distinctions.
- [x] 1.3 Add negative language-intelligence tests proving generic styling does not give unresolved names hover, definition, references, rename, call hierarchy, callable inference, connected metadata, or new diagnostics.
- [x] 1.4 Add `.q`, q-language `.ipynb`, and `.qnb` virtual-document equivalence tests plus assertions that highlighting metadata never enters Results, live notebook output, or saved notebook output.
- [x] 1.5 Add manifest/grammar contract tests for q-specific semantic fallback scopes and a repository-hygiene scanner test using harmless canary digests and formatting variants.

## 2. Stabilize q semantic selectors

- [x] 2.1 Update semantic classification so every parser-recognized ordinary identifier not claimed by qSQL, parameter, callable, or catalog precedence receives the neutral `variable` role, including unresolved and syntactically identifiable write occurrences.
- [x] 2.2 Stop emitting declaration, local, global, or modification modifiers for user variables, functions, and parameters while preserving declaration, scope, binding, and callability facts for all non-highlighting providers.
- [x] 2.3 Preserve deterministic non-overlapping range precedence for qSQL properties, lambda parameters, assigned functions, variables, and catalog tokens, including oversized-document fallback and linear-time behavior.
- [x] 2.4 Contribute language-specific `semanticTokenScopes` mappings for q variables, functions, parameters, and properties, aligned with the shared q TextMate scope registry and without hard-coded colors.

## 3. Enforce identity-neutral repository content

- [x] 3.1 Implement a tracked-text hygiene audit that normalizes case, punctuation, separators, and short adjacent-token windows, compares only cryptographic digests for prohibited forms, and never stores or prints the prohibited plaintext.
- [x] 3.2 Replace every prohibited identity/handle occurrence in tracked source, tests, scripts, documentation, provenance, changelog entries, generated docs, and archived OpenSpec artifacts with identity-neutral wording or package-family checks.
- [x] 3.3 Keep the release audit's clean-room, prohibited package-family, unexpected-file, and runtime-inventory protections intact without owner-qualified paths, then add the hygiene audit to the normal test and release gates.

## 4. Document and verify the implementation

- [x] 4.1 Update q-language documentation and `CHANGELOG.md` to explain stable role selectors, unresolved-name visual fallback, the theme-controlled color boundary, and preserved language-intelligence behavior; regenerate `docs/` through the documented MkDocs workflow.
- [x] 4.2 Run focused parser/highlighting, language-server provider/protocol, manifest/grammar, notebook-surface, repository-hygiene, release-audit, and documentation tests and resolve all failures.
- [x] 4.3 Run the fixed q-language benchmark and oversized-document cases, recording that token volume, latency, determinism, and fallback bounds remain within the established contract.
- [x] 4.4 Run `npm test`, the real Extension Host semantic-token gate, the MkDocs strict build/link checks, and any additional repository validation required by the affected scripts.
- [x] 4.5 Re-scan every tracked text file for the prohibited digests and verify that no generated, archived, packaged, or ignored build input can reintroduce identity-specific plaintext.

## 5. Package and publish version 0.2.29

- [x] 5.1 Bump all synchronized extension version metadata to `0.2.29` without changing notebook companion or persisted payload contracts unnecessarily.
- [x] 5.2 Build the production `0.2.29` VSIX, inspect its inventory, run the production-install/package audit, and verify q highlighting in `.q`, `.ipynb`, and `.qnb` through the packaged extension.
- [x] 5.3 Validate the completed OpenSpec change, mark every completed task accurately, sync/archive it according to the repository workflow, and confirm the working tree contains only intended release changes and the audited VSIX artifact.
- [x] 5.4 Configure the requested Git author identity, commit the verified `0.2.29` changes on `main`, create the matching release tag, and push both `main` and the tag to the configured remote.
