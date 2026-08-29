## Context

See `proposal.md` for motivation and `specs/q-file-icons/spec.md` for the user-visible contract. The extension currently contributes the `q` language and its `.q` extension without a language icon. Its q-only notebook contribution selects `*.qnb` and references `icons/q-notebook.svg`. The supplied `q.png` and `qnb.png` files are distinct 1254-by-1254, 8-bit RGBA PNGs. Their source SHA-256 digests are respectively `b33d7e9ed95cbcef3a30e90ea38ab8f15f732dbfa73c69b7cedd1c91ad8eb47a` and `4d07d8596d63a0b6612e3b4c9b1e11d0edc3de2692056cb01f9e4ef9e5d1be71`.

The manifest is the shared source of truth consumed by VS Code and packaging. Deterministic tests also treat its q language keys, notebook icon path, and packaged release inventory as explicit contracts. This is a presentation-only contribution: extension-host execution, Results, notebook output, persistence, reset, stale-response, and error lifecycles are not downstream consumers and must remain untouched.

## Goals / Non-Goals

**Goals:**

- Wire the exact supplied artwork into the existing q language and q notebook contributions.
- Make the manifest references and binary asset identities deterministic and release-auditable.
- Remove the superseded generic notebook SVG once no contribution or release check references it.

**Non-Goals:**

- Add an extension-owned file-icon theme or bypass a user's selected theme.
- Process, resize, recolor, optimize, or otherwise rewrite either supplied PNG.
- Change language, notebook, execution, renderer, Results, or saved-output behavior.

## Decisions

### Use the language contribution's light/dark icon pair for `.q`

Add `icon.light` and `icon.dark` to the existing `q` language contribution, with both entries pointing at `./icons/q.png`. This uses VS Code's native language-icon fallback while preserving the current `.q` association and respecting the active file-icon theme. A complete file-icon theme was rejected because it would compete with user theme preferences and require ownership of unrelated file types. Separate light and dark derivatives were rejected because the supplied transparent artwork is designed to serve both and must remain unmodified.

### Replace the q notebook contribution icon in place

Change only the existing `vscode-kdb-q-notebook` icon path to `icons/qnb.png`, retaining its ID, display name, `*.qnb` selector, serializer, and controller. Reusing `q.png` was rejected because the supplied notebook artwork intentionally distinguishes q notebooks from q source files. Keeping the old SVG as a fallback was rejected because the notebook contribution accepts one icon and the superseded asset would create ambiguous release inventory.

### Preserve the supplied binaries byte-for-byte

Copy the two source PNGs into `icons/q.png` and `icons/qnb.png` without an image pipeline. Focused tests will validate the PNG signature and IHDR properties, distinctness, and the expected SHA-256 digests. Hash pinning is appropriate here because the user's exact artwork is part of the requested presentation contract; dimensions alone would not detect unintended replacement or recompression. Depending on the external Downloads paths at test time was rejected because builds and CI must be self-contained.

### Extend existing manifest and release guards

Update the deterministic manifest assertions to require the exact q light/dark mapping and qnb icon path while continuing to assert the existing language ID, `.q`-only extension list, notebook type, and selector. Update the release audit's required inventory from the old SVG to both PNGs, then verify the packaged VSIX contains those exact files. New runtime helpers or UI tests were rejected because icon resolution is declarative and the relevant regression boundaries are the manifest and packaged assets.

## Risks / Trade-offs

- [The PNGs add roughly 900 KB before VSIX compression] → Retain the exact requested assets and use the existing release-size audit to expose an unacceptable package increase rather than silently rewriting them.
- [A user's file-icon theme may replace or hide contributed language artwork] → Document this as VS Code theme precedence; do not introduce a competing icon theme.
- [Manifest path syntax differs between language and notebook contribution schemas] → Use the schema-appropriate forms and cover both with manifest and packaged-inventory tests.
- [Removing the old SVG could break an unnoticed reference] → Search the repository and generated package inventory before deletion, and make tests fail on any stale reference.

## Migration Plan

1. Copy and verify the two supplied PNGs in `icons/`.
2. Update the two existing manifest contributions and their deterministic guards.
3. Replace the old SVG in release requirements and remove it after confirming no references remain.
4. Run focused tests, the full deterministic suite, build the `0.2.26` VSIX, and audit its manifest and inventory.
5. Roll back by restoring the prior manifest entries, audit inventory, and SVG; no persisted data or runtime migration is involved.
