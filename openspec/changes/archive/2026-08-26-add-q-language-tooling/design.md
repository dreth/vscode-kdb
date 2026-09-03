## Context

See `proposal.md` for motivation and the four delta specs for observable behavior.

The extension currently contributes language id `q`, a hand-authored TextMate grammar, `language-configuration.json`, and a query CodeLens. Extension code is compiled as CommonJS with `tsc`; the browser renderer is bundled separately with esbuild. Its manifest supports VS Code `^1.96.0`, whose Extension Host uses Node 20. There is no language client/server dependency or document index today. The current grammar covers many q literals and built-ins but recognizes only whole-line comments, while official q syntax also permits trailing comments and gives `/` and `\` several context-sensitive meanings.

Notebook support currently targets VS Code's `jupyter-notebook` type. Mixed `.ipynb` files are Python-first, q code cells can run through the active direct-q profile, and a separate all-q Jupyter controller is opt-in through `vscode-kdb.notebook.enableDirectController`. The direct path already owns the strict portable KX MIME v2 result, transient live-result lifecycle, grid/chart actions, resampling, and list-grid behavior. There is no custom notebook serializer or `*.qnb` contribution.

Reference research was frozen on 2026-08-25:

| Reference | Frozen artifact | License boundary | Useful findings |
|---|---|---|---|
| Third-party Marketplace q VSIX | Version 5.0.1, package dated 2026-08-13 | All rights reserved | Behavioral benchmark for language features and the established `.qnb` contract. Its manifest and isolated packaged notebook serializer/controller modules were inspected to identify observable contributions and JSON fields: notebook type `q-notebook`, `*.qnb`, q-only controller, and a top-level array of cells with `kind`, `language`, `value`, and `{mime,value}` outputs. No implementation, assets, grammar, renderer, documentation text, or generated artifact will be copied. |
| Historical q extension | tag `v2.3.4` at `54c523c82b80b2a40e56754fdbf40159e2d0ad8f` | MIT | Demonstrates an older tree-sitter/LSP feature taxonomy, but its formatter module is empty. No historical q Professional code is needed by this design. |
| Later historical q extension | tag `v3.2.1` at `30ee821573a2d3ea86401df051beeec2ac1500dd` | GPLv3 | Excluded because the project is MIT and this change does not introduce GPL-covered source. |
| Current public q extension repository | `1481ba419edee8e53be6bb4f6f134d1fb04f1ed1` | All rights reserved; documentation/license-only working tree | Public behavior and licensing reference only. |
| KX VS Code extension | `KxSystems/kx-vscode` at `955292b68a53179cb1865608e917d4bcdc833ca1` | Apache-2.0 | About 3,328 lines of tested TypeScript implement a Chevrotain q token model, source/scope model, five lint checks, incremental LSP document sync, completion, definitions/references/rename, document symbols, semantic tokens, folding, selection ranges, and call hierarchy. It lacks formatter, hover, signature help, workspace-symbol search, and the static documentation catalog required here. |

The official KX q syntax and reference documentation remain the semantic authority for independently authored tests and catalog entries. Facts such as spellings, signatures, and type names may be recorded; documentation prose will be summarized and linked rather than copied.

## Goals / Non-Goals

**Goals:**

- Run q analysis in an isolated process so large or malformed documents cannot block connection management, queries, notebooks, or result rendering.
- Share one lexical/scope model across diagnostics, formatting, language providers, semantic tokens, and generated TextMate assets.
- Reuse only the smallest audited KX Apache-2.0 units that materially improve correctness, preserving their notices and recording modifications.
- Make source analysis deterministic and fully useful offline, then layer bounded runtime metadata on top through an explicit client bridge.
- Use the lodash-free Chevrotain 13 runtime and its lower token-memory representation without requiring users to install Node separately.
- Preserve q evaluation semantics even when the formatter encounters incomplete, dynamic, or unfamiliar source.
- Add a q-only `.qnb` notebook that opens established q Professional cell arrays, reuses this extension's direct-q execution and rich-result contracts, and leaves mixed `.ipynb` behavior unchanged.
- Make test, performance, provenance, and VSIX-content checks part of the 0.2.24 release gate.

**Non-Goals:**

- Forking the KX extension, adopting its connection/notebook/result UI, or maintaining source compatibility with its server internals.
- Reusing current proprietary q Professional or GPL-covered source, binaries, grammar data, generated parsers, assets, documentation text, or protocol implementation.
- Parsing enough of dynamic q to promise a complete compiler/type checker, automated refactors, code execution, or sound navigation through `value`/`eval`.
- Aggressive same-line whitespace rewriting or automatic line wrapping in the initial formatter.
- Supporting `.k`, undocumented incompatible `.qnb` dialects, byte-for-byte q Professional serialization/UI parity, or third-party test dialects such as quke in 0.2.24.

## Decisions

### 1. Use a real, separately bundled Language Server Protocol process

Add a top-level `language-server/` TypeScript project and bundle its Node entry point to `out/q-language-server.js` with esbuild. Add `vscode-languageclient`, `vscode-languageserver`, and `vscode-languageserver-textdocument`; bundle server-only dependencies so the entry point has a deterministic runtime. Raise `engines.vscode` to `^1.101.0`, the first stable VS Code with a Node 22 Extension Host, so the server can use Chevrotain 13.2.0 without a separately installed runtime. A small extension-host controller starts the client lazily when a q document or q notebook-cell document is present, registers configuration and metadata request handlers, reports redacted lifecycle failures, and disposes the process with the extension.

The server advertises incremental text synchronization, but parsing is version-cached full-document parsing after the diagnostic debounce. Provider work carries the document version and cancellation token; an older parse may finish, but its result cannot publish over a newer version.

Alternatives considered:

- Direct `vscode.languages.register*Provider` implementations would avoid LSP dependencies but run parsing/indexing in the extension host and make editor-neutral tests and future client reuse harder.
- A Python or q-based server would add runtime installation and environment failure modes, violating offline availability.
- In-process WebAssembly tree-sitter would require a q grammar artifact with a clean current provenance story. KX's current pure TypeScript/Chevrotain approach is easier to audit and package.

### 2. Adapt the KX token/source model selectively and keep a provenance ledger

Port the relevant Apache-2.0 files from the frozen KX commit into `language-server/src/`, keeping KX copyright/license headers and adding a short modification note where files materially diverge. Start with parser tokens/literals/ranges, source/scope utilities, the five implemented lint checks, and provider algorithms that meet these specs. Do not copy KX extension connection, notebook, telemetry, build-tool, or UI code.

Use Chevrotain 13.2.0 under its Apache-2.0 license. KX's frozen parser was authored against 11.1.2, so the adaptation must account explicitly for v13's `-1` unavailable-location sentinel and stricter parsing-DSL TypeScript types. The audited KX parser does not use the v12-removed syntactic-content-assist APIs or custom `LA()` override. `THIRD_PARTY_NOTICES.md` will identify the upstream repository, exact commit, adapted paths, local destination, modification statement, Chevrotain upgrade, and required Apache notices. A provenance document under `language-server/` will list independently authored files separately. Package inspection must confirm that the license text ships and that no Chevrotain 11 or `lodash-es` artifact enters the VSIX.

No q Professional source will be copied. Although the old `v2.3.4` tag is MIT-licensed, it adds no formatter implementation and using two language-server ancestries would make audit and maintenance harder. Its public behavior can inform tests only where the behavior is independently specified from q semantics.

Alternatives considered:

- Writing every lexer/scope rule from scratch would avoid attribution but discard a recent, tested Apache implementation and increase correctness risk.
- Copying q Professional 5.0.1 bundle/grammar content is prohibited by its all-rights-reserved license.
- Adapting the GPLv3 3.2.1 server would impose incompatible distribution obligations for this intended MIT release.
- Retaining Chevrotain 11.1.2 would preserve VS Code 1.96 support but leaves a production dependency tree that current security scanners reject through `lodash-es`; the user accepted raising the host minimum for the smaller lodash-free runtime.

### 3. Make token declarations the generated-asset source of truth

The server's q token declarations and a small independently authored category/catalog layer become the source for both runtime lexing and a checked-in `syntaxes/q.tmLanguage.json`. A build script deterministically emits the TextMate grammar; `check:q-grammar` regenerates to a temporary location and fails on a diff. Grammar scope snapshots additionally prove that TextMate and server ranges agree on canonical fixtures.

`language-configuration.json` remains declarative because VS Code loads it before extension activation, but its comment, word, pair, and indentation expressions receive explicit unit fixtures against the same corpus.

The grammar must recover line by line where TextMate permits, while the server token stream retains richer error information. Semantic tokens refine only identifier roles and never replace lexical string/comment/literal boundaries.

Alternative considered: maintaining a richer server lexer beside the existing independent grammar is simpler initially, but it recreates the drift that caused the current trailing-comment gap.

### 4. Build one cached q workspace model for all providers

Each document version produces a `QSource` containing tokens, protected ranges, delimiter/scope relationships, definitions, references, imports/loads, calls, diagnostics, and line-continuation classification. All providers consume that immutable object. The workspace index stores only symbol/reference summaries and file version/hash metadata, not duplicate source strings.

Indexing begins on first relevant provider request, uses VS Code workspace file discovery for configured include/exclude globs, caps at 5,000 files, parses in small cancellable batches, and prioritizes open documents. Open unsaved text always overrides the disk snapshot. File watcher events invalidate one file plus statically dependent load/module relationships. Paths outside a workspace are read only when a source contains a statically resolved q module/load path and the path is allowed by the explicit module search policy.

Provider behavior is conservative:

- unresolved dynamic names produce no navigation or rename edit;
- rename uses prepare-rename validation and exact resolved binding identities;
- completion merges and de-duplicates static catalog, visible source bindings, workspace bindings, and optional runtime entries in that priority order;
- hover/signature entries state whether they are static source, built-in catalog, or runtime metadata;
- document/workspace symbols and call hierarchy omit qSQL columns, strings, comments, and symbols;
- folding and selection ranges derive from parsed delimiter/comment/expression ranges.

Alternative considered: separate provider-specific regex passes would be smaller per feature but would disagree on scope, repeatedly parse the same text, and make rename unsafe.

### 5. Author the formatter as a token-preserving edit planner

The initial formatter operates on line-leading indentation and safe trailing trivia only. It preserves newline count and every non-trivia token. It also preserves the boolean classification of every line as top-level or continuation, because q script indentation changes evaluation.

The planner:

1. parses the requested document version and computes protected/suppressed ranges;
2. rejects whole-document formatting on unsuppressed lexical or structural errors;
3. computes structural indentation from delimiter/lambda/qSQL/continuation scopes and the request's `insertSpaces`/`tabSize` options;
4. produces minimal line edits without touching internal expression whitespace;
5. re-lexes the candidate and compares ordered non-trivia tokens, protected token text, newline count, and top-level/continuation flags; and
6. discards the entire operation if any invariant differs.

Range formatting expands only to complete intersecting lines, reads outer scope for indentation, and refuses a range crossing an incomplete protected construct. Suppression directives are recognized from comment tokens, not raw substrings. Golden fixtures test output and a property-style corpus test checks idempotence and invariants.

Alternatives considered:

- Porting a formatter from q Professional is unavailable under the current license, and the MIT 2.3.4 formatter file contains no implementation.
- Pretty-printing a reconstructed AST would produce more dramatic output but is unsafe until q expression and continuation coverage is substantially broader.
- Delegating to a q process would break offline use and could execute user/environment code.

### 6. Separate syntax errors from configurable conservative lint

Lexer/delimiter errors are always published while the server is enabled. Lint starts with the five implemented KX analyses, remapped to this project's stable codes and severities, plus an independently authored indentation-continuation check from documented q script semantics. Unknown-name and general type inference are intentionally absent.

The server owns a per-document diagnostic generation. It waits the default 250 ms, cancels superseded work, applies resource-scoped rule settings and parsed suppression directives, sorts by source range/code, caps at 200, and publishes only if URI/version/generation still match. Close, disable, oversized-file, and server-stop paths explicitly clear owned diagnostics.

The static q catalog is independently authored as structured data containing spelling, category, signature/rank where known, concise summary, and official URL. It supplies built-in completion, hover, and signatures without copying KX documentation prose. Catalog validation rejects duplicates, invalid URLs/categories, and entries that the lexer cannot recognize.

Alternative considered: exposing every placeholder rule in KX's larger rule catalog would imply checks that are not implemented and create false confidence.

### 7. Bridge connected metadata through a shared extension-host service

The language server process never opens q IPC itself and never receives credentials. When `connectedIntelligence` is enabled, it sends a custom request describing only the document URI, requested metadata kind, optional validated table identifier, and its last-known active snapshot. The extension host resolves the active profile and calls a shared `QMetadataService` extracted from the existing Server Explorer query/build/parse helpers.

The service reuses the existing safe table/variable queries and `meta` parser, never previews values, validates identifiers, caps response count/bytes, uses existing connection/query timeouts, and returns a serializable response labeled with `{connectionId, namespace, connectionGeneration, metadataGeneration}`. Table columns load on demand for a statically identified table. Root metadata is cached for 30 seconds; table metadata is cached per snapshot/table; the explicit refresh command and any active connection/namespace/generation change invalidate both sides.

The server merges a response only if all snapshot and request generations still match. Local cancellation cannot guarantee that q stops processing an already issued synchronous request, so canceled/stale results are discarded and never reused. Errors go through the existing redacted diagnostics policy and fall back to offline entries.

Alternatives considered:

- Giving the server credentials or a second IPC stack duplicates security-sensitive code and connection state.
- Requiring Server Explorer to be enabled couples two optional UIs. Sharing the metadata service instead allows each feature to own its setting and cache view.
- Automatic metadata access by default would add unexpected server work, so connected intelligence is opt-in.

### 8. Expose bounded settings and a clean disable/rollback path

Add resource-scoped settings with stable defaults:

- `vscode-kdb.languageServer.enabled`: `true`;
- `vscode-kdb.languageServer.lint.enabled`: `true`;
- `vscode-kdb.languageServer.lint.rules`: per-code severity map;
- `vscode-kdb.languageServer.diagnostics.debounceMs`: `250`;
- `vscode-kdb.languageServer.diagnostics.maxProblems`: `200`;
- `vscode-kdb.languageServer.maxFileSizeBytes`: `2097152`;
- `vscode-kdb.languageServer.workspace.include`: `["**/*.q"]`;
- `vscode-kdb.languageServer.workspace.exclude`: generated/vendor defaults from the spec;
- `vscode-kdb.languageServer.workspace.maxFiles`: `5000`; and
- `vscode-kdb.languageServer.connectedIntelligence`: `false`.

All numeric settings have documented lower/upper bounds and invalid values fall back to defaults. Disabling the server stops/disposes it and clears owned diagnostics while leaving declarative highlighting, query CodeLens, execution, connections, notebooks, and results intact. Formatter registration follows server enablement; explicit formatting is never automatic unless VS Code's own settings request it.

### 9. Test the language core outside VS Code and the integration inside VS Code

Add a focused language test entry point included by `npm test` for lexer/parser fixtures, generated grammar scopes, source/scope resolution, provider responses, formatter goldens/invariants, diagnostics/suppression, settings normalization, workspace bounds, stale generations, and metadata response validation. Test helpers must be host-neutral so most coverage runs without downloading VS Code or q.

Extend the extension-host suite to open a `.q` document, q Jupyter cell, and `.qnb` code cell, wait for language readiness, request representative completion/hover/signature/format/symbol/diagnostic operations, exercise disable/clear, and verify query/notebook behavior still works. A fake metadata runner tests connected completion without a real process; existing live-q tests remain the appropriate opt-in validation for actual IPC metadata.

Add deterministic performance checks using fixed fixtures and relative ceilings recorded in test output: cold parse/index, warm provider, edit-to-diagnostic, and formatter times plus heap/VSIX-size comparison against 0.2.23. The release gate rejects unbounded regressions, server startup during non-q-only activation, missing third-party notices, and unexpected proprietary/GPL artifacts.

### 10. Add a compatible qnb codec and share the direct-q execution core

Contribute a distinct notebook type, `vscode-kdb-q-notebook`, selected by `*.qnb`, plus an always-registered controller whose supported language is only `q`. The existing optional `jupyter-notebook` controller remains controlled by `vscode-kdb.notebook.enableDirectController`; the new controller does not depend on that setting. Both controllers call one extracted direct-q cell runner so active-profile lookup, source validation, execution ordering, cancellation, output conversion, durable MIME v2 generation, transient live registration, and stale-generation checks cannot drift.

Implement a small host-neutral `.qnb` codec rather than treating the file as Jupyter `nbformat`. Its compatibility input and canonical outer representation are the observed q Professional JSON cell array:

```json
[
  {
    "kind": 2,
    "language": "q",
    "value": "show 1+1",
    "outputs": [{ "mime": "text/plain", "value": "2" }]
  }
]
```

The codec validates bounds and types before constructing notebook cells, accepts code and markup kinds, forces every code cell to q, and keeps markup as markdown. It preserves source bytes represented by the JSON string, ordered MIME outputs, JSON-compatible unknown fields, optional cell/output metadata, markdown attachments, and execution summaries through an internal sidecar associated with each decoded cell/output. Serialization strips credentials, IPC/session handles, transient live IDs, and stale request identities, but retains the existing durable KX MIME payload and safe output binding needed for saved grid/chart actions. Invalid JSON or an unsupported top-level/field value raises a visible open/save error; it never silently decodes to an empty notebook.

Legacy `x-application/q-notebook` values are an import compatibility path. A separately authored adapter recognizes only validated public result shapes that this extension can render; otherwise it preserves the MIME/value and presents a safe fallback. New execution continues to emit this project's existing MIME v2 and fallback items, so no second q-value identity schema or renderer policy is introduced. A newly created `.qnb` starts with q code and may add markdown, while existing q Professional files retain their core array shape.

Generalize only the notebook integration that is actually shared: KX connection status, execution, rich-output actions, renderer messages, saved/live result lookup, clear/rerun/export, grid/list handling, and charts. Mixed-notebook language switching, `%%q`, Python preparation, and Jupyter-specific restoration remain scoped to `jupyter-notebook` and are not exposed in `.qnb`. The language client selector includes virtual q documents from both notebook types.

Alternatives considered:

- Writing `.qnb` as Jupyter `nbformat` would be a familiar storage model but would not open the team's existing q Professional notebooks and would conflict with the established extension-based format.
- Reimplementing the packaged q Professional serializer/controller would violate the clean-room boundary and would also inherit silent data-loss behavior on malformed JSON. Only its observable interchange fields and q-only contribution are compatibility inputs.
- Building a second execution/result pipeline for `.qnb` would risk divergence in q identity, chart resampling, list grids, clear/rerun, and stale-response handling.

## Risks / Trade-offs

- **q is highly dynamic, so static resolution can be incomplete** → Omit ambiguous results, label runtime metadata, and test negative cases; never guess for rename.
- **Whitespace or indentation edits can change q evaluation** → Keep 0.2.24 formatting conservative and enforce token/newline/continuation invariants before returning edits.
- **A full-document token parser may lag on very large files** → Separate process, debounce, version cancellation, immutable caches, lazy bounded indexing, and a configurable 2 MiB cutoff preserve editor and execution responsiveness.
- **Bundling LSP and Chevrotain increases package size even though v13 is smaller than v11** → Bundle/tree-shake only the server entry, exclude build-only modules, inspect the packed VSIX for Chevrotain 11/`lodash-es`, and record the size delta in the release checklist.
- **Raising the minimum VS Code version drops 1.96–1.100** → Declare `^1.101.0`, document 0.2.23 as the fallback for older hosts, and smoke-test the packaged extension on VS Code 1.101 plus the current stable host.
- **KX parser code targeted Chevrotain 11 location/type behavior** → Add focused fixtures for EOF, recovery-inserted tokens, empty locations, and every adapted DSL signature before accepting v13 output.
- **Connected metadata can load production processes** → Default off, metadata-only queries, no values, TTL/on-demand caches, caps, existing timeouts, explicit refresh, and stale-generation rejection.
- **Local cancellation cannot abort every synchronous q request** → Stop waiting locally, discard the response, never publish stale entries, and document that the server-side metadata query may finish.
- **Generated grammar and runtime lexer capabilities differ** → Generate from shared declarations where possible and maintain range/scope contract fixtures for constructs TextMate cannot model identically.
- **Upstream KX changes after the frozen commit** → Treat adapted code as a reviewed vendored snapshot; future updates require a new provenance/license audit and regression run.
- **Users running both q Professional and this extension may see duplicate providers** → Document disable/uninstall and default-formatter steps; use only `vscode-kdb.*` command/settings identifiers and do not mutate another extension.
- **Static q catalog can become stale** → Store official URLs and retrieval metadata, test token recognition, and update through reviewed source changes rather than runtime web access.
- **q Professional's compact format does not define metadata, attachments, or every MIME encoding** → Keep its four core cell fields canonical, preserve optional JSON fields through a tested sidecar, emit only JSON-compatible values, and fail visibly before lossy save.
- **Both extensions may claim `*.qnb` while users migrate** → Use a distinct notebook/controller id, document that q Professional must be disabled or uninstalled to avoid selector conflicts, and install-smoke with it absent and present.
- **A legacy q Professional output may not map to the current KX value model** → Validate known shapes, adapt only losslessly supported values, retain unknown MIME/value pairs, and show a safe fallback instead of guessing.

## Migration Plan

1. Raise the manifest/test baseline to VS Code 1.101, migrate the audited parser to Chevrotain 13.2.0, and land the server core, generated grammar, tests, notices, and language-client lifecycle behind `vscode-kdb.languageServer.enabled` while keeping the default enabled for 0.2.24.
2. Add formatter/diagnostic providers, then offline intelligence, then the opt-in metadata bridge; run focused gates after each layer so execution and result regressions are attributable.
3. Add the `.qnb` codec and notebook contribution, extract the shared direct-q runner, then extend result integration and language selectors; keep the optional Jupyter controller and mixed-language commands unchanged while each layer's compatibility and parity tests run.
4. Update source documentation, settings reference, migration instructions, competitive/provenance notes, changelog, and generated `docs/`. Migration instructions identify VS Code 1.101 as the minimum and 0.2.23 as the fallback for older hosts, then tell users to disable/uninstall q Professional, choose KX for VS Code as the q formatter, open existing `.qnb` files directly, and optionally enable connected intelligence.
5. Run `npm test`, the focused language suite, extension-host suite, `.qnb` compatibility/save-reopen checks, notebook cross-contract/parity gates, live-q metadata validation where q is available, documentation generation checks, strict OpenSpec validation, license audit, package inspection, and 0.2.23-to-0.2.24 size/performance comparison.
6. Bump package/release artifacts to 0.2.24 only after all required checks pass, package the VSIX, install-smoke it in an isolated Extension Host, and then follow the existing release/tag/publish workflow.

Rollback requires no source migration: set `vscode-kdb.languageServer.enabled` to `false` to retain declarative highlighting and execution/result behavior, or reinstall 0.2.23. Connected metadata is memory-only and no source/index database is introduced. `.qnb` remains a JSON cell array compatible at its core with q Professional; users can reopen it there after disabling this extension, although optional KX-only fields and MIME v2 rendering require this extension for full fidelity.
