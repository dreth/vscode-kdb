# q Professional replacement parity

Version 0.2.24 is intended to replace q Professional for the team's core q workflow without importing proprietary implementation material.

| Workflow | KX for VS Code 0.2.24 |
| --- | --- |
| `.q` syntax highlighting | First-party generated TextMate grammar; works without q or the language server. |
| Completion, hover, signatures | Offline q catalog and lexical/workspace bindings, with official documentation links. Optional active-process names/types are default-off. |
| Navigation/refactoring | Symbols, definition/references/highlights, conservative rename, bracket-call hierarchy, semantic tokens, folding, and selection ranges. Dynamic ambiguity fails closed. |
| Diagnostics | Lexical/delimiter errors plus five configurable conservative lint rules and comment directives. No speculative undefined-name/type lint. |
| Formatting | Explicit token-preserving indentation/trailing-trivia formatter for `.q`, q-in-`.ipynb`, and q-in-`.qnb`; no internal expression rewrite. |
| q-only notebooks | Compatible top-level cell-array `.qnb` serializer, q/Markdown cells, permanent direct-q controller, current KX rich results, and lossless visible legacy-output fallback. |
| Mixed notebooks | Existing Python-first `.ipynb` flow remains separate; Python cells and Jupyter selection are not rerouted. |
| Connected schema help | Validated bounded tables/functions/variables and on-demand table `meta`; no values, previews, source, credentials, history, telemetry, or server-process IPC. |

Known boundaries:

- `.k` is not associated with q.
- Static q intelligence deliberately omits uncertain dynamic evaluation, general type inference, and ambiguous rename/navigation.
- `.qnb` compatibility covers the observable JSON contract and preserves unknown JSON-compatible data within documented bounds. It does not claim proprietary internal behavior.
- If q Professional remains enabled, overlapping q providers and `*.qnb` serializers can conflict. Disable one extension per VS Code profile/workspace.
- VS Code 1.101 is the minimum for 0.2.24; use 0.2.23 on VS Code 1.96–1.100.
