## 1. Regression Contracts

- [x] 1.1 Extend the deterministic manifest test to require the q language's exact light/dark `q.png` mapping and the q notebook's `qnb.png` mapping while retaining the existing `.q` extension and `*.qnb` selector assertions; verify the focused test fails against the old manifest before implementation and passes afterward.
- [x] 1.2 Add self-contained asset-integrity assertions for PNG signatures, 1254-by-1254 RGBA IHDR data, distinct bytes, and the two pinned SHA-256 digests; verify the assertions reject a missing, altered, or swapped asset.

## 2. Icon Contributions And Assets

- [x] 2.1 Copy the supplied `q.png` and `qnb.png` byte-for-byte into `icons/` and verify their repository hashes are `b33d7e9ed95cbcef3a30e90ea38ab8f15f732dbfa73c69b7cedd1c91ad8eb47a` and `4d07d8596d63a0b6612e3b4c9b1e11d0edc3de2692056cb01f9e4ef9e5d1be71`.
- [x] 2.2 Add the light/dark q language icon object and replace only the q notebook icon path in `package.json`; verify the focused manifest test passes and all language IDs, extensions, notebook IDs, and selectors remain unchanged.
- [x] 2.3 Remove the superseded `icons/q-notebook.svg`, replace it with both PNGs in the release audit's required inventory, and verify a repository-wide reference search has no stale SVG path.

## 3. Release Record And Verification

- [x] 3.1 Bump the package and lockfile to `0.2.26`, add the q/qnb icon contribution to the `0.2.26` changelog without claiming a file-icon-theme override, and verify all release version references are synchronized.
- [x] 3.2 Run `npm test` and verify the full compile, deterministic extension, and q language test gates pass without changes to Results, execution, renderer, or notebook persistence code.
- [x] 3.3 Build `vscode-kdb-0.2.26.vsix`, recreate its wrapper archive, run `scripts/audit-release.py`, and verify the packaged manifest references and contains both exact PNG assets while excluding the obsolete notebook SVG.
- [x] 3.4 Run strict OpenSpec validation, inspect the final diff for icon-only scope, and mark every completed task accurately before archiving or release handoff.
