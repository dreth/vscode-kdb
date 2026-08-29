## 1. Regression Contracts

- [x] 1.1 Add focused host-neutral codec/serializer cases for zero-byte, BOM-only, and whitespace-only qnb input producing one empty q code cell, an owned bootstrap marker, and canonical JSON on serialization; verify the cases fail before the fix and that nonblank malformed/invalid UTF-8/oversized inputs still throw.
- [x] 1.2 Extend deterministic manifest guards to require exact `q`/`.q` and icon-only `qnb`/`.qnb` language contributions, the unchanged `vscode-kdb-q-notebook` selector/icon, both pinned PNG hashes, no `.k` association, and no contributed file-icon theme; verify the old manifest fails the qnb association assertion.
- [x] 1.3 Extend the Extension Host qnb phase to create and open an actual zero-byte `.qnb`, verify the file remains zero bytes after open while the editor shows one q code cell with the dedicated qnb controller and dirty state, then save/reopen and verify compatible cell-array JSON, clean state, and unchanged notebook ownership.

## 2. Blank Notebook And File Identity

- [x] 2.1 Implement the bounded UTF-8 blank bootstrap at the shared qnb decode boundary and verify all task 1.1 cases pass without weakening existing compatible-data, output, and safety-bound tests.
- [x] 2.2 Propagate the blank-bootstrap marker through the serializer and apply one extension-owned in-memory document metadata edit exactly once after open so the notebook becomes dirty without changing disk; report a visible error if VS Code rejects the edit.
- [x] 2.3 Add the minimal `qnb` language contribution with `.qnb` and qnb light/dark artwork while retaining the existing q language and notebook contributions; verify task 1.2 passes and qnb serializer-created code cells remain language `q`.
- [x] 2.4 Verify the release auditor resolves both language icon objects and the notebook icon to packaged assets, rejects a missing/altered q or qnb PNG, and does not require a complete icon-theme contribution.

## 3. Patch Release And Documentation

- [x] 3.1 Bump package, lockfile, language-server, tests, scripts, and current-version documentation to `0.2.27`, add a changelog entry for blank qnb bootstrap and Explorer icon identity, and verify all current release references are synchronized without rewriting historical changelog entries.
- [x] 3.2 Document flat-file `.qnb` creation, first-save behavior, file-icon-theme precedence, and how to verify the active local/remote installed extension version; rebuild MkDocs strictly and verify generated `docs/` matches `mkdocs-src/`.

## 4. Verification And Release Artifact

- [x] 4.1 Run `npm test` and verify the full compile, deterministic extension, qnb compatibility, manifest, and q language gates pass without changes to execution, Results, renderer, or saved rich-output behavior.
- [x] 4.2 Run `npm run test:extension-host` and verify the real zero-byte open/save/reopen scenario passes; if the host is unavailable, resolve the missing VS Code/Xvfb runtime rather than marking this task complete from mocks alone.
  - The real save phase passes the blank qnb and all other Extension Host assertions. The later fresh-host visual acceptance still times out on its pre-existing padded-family chart viewport gesture; it is outside the qnb bootstrap phase and is not counted as a qnb pass.
- [x] 4.3 Build `vscode-kdb-0.2.27.vsix` and its one-file wrapper, run the release audit, inspect the packaged manifest/assets, and query the target VS Code host with its installed-extension version command so a stale active version is not mistaken for an icon regression.
  - The queried WSL/remote host currently reports `danielalonso.vscode-kdb@0.2.18`; the audited 0.2.27 VSIX is not installed there automatically.
- [x] 4.4 Run strict OpenSpec validation and final diff/reference checks, then mark tasks accurately before archive or release handoff.
