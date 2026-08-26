## Why

KX for VS Code currently declares the `q` language and ships a basic TextMate grammar, bracket configuration, and query CodeLens, but it does not provide a formatter, diagnostics, completion, hover, signatures, semantic highlighting, symbols, or source navigation. Teams therefore still need q Professional for ordinary q authoring, and extending the current regex-only grammar independently from editor intelligence would create multiple sources of truth and a high risk of incorrect q tokenization.

Version 0.2.24 should provide a first-party, offline-first q authoring baseline and a first-party `.qnb` notebook so q Professional is no longer required for core `.q` or notebook workflows, without regressing query execution, mixed-language `.ipynb` notebooks, results, chart resampling, or grid rendering.

## What Changes

- Replace the hand-maintained highlighting policy with a tested q lexical source of truth that correctly distinguishes comments, commands, strings, symbols, temporal/numeric literals, qSQL, built-ins, namespaces, identifiers, and overloaded operators.
- Add an actual q language server for `.q` documents, q cells in mixed-language `.ipynb` notebooks, and code cells in q-only `.qnb` notebooks, with incremental document synchronization, cancellation, bounded workspace indexing, completion, hover, signature help, semantic tokens, document/workspace symbols, document highlights, definition, references, rename, folding, selection ranges, and call hierarchy where the server can resolve them safely.
- Add optional, cached completions and hover details for objects on the active direct-q connection, using bounded read-only metadata requests and falling back cleanly to offline intelligence.
- Add deterministic whole-document and range formatting with a conservative q-specific policy that preserves strings, comments, commands, newlines that affect script continuation, and any construct the formatter cannot parse confidently.
- Add conservative diagnostics for lexical/scope errors and high-confidence lint findings, with stable rule codes, configurable enablement/severity, debounce, suppression directives, and no query execution.
- **BREAKING** Raise the minimum supported VS Code version from 1.96 to 1.101 so the language-server process can rely on the Node 22 Extension Host runtime required by Chevrotain 13.2.0.
- Add a first-party `q-notebook` type for `*.qnb` files with a q-only direct-IPC controller, q code cells plus markdown cells, syntax/language tooling, interruption, connection status, rich KX grid/chart outputs, result actions, and save/reopen behavior equivalent to existing direct-q cells in `.ipynb`.
- Read and write the established q Professional `.qnb` JSON cell-array shape (`kind`, `language`, `value`, and MIME outputs) from a clean-room behavioral specification, preserve compatible unknown fields and MIME data, and extend it only with optional fields needed for KX portable output identity. Invalid files fail visibly instead of being replaced by an empty notebook.
- Keep `.ipynb` mixed-language behavior unchanged: its Python-first defaults and optional `vscode-kdb.notebook.enableDirectController` controller setting do not govern the dedicated `.qnb` q controller.
- Add independently authored q fixtures, provider tests, extension-host smoke tests, startup/large-file performance budgets, and documentation covering configuration, limitations, migration from q Professional, and provider conflicts.
- Record exact source provenance and license notices for any adapted Apache-2.0 KX code or MIT-licensed historical q Professional code. The current all-rights-reserved q Professional VSIX and GPL-licensed releases are behavioral references only and MUST NOT supply code, assets, grammar rules, documentation text, or generated artifacts; `.qnb` compatibility is independently implemented from the observable file/contribution contract.
- Preserve all existing editor execution commands, direct IPC behavior, notebook MIME contracts, Results panel behavior, qText result highlighting, resampling, and list-grid requirements.

Non-goals for 0.2.24 are a complete q compiler or type checker, runtime execution during offline analysis, debugger support, `.k` language support, byte-for-byte file formatting or UI parity with q Professional, support for undocumented incompatible `.qnb` dialects, and semantic validation of arbitrary dynamic/evaluated q code.

## Capabilities

### New Capabilities

- `q-syntax-highlighting`: Lexical highlighting and editor language configuration for q source documents, mixed-notebook q cells, and q-only `.qnb` code cells.
- `q-language-intelligence`: Offline and optional active-connection completion, documentation, symbols, navigation, rename, folding, selection, semantic highlighting, and call hierarchy, plus the first-party `.qnb` authoring, q-only execution, compatibility, and persistence lifecycle.
- `q-formatting`: Conservative, deterministic q document and range formatting with semantic-safety and suppression guarantees.
- `q-diagnostics`: Parse diagnostics and configurable high-confidence q lint rules with stable codes and suppression behavior.

### Modified Capabilities

None. The existing `chart-resampling` and `q-list-grid` requirements remain unchanged and are explicit regression boundaries for this change.

## Impact

- Extension host: language-client lifecycle, settings, active-connection metadata bridge, `.qnb` serializer/controller and notebook integration, output/diagnostic logging, activation performance, and disposal.
- New language-server code: shared lexer/parser/document index, formatter, linter, static q reference catalog, and LSP providers.
- Static language assets: `syntaxes/q.tmLanguage.json`, `language-configuration.json`, and optional snippets generated or validated from the shared lexical model.
- Tests and packaging: deterministic unit fixtures, LSP/provider integration tests, `.qnb` compatibility/round-trip tests, extension-host notebook smoke tests, dependency/license audit, VSIX contents, and 0.2.24 release metadata.
- Dependencies include the pinned VS Code language-client/server packages and Apache-2.0 Chevrotain 13.2.0, adapted from the audited KX parser while removing its obsolete Chevrotain 11/lodash dependency chain; native binaries and a q runtime are not required.
- Host compatibility changes from `engines.vscode: ^1.96.0` to `^1.101.0`. VS Code 1.101 is the first stable release whose Extension Host uses Node 22; users on 1.96–1.100 must update VS Code or remain on extension 0.2.23.
- The established q Professional `.qnb` cell-array structure becomes a newly supported input/output contract. Existing persisted notebook MIME v1/v2, saved results, q-value identity, settings already in use, request/reset/stale-response behavior, query IPC, Results panel rendering, resampling, and list-grid contracts do not change.
