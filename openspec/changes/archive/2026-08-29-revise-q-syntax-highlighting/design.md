## Context

See `proposal.md` for the user-visible problem and `specs/q-language-intelligence/spec.md` for the revised contract. Today the generated TextMate grammar classifies every ordinary identifier as `variable.other.q`, while `qSemanticTokens` can override that lexical scope with one of four token types. The semantic path derives `callable` independently for each occurrence from `Source` token metadata.

`Source.parse()` currently associates any opening lambda brace with the most recently recorded definition. In a statement such as `.r.stats:update hits:{deltas x} each count from .r.stats`, that makes the repeated `.r.stats` assignment look like a function even though the lambda is nested inside the update expression. The reference occurrences remain variables, producing the observed color split. Catalog entries are also all emitted as semantic keywords regardless of whether the lexer recognized a built-in, qSQL word, or system name.

The same q language ID drives standalone `.q` editors, q-language Jupyter cells, and `.qnb` code cells. TextMate is the activation-free fallback on all three; semantic tokens are a versioned, full-document language-server response layered over it. KX Results, live notebook output, and saved notebook output do not consume either highlighting representation.

The locally installed third-party q package is licensed “All rights reserved.” Its grammar is therefore not an implementation source. The maintained Apache-licensed lexer/parser, the independently authored catalog, official q behavior, and black-box expected categories are the only sources for this work.

## Goals / Non-Goals

**Goals:**

- Make lexical scope selection and semantic refinement follow one explicit role table.
- Give every occurrence in a safely resolved binding group the same base semantic role.
- Detect callable assignments from the assigned expression instead of the next lambda encountered anywhere in that expression.
- Make the tests observe real TextMate scopes and decoded semantic-token spans, including the reported namespace/update pattern.
- Keep classification linear in document size and identical for every q source surface.

**Non-Goals:**

- Inferring runtime q types, the result of dynamic `value`/`eval`, or callable values returned from arbitrary expressions.
- Guaranteeing a literal foreground color across VS Code themes; themes retain control over standard scopes and semantic-token selectors.
- Changing diagnostic, formatting, navigation, execution, notebook serialization, MIME output, Results rendering, `.k` support, or connected-metadata behavior.
- Copying, translating, or adapting any all-rights-reserved third-party grammar or source.

## Decisions

### 1. Maintain one declarative highlight-role registry

Introduce a host-neutral role registry beside the parser declarations. It will map lexer token families and catalog categories to:

- a standard TextMate scope used by the generated grammar; and
- where semantic refinement is meaningful, a standard LSP semantic-token type and modifiers.

The generated grammar will continue to order protected ranges before literals, words, and punctuation, and generic identifiers will keep a neutral variable scope. Semantic classification will consult token type and parsed context, not spelling alone, so a qSQL word that is also a usable q primitive is not assigned a context-blind role. No entry may contain a foreground color.

This registry is the shared source of truth for the checked-in TextMate grammar, semantic catalog roles, and test expectations. The parser remains the source of truth for binding, qSQL-column, scope, and callability facts.

Alternative considered: maintain separate TextMate and semantic maps. That is simpler locally, but it is the current source of drift and would not prevent the same regression.

### 2. Separate occurrence facts from resolved binding roles

Keep occurrence facts on `QBinding`—declaration, explicit/implicit parameter, local/global scope, qSQL status, and syntactically assigned lambda—but compute the semantic base role per binding group before encoding tokens. A binding group is keyed by its normalized q name and lexical scope.

- Parameters use `parameter`.
- A group whose statically relevant declarations consistently assign lambdas uses `function`.
- A group whose declarations consistently assign non-lambda values uses `variable`.
- A group with conflicting callable assignments or otherwise ambiguous role information fails closed to `variable` rather than changing color from occurrence to occurrence.
- Declaration, local/global, read-only, and default-library facts are modifiers; they never replace the base role.
- References inherit the resolved group role rather than relying on their own syntactic token metadata.

Repeated value assignments such as `.r.stats:select ...` followed by `.r.stats:update ...` therefore remain variables everywhere. A direct function definition such as `f:{[x]x+1}` and its resolved reads remain functions everywhere. Explicit parameters and statically recognized implicit `x`/`y`/`z` parameters receive the parameter role.

Alternative considered: color each occurrence from its immediate syntax. That can show a value's role changing over time, but q is dynamic and the result is visually unstable; it also caused the reported declaration/reference mismatch.

### 3. Associate callability only with the assigned expression

Replace the “most recent definition when `{` opens” heuristic with a conservative assignment-expression association. A declaration is callable only when the right-hand expression can be identified structurally as a lambda, allowing transparent grouping but not a lambda nested as an argument, update expression, list member, or qSQL expression. References obtain callability through the binding-group resolver.

Ambiguous aliases, values produced by calls, and mixed callable/non-callable reassignments are deliberately not inferred as functions. This is consistent with the existing fail-closed language-intelligence contract.

Alternative considered: patch only the update/qSQL case. The same heuristic can fail in any expression containing a later inline lambda, so a syntactic ownership rule is safer and easier to test.

### 4. Use standard semantic categories and conservative qSQL refinement

Expand the semantic legend only as needed for standard roles: `variable`, `function`, `parameter`, `property`, and `keyword`, plus standard/default-library and existing declaration/read-only modifiers and local/global modifiers if VS Code needs them to preserve the existing local/global distinction. Built-in primitives use a callable/default-library role; control and qSQL syntax use keyword; documented system names retain a system/default-library role without marking assignable `.z` callbacks read-only. Statically recognized qSQL columns use property. Unresolved identifiers emit no semantic token and continue to show the TextMate identifier scope.

Semantic entries will be deduplicated, non-overlapping, sorted, and encoded from document-local spans. The provider performs no workspace lookup, q IPC, or asynchronous mutation, so document-version replacement remains the existing language-server responsibility.

Alternative considered: continue emitting every catalog entry as keyword and omit qSQL columns. That avoids a legend change but lets semantic highlighting erase the more accurate lexical category whenever the server is active.

### 5. Test rendered classifications, not only generated JSON text

Add explicit development dependencies on the VS Code TextMate tokenizer and its Oniguruma runtime if they are not already direct dependencies. A deterministic test helper will tokenize the generated grammar and snapshot selected token text plus its most specific q scope. A separate decoder will turn LSP's delta-encoded semantic tokens into `(line, character, length, type, modifiers)` records.

Golden fixtures will cover:

- the reported `.r.*` script shape, repeated table assignments, nested inline lambdas, qSQL clauses/columns, and trailing comments;
- direct lambdas and all resolved function references;
- explicit and implicit parameters, locals, globals, qualified globals, built-ins, system names, literals, and unresolved identifiers;
- server-disabled lexical fallback and identical source classification for `.q`, q-language `.ipynb`, and `.qnb` cell documents; and
- absence of highlighting data from Results and live/saved notebook output payloads.

The existing generated-file equality check remains. Protocol tests will verify the advertised legend and full semantic-token response. The fixed language benchmark will guard against nonlinear classification.

Alternative considered: assert only that scope names and regex strings occur in the generated JSON. Those assertions already pass while the visible behavior is wrong, so they are insufficient.

### 6. Keep source highlighting isolated from output surfaces

All new helpers remain in the q language package. Notebook cells reuse them solely because their virtual documents have language ID `q`; no notebook serializer or renderer branch is added. Results, live output, saved MIME payloads, rerun/reset state, and stale-response behavior remain byte-for-byte outside the highlighting path.

## Risks / Trade-offs

- [Themes may intentionally style declarations, locals, or semantic functions differently] → Keep stable base roles, use standard modifiers, document that actual colors are theme-owned, and test scopes/types rather than RGB values.
- [A conservative callable resolver may classify some dynamically callable q values as variables] → Prefer stable fail-closed roles; navigation and highlighting must not guess dynamic runtime behavior.
- [TextMate cannot reproduce all parser-level qSQL context] → Keep a correct lexical fallback and let semantic tokens refine only statically known columns and keywords; never label uncertain text as resolved.
- [New tokenization test dependencies could enter the packaged VSIX] → Declare them as development-only, retain package inventory checks, and verify the production artifact excludes them.
- [Role grouping could add work on large files] → Build document-local maps in one pass, avoid repeated linear searches, and run the existing 4,000-line benchmark and oversized-document fallback tests.
- [Generated grammar and source registry could diverge] → Preserve the checked-in generated-file equality test and fail validation when regeneration changes uncommitted output.
- [Reference-extension inspection could contaminate implementation provenance] → Do not copy any grammar expression or source structure; preserve existing license headers and record the clean-room boundary in review artifacts.

## Migration Plan

1. Add the role registry and focused tokenization/semantic decoding tests before changing classifications.
2. Replace callable ownership and binding-role resolution, then update the semantic legend/provider.
3. Regenerate `syntaxes/q.tmLanguage.json` solely from the maintained role registry.
4. Run language unit/protocol tests, notebook-language equivalence tests, the full TypeScript suite, the fixed language benchmark, documentation build, and package inventory verification.
5. Update the q-language documentation, changelog, and generated MkDocs site after behavior is verified.

There is no persisted-data or settings migration. Rollback consists of reverting the role registry/parser/provider changes and regenerating the prior grammar; notebooks, results, and user configuration require no repair.
