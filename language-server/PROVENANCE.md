# q language tooling provenance

This ledger is part of the release artifact. It separates audited adaptations
from independently authored work and fixes the exact upstream revision used by
the 0.2.24 implementation.

## Apache-2.0 KX adaptation

- Upstream: `https://github.com/KxSystems/kx-vscode`
- Frozen commit: `955292b68a53179cb1865608e917d4bcdc833ca1`
- Upstream directory: `server/src/parser/`
- Local directory: `language-server/src/parser/`
- Copyright: KX Systems Inc.
- License: Apache License 2.0; see `APACHE-2.0.txt` and the retained headers.

The following local files adapt their same-named upstream files:

- `checks.ts`
- `index.ts`
- `keywords.ts`
- `language.ts`
- `lexer.ts`
- `literals.ts`
- `parser.ts`
- `ranges.ts`
- `source.ts`
- `tokens.ts`
- `utils.ts`

Modifications include migration from Chevrotain 11.1.2 to pinned Chevrotain
13.2.0, removal of lodash-based runtime assumptions, handling Chevrotain 13's
`-1` unavailable-location sentinel and stricter DSL types, q lexical gap fixes,
and a rewritten deterministic TextMate output using standard VS Code scopes.
Each adapted file retains the KX copyright and Apache header and names the
frozen commit.

No KX connection, notebook, UI, telemetry, build, asset, or documentation
implementation was copied.

## Independently authored implementation

The following language-server files were written for this repository from its
OpenSpec requirements and official q language facts rather than copied source:

- `src/catalog.ts`
- `src/formatter.ts`
- `src/providers.ts`
- `src/q-diagnostics.ts`
- `src/q-source.ts`
- `src/server.ts`
- `src/settings.ts`
- `src/testing.ts`
- `tsconfig.json`

The static catalog records short original summaries and links to official
`code.kx.com` pages; it does not reproduce upstream documentation prose.

## External package clean-room behavior reference

An all-rights-reserved third-party Marketplace q notebook package at version
5.0.1 (package date 2026-08-13) was inspected only as a behavioral
compatibility reference. Its observed public contribution/file contract was:

- notebook selector `*.qnb`;
- a q-only notebook/controller surface;
- a JSON top-level array of cells;
- cell fields `kind`, `language`, `value`, and `outputs`;
- output fields `mime` and `value`.

The local `.qnb` codec, serializer, fixtures, controller integration, and legacy
fallback were independently authored from that observable contract. No source,
bundle, grammar, generated parser, text, documentation, image, icon, binary, or
other artifact from that package is present. Historical GPLv3 source was
excluded. A historical MIT release was used only to confirm that its formatter
was empty; no code from it was required.

## Dependency licenses

- Chevrotain 13.2.0: Apache-2.0.
- `vscode-languageclient` 9.0.1: MIT.
- `vscode-languageserver` 9.0.1: MIT.
- `vscode-languageserver-textdocument` 1.0.13: MIT.

The applicable texts and notices are reproduced or identified in
`THIRD_PARTY_NOTICES.md`. The bundled dependency tree contains no Chevrotain
11, `lodash-es`, WebAssembly q grammar, or proprietary/GPL third-party q
extension artifact.
