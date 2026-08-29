## Why

A `.qnb` created as an ordinary zero-byte file is currently routed to the correct notebook serializer but rejected as malformed JSON, so VS Code cannot show the notebook editing surface. The 0.2.26 qnb artwork is also attached only to the notebook contribution, leaving Explorer without the language association it uses for extension-provided file-icon fallbacks; an older installed extension can similarly hide the already-correct `.q` artwork.

## What Changes

- Treat a zero-byte, BOM-only, or whitespace-only `*.qnb` as an intentional new q notebook and open it with one empty q code cell.
- Mark that in-memory bootstrap notebook as unsaved so ordinary Save persists the cell in the established top-level JSON cell-array format, without writing merely because the file was opened.
- Continue to reject every nonempty malformed, unsupported, oversized, or unsafe qnb visibly without erasing or replacing it.
- Add a minimal `qnb` language contribution for the `.qnb` filename/icon association used by Explorer while keeping every notebook code cell's language identifier `q` and retaining the existing notebook selector/icon.
- Preserve and verify the existing `.q` q-language artwork, package both exact PNGs, and add an installed-version check to distinguish a stale installed VSIX from a contribution failure.
- Non-goals: register a complete file-icon theme, override a selected third-party icon theme, associate `.k`, treat arbitrary malformed JSON as new, change `.qnb` execution/results/persistence after bootstrap, or change `.ipynb` ownership.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `q-language-intelligence`: Extend first-party qnb authoring to bootstrap blank filesystem-created notebooks and contribute a qnb filename/icon association without changing q cell language or the compatible persisted format.

## Impact

The qnb serializer boundary, extension manifest, deterministic codec/manifest guards, Extension Host notebook-open coverage, release install smoke, changelog, notebook documentation, generated MkDocs site, and VSIX audit are affected. The qnb codec's nonempty JSON validation, direct-q controller, query execution, Results/renderer contracts, saved rich output, Python companion, dependencies, settings, and user-selected file-icon theme remain unchanged.
