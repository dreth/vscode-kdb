# q language tooling

KX for VS Code 0.2.44 provides one offline-first q authoring model for `.q` files, q-language Jupyter cells, and every code cell in a `.qnb` notebook. It requires VS Code 1.101 or newer because the bundled language stack targets the Extension Host's Node 22 runtime. Extension 0.2.23 remains the fallback for VS Code 1.96–1.100.

## Included features

- generated TextMate highlighting for q comments, commands, strings and escapes, symbols, numeric and temporal literals, qSQL, built-ins, system namespaces, delimiters, iterators, projections, and operators;
- contextual catalog, lexical binding, workspace binding, and namespace completion;
- official-documentation hover for built-ins plus conservative source hover and signature help;
- document/workspace symbols, definition, references, highlights, rename, and statically resolved bracket-call hierarchy;
- semantic tokens, folding, expanding selection, syntax diagnostics, and conservative lint diagnostics; and
- explicit whole-document and complete-line range formatting.

All offline analysis is local. It does not run q, call a shell, send source to a connection, write Query History, or require Python. Query execution remains available even when a source diagnostic exists. TextMate highlighting remains available when `vscode-kdb.languageServer.enabled` is false or the language server cannot start.

Static q analysis deliberately fails closed where q is dynamic. It does not guess general runtime types, undefined names, dynamic `value`/`eval` targets, symbol lookups, process state, or qSQL column identity. Ambiguous definitions are omitted from navigation and rename rather than editing an uncertain target.

Highlighting uses stable, standard roles across `.q`, q-language Jupyter cells, and `.qnb` code cells. Every ordinary data identifier uses the exact unmodified semantic `variable` selector at definitions and reads, including local/global and namespace-qualified names, repeated assignments, `::` and augmented writes, destructuring targets, read-before-definition occurrences, and unresolved external names. A directly assigned lambda and its safely resolved references use the function role; parameters, qSQL columns, built-ins, qSQL words, and documented system names retain their respective distinct roles. An inline lambda nested inside an assignment, such as an `update` expression, does not turn the assignment target into a function.

Generic visual classification does not claim that a name was resolved. An unresolved identifier receives the neutral q variable category for consistent display but gains no source hover, definition, references, rename, call hierarchy, connected metadata, inferred callability, or diagnostic fact. Static scope and declaration facts remain available internally for names that can be resolved safely.

The extension assigns TextMate scopes and semantic-token roles, not foreground colors. It contributes q-specific semantic fallbacks so an ordinary `variable` returns to `variable.other.q` when the active theme has no explicit semantic rule. Your VS Code color theme and user customizations still decide the final colors and may intentionally render different roles—such as functions, parameters, and qSQL properties—differently. Disabling the language server removes semantic refinement but retains activation-free TextMate highlighting.

## Formatting and lint controls

The formatter changes only safe leading indentation and trailing horizontal whitespace. It preserves token order, internal expression spacing, strings, symbols, comments, commands, line count, final-newline state, and whether a script line is top-level or an indented continuation. Malformed or uncertain source receives no edit. Comment-token regions can be preserved with:

```q
// vscode-kdb-format-off
       source:"kept exactly   "
// vscode-kdb-format-on
```

Linting defaults to five high-confidence rules: `q.deprecated-datetime`, `q.unused-parameter`, `q.unused-local`, `q.declared-after-use`, and `q.unindented-continuation`. Configure their severity under `vscode-kdb.languageServer.lint.rules`, or use `off`. The supported comment directives are:

```q
// vscode-kdb-lint-disable-next-line q.unused-local
// vscode-kdb-lint-disable q.deprecated-datetime
// vscode-kdb-lint-enable q.deprecated-datetime
```

Directives suppress only named lint rules. Lexical and delimiter errors remain visible.

To make this extension the default q formatter:

```json
{
  "[q]": {
    "editor.defaultFormatter": "DanielAlonso.vscode-kdb"
  }
}
```

## Optional connected metadata

`vscode-kdb.languageServer.connectedIntelligence` defaults to `false`. When enabled with an active connected direct-q profile, completion and hover can include current-namespace table, function, and variable names. Table columns are requested with bounded on-demand `meta` only when a qSQL statement statically identifies that table.

The Extension Host performs those queries through the existing active connection. The separate language-server process receives only validated names, q type metadata, active connection ID, namespace, and a local generation. It receives no password, username, host, port, source text, query result value, preview, query history, live handle, or telemetry. Root and table metadata are bounded, canceled after five seconds, cached for 30 seconds, and invalidated on disconnect, profile/namespace changes, or **KX: Refresh q Language Metadata**. A stale, malformed, canceled, oversized, or failed response falls back to offline results.

Official syntax references: [q syntax](https://code.kx.com/q/basics/syntax/), [q by example](https://code.kx.com/q/learn/q-by-examples/), [qSQL](https://code.kx.com/q/basics/qsql/), and [system commands](https://code.kx.com/q/basics/syscmds/).
