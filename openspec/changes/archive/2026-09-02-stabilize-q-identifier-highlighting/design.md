## Context

See `proposal.md` for the user-visible problem and both delta specs for the revised contract. Release 0.2.28 correctly groups a resolved binding under one base type, but `qSemanticTokens` still emits different complete selectors: definitions add `declaration` plus `local` or `global`, references omit `declaration`, and unresolved names receive no semantic token. The independently authored fixture demonstrates all four paths: `.demo.summary` definitions are `variable.declaration.global`, its reads are `variable.global`, `.service.fetch` is lexical-only, and qSQL columns are `property`.

VS Code themes match the full semantic selector and may attach a foreground color to a type/modifier combination. The platform then falls back from semantic types to standard TextMate scopes only when no explicit semantic rule matches. Consequently, equal base types do not guarantee equal visible styling. VS Code supports language-specific fallback mappings through `contributes.semanticTokenScopes`; it does not provide a theme-neutral mechanism for an extension to force one RGB value, and this extension must not hard-code colors.

The shared sources of truth are the parser/source occurrence facts and `language-server/src/highlighting.ts`. Downstream consumers are the generated TextMate grammar, the full-document semantic-token provider and legend, manifest fallback contributions, `.q` and notebook virtual documents, documentation, tests, and the fixed language benchmark. Results panels and live/saved notebook output consume none of this metadata and remain compatibility boundaries rather than implementation targets.

## Goals / Non-Goals

**Goals:**

- Make every ordinary q data identifier use one exact semantic selector regardless of definition/reference position, local/global scope, qualification, or conservative lack of resolution.
- Preserve accurate distinct roles for statically known functions, parameters, qSQL columns, catalog entries, literals, and operators.
- Keep resolution facts available to navigation, rename, diagnostics, completion, symbols, and call hierarchy without exposing those facts as foreground-affecting modifiers.
- Align the semantic fallback for ordinary variables with the activation-free `variable.other.q` TextMate scope on all q source surfaces.
- Keep classification linear, deterministic, full-document, and non-executing.
- Remove prohibited third-party identity/handle references from all tracked content without weakening clean-room provenance or release auditing, and prevent their reintroduction without storing the plaintext in the repository.

**Non-Goals:**

- Forcing an RGB color or overriding a user's theme and semantic-token customization.
- Making qSQL columns, parameters, or known lambdas visually identical to ordinary data variables.
- Inferring the runtime type or callability of an unresolved q name.
- Expanding symbol resolution, connected metadata, lint inference, rename, or call hierarchy.
- Changing formatting, execution, Results, notebook serialization, MIME payloads, renderer state, or saved output.
- Rewriting existing Git commit objects, tags, or remote history.

## Decisions

### 1. Separate visual fallback from source resolution

Every parser-recognized ordinary `Identifier` occurrence that is not a catalog word or qSQL column will receive a semantic role. Resolved parameters and consistently assigned lambdas keep their specialized roles; all remaining ordinary identifiers use `variable`. This includes unresolved external names and write-like occurrences such as `::` or augmented assignments that are already present as source references.

The provider will not add an unresolved occurrence to `Source.definitions`, change its binding key, or make it eligible for any resolution-dependent provider. Semantic `variable` is the same conservative generic category already used by the TextMate grammar, not evidence that the server found a declaration or inferred a q runtime type.

Alternative considered: continue withholding semantic tokens for unresolved names. That preserves a strict coupling between display and resolution, but it is the direct cause of white-versus-colored names and provides no additional safety to navigation or rename because those features already consult binding facts independently.

### 2. Emit one complete selector for each user-defined role

User data variables will emit `variable` with no modifiers. User functions will emit `function` with no modifiers, and parameters will emit `parameter` with no modifiers. The internal `declaration`, `parameter`, `local`, `scopeOffset`, and callability facts remain unchanged. qSQL columns continue to emit unmodified `property`. Catalog built-ins and system names retain `readonly`/`defaultLibrary` where those modifiers describe a genuinely different library role.

The existing modifier legend may retain unused entries for protocol-order compatibility, but no user binding occurrence will emit `declaration`, `local`, `global`, or `modification`. Tests will compare the full `{type, modifiers}` selector across every occurrence rather than checking only the type.

Alternative considered: keep modifiers and add q-specific color rules. A theme can still prioritize its own semantic selector, while extension-supplied foreground colors would violate the theme-neutral contract. Removing foreground-affecting occurrence modifiers is the only way to make equal roles present equal selectors to every theme.

### 3. Use one deterministic precedence table

Semantic classification will use this precedence for identifier spans:

1. statically recognized qSQL column → `property`;
2. explicit or implicit lambda parameter group → `parameter`;
3. consistently callable directly assigned lambda group → `function`;
4. mixed callable/value, ordinary resolved value, write target, or unresolved user name → `variable`.

Catalog tokens continue through the shared catalog role table and cannot be overwritten by the generic identifier fallback. Range deduplication remains last-write deterministic, sorted, non-overlapping, and limited to one-line identifier spans. No workspace lookup, q IPC request, or asynchronous mutation is added.

Alternative considered: infer an unresolved bracket-applied name such as `.service.fetch[...]` as a function. q bracket application also indexes tables, dictionaries, and lists, so that would invent runtime callability and reintroduce unstable classification.

### 4. Contribute language-specific semantic fallback scopes

The manifest will use the supported `semanticTokenScopes` contribution for language `q`. At minimum, `variable` maps to `variable.other.q`, the same scope generated for an ordinary identifier. Function, parameter, and property mappings will use standard q-specific TextMate descendants so themes without explicit semantic rules have stable language-aware fallbacks. The contribution will contain scopes only, never foreground values or a bundled color theme.

Alternative considered: disable semantic highlighting for q. That would make ordinary names uniform but discard useful function, parameter, qSQL-column, and library distinctions and would weaken the existing language-intelligence contract.

### 5. Test complete selectors and every source surface

The realistic fixture will assert every ordinary identifier occurrence, not a sampled subset. Focused cases will cover `:`, `::`, augmented writes, destructuring, locals, globals, namespace-qualified names, declaration-after-use, repeated value assignment, direct/grouped lambdas, mixed callable/value assignment, qSQL aliases/columns, external names, strings/comments/symbols, and catalog tokens.

Tests will verify:

- exact semantic type and an empty modifier list for user variables, functions, and parameters;
- unresolved generic styling without definition/reference/rename/call-hierarchy resolution;
- qSQL property and catalog-role preservation;
- the manifest's q-specific scope mappings and the generated TextMate fallback;
- identical token data for `.q`, q-language `.ipynb`, and `.qnb` virtual documents;
- no highlighting fields entering Results, live output, or saved output; and
- unchanged benchmark bounds and VSIX runtime inventory.

The real Extension Host gate will request semantic tokens through VS Code for representative q documents/cells. Tests assert selectors and scope mappings, not theme RGB values, because the official platform contract leaves final coloring to the active theme.

### 6. Enforce identity-neutral repository provenance

Every tracked plaintext occurrence of the prohibited third-party author identity or package-owner handle will be removed, including occurrences in current documentation, provenance, changelog entries, release scripts, test assertions, and archived OpenSpec artifacts. Where an occurrence records an important engineering or legal boundary, it will be replaced with identity-neutral language such as "a third-party all-rights-reserved q extension" rather than deleting the clean-room fact.

Release auditing will continue to reject references to the disallowed third-party package family without relying on an owner-qualified repository path. A repository hygiene check will normalize tracked text case-insensitively, reduce punctuation and spacing variants, hash candidate tokens and short adjacent-token windows, and compare them with committed SHA-256 digests for the prohibited forms. The prohibited plaintext will not appear in the scanner, fixtures, snapshots, comments, or failure messages. The scanner itself will be tested with a harmless canary digest and synthetic fixture, while a full tracked-file scan is the acceptance gate.

Alternative considered: retain identity-specific wording in provenance or archived change history. Archived intent is still shipped repository content and remains discoverable, so retaining it would violate the repository-wide rule. Removing the provenance boundary entirely was also rejected because the clean-room and licensing constraint must survive.

## Risks / Trade-offs

- [An unresolved name that holds a function at runtime is visually a variable] → Keep it generic until a direct lambda definition proves callability; do not guess from bracket application.
- [Users who deliberately themed `.declaration`, `.local`, or `.global` lose those visual distinctions for q user bindings] → Treat this as the intentional compatibility change required for stable occurrence coloring and document it in the changelog.
- [Third-party themes may still color different semantic categories differently] → Guarantee equal selectors only for the same q role, keep qSQL/functions/parameters intentionally distinct, and document the theme boundary.
- [A generic fallback could accidentally broaden language intelligence] → Add negative navigation, rename, hover, call-hierarchy, and diagnostic assertions for unresolved names.
- [Classifying every ordinary identifier could increase token volume] → Reuse the existing parsed binding list and one-pass range map, then run the fixed large-document benchmark and oversized fallback checks.
- [Manifest fallback mappings could drift from the generated grammar] → Define mapping constants beside the role registry or validate the manifest against it in deterministic tests.
- [Identity cleanup could accidentally weaken the clean-room release boundary] → Replace identity-specific attribution with generic third-party/package-family checks and preserve the existing no-copy and packaged-artifact assertions.
- [A plaintext ban could be reintroduced in a historical or generated file] → Scan all tracked text through digest comparison and run the audit in the normal test/release path.

## Migration Plan

1. Add failing complete-selector and manifest-mapping regression tests for the target syntax shapes.
2. Separate generic visual roles from resolution facts and remove occurrence-specific modifiers from user binding tokens.
3. Add q-specific semantic fallback mappings and validate the extension manifest.
4. Replace prohibited identity/handle references with neutral wording, retain generic clean-room/release checks, and add the digest-based tracked-content audit.
5. Run language unit/protocol/surface-equivalence tests, the full suite, Extension Host acceptance, benchmark, docs build, repository hygiene scan, and package audit.
6. Update the changelog and q-language documentation, regenerate `docs/`, bump the extension to `0.2.29`, and build/audit the VSIX.
7. Commit the verified change on `main` using the configured repository identity, create the matching release tag, and push the branch and tag.

There is no persisted-data or settings migration. Rollback restores the prior provider selectors and removes the manifest fallback contribution; source, notebooks, Results, and user data require no repair.

## Open Questions

None. The implementation can proceed from the deterministic precedence and selector contracts above.
