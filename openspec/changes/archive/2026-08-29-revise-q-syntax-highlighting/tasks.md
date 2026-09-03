## 1. Regression Harness and Fixtures

- [x] 1.1 Add direct development-only TextMate/Oniguruma tokenizer dependencies and a deterministic grammar-token helper; verify the generated grammar tokenizes a canonical q fixture into exact text/range/scope records without extension activation.
- [x] 1.2 Add an independently authored synthetic namespace/qSQL fixture, including repeated assignments, nested inline lambdas, built-ins, literals, and trailing comments; verify focused assertions expose the current declaration/reference role mismatch and cover every lexical category in the revised spec.
- [x] 1.3 Add a semantic-token decoder and golden role assertions for direct functions, explicit and implicit parameters, locals, globals, qualified globals, qSQL columns, built-ins, system names, and unresolved identifiers; verify decoded entries are sorted, non-overlapping, and use the expected base role and modifiers.

## 2. Shared Highlight Classification

- [x] 2.1 Introduce the declarative lexical/semantic role registry and refactor TextMate generation to consume it; regenerate `syntaxes/q.tmLanguage.json` and verify `npm run check:q-grammar` plus real tokenization scope tests pass with no hard-coded foreground colors.
- [x] 2.2 Replace the most-recent-definition lambda heuristic with conservative assigned-expression ownership and record explicit/implicit parameter facts; verify direct or transparently grouped lambda assignments are callable while lambdas nested in update, qSQL, argument, or list expressions do not reclassify the assignment target.
- [x] 2.3 Resolve one base semantic role per normalized name and lexical scope, propagate it to all safely resolved occurrences, and fail mixed/ambiguous assignments closed to variable; verify every `.r.stats` occurrence in the regression fixture is variable and every direct `f:{...}` occurrence is function.
- [x] 2.4 Refine catalog and qSQL semantic roles, extend the advertised legend where required, and deduplicate encoded spans; verify language unit and protocol tests distinguish callable built-ins, control/qSQL keywords, documented system names, known qSQL columns, and lexical-only unresolved identifiers.

## 3. Surface and Compatibility Coverage

- [x] 3.1 Exercise identical q source as a standalone `.q` document, q-language `.ipynb` cell, and `.qnb` code cell; verify Extension Host and language protocol tests return equivalent lexical categories and semantic roles and retain TextMate highlighting when the server is disabled.
- [x] 3.2 Run the existing KX Results and live/saved notebook result regressions around the new source fixture; verify no highlighting fields enter result payloads and execution, serialization, MIME, renderer, reset, and stale-response behavior remains unchanged.
- [x] 3.3 Run the fixed q-language benchmark and inspect the production package inventory; verify classification remains linear/bounded, oversized documents retain lexical fallback, and tokenizer test dependencies are absent from the VSIX runtime contents.

## 4. Documentation and Verification

- [x] 4.1 Update the q-language documentation and changelog with the stable-role behavior and theme-owned color limitation, regenerate `docs/`, and verify `mkdocs build --strict` succeeds without publishing proprietary-extension comparison material.
- [x] 4.2 Run `npm run test:language`, `npm run check:q-grammar`, `npm run test:extension-host`, `npm test`, and `npm run benchmark:q-language`; verify every targeted and full regression gate passes with no unexplained baseline change.
- [x] 4.3 Reconcile all implementation discoveries with the proposal, delta spec, design, and task checkboxes, then run strict OpenSpec validation and verify `revise-q-syntax-highlighting` is complete and ready to archive.
