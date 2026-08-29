## Context

See `proposal.md` for motivation and `specs/q-language-intelligence/spec.md` for the revised behavior. `decodeQnb` currently decodes UTF-8 and immediately parses JSON, so an empty byte sequence reaches `JSON.parse("")` and fails. `QnbNotebookSerializer` is otherwise a thin model-to-VS-Code adapter, and serialization already writes the canonical top-level cell array.

The manifest currently gives language `q` light/dark q artwork and gives the `vscode-kdb-q-notebook` contribution the qnb artwork. VS Code's file-icon-theme resolver obtains extension-provided Explorer fallback artwork from registered language IDs; the notebook icon is a separate surface. There is no `qnb` language contribution, so `.qnb` has no language-icon fallback. The packaged 0.2.26 manifest/assets are valid, while the inspected stable and WSL extension directories contain older installed versions, which is a distinct deployment-state failure that package tests alone cannot detect.

The qnb cell array, unknown compatible data, output MIME v1/v2, live-result identity, execution/reset/stale-response behavior, and `.ipynb` ownership are compatibility boundaries. Blank bootstrap has no result or execution downstream consumer until the user runs the new cell.

## Goals / Non-Goals

**Goals:**

- Make the host-neutral qnb decode boundary recognize only semantically blank UTF-8 input as a new one-cell q notebook.
- Make that bootstrap state an explicit unsaved in-memory change so ordinary Save invokes the serializer without writing during open.
- Give `.qnb` the language association Explorer needs while keeping notebook code cells and language tooling on `q`.
- Verify both repository/package contributions and the version of the extension actually installed for manual acceptance.

**Non-Goals:**

- Write canonical JSON or otherwise mutate the filesystem merely because blank input was opened.
- Recover, normalize, or replace any nonblank invalid qnb content.
- Add grammar, formatting, diagnostics, or activation behavior for the icon-carrier `qnb` language ID.
- Own a complete file-icon theme or make guarantees against a selected theme that disables contributed language icons.

## Decisions

### Bootstrap at the qnb decode boundary

After the existing bounded fatal UTF-8 decode and leading-BOM normalization, detect `text.trim().length === 0` before JSON parsing and return the same immutable model as one empty q code cell with no outputs or unknown fields. Keeping the exception in the host-neutral codec gives unit tests and every serializer consumer one policy; special-casing only the VS Code adapter was rejected because it would create two definitions of valid qnb input. Performing the check before UTF-8 validation or the size bound was rejected because invalid or oversized bytes must not be relabelled as a new notebook.

### Opening is disk-nonmutating; the in-memory bootstrap is deliberately dirty

The codec labels only its synthetic one-cell model as a blank bootstrap. The serializer carries that state into `NotebookData` through an extension-owned document-metadata marker that is never serialized. When the qnb document opens, `QnbNotebookSupport` removes the marker through a notebook metadata edit exactly once. VS Code therefore treats the synthetic bootstrap as an unsaved in-memory change and ordinary Save invokes the existing serializer, while no filesystem write occurs during open. The serializer then writes the standard pretty-printed cell array and VS Code clears the dirty state.

Treating the synthetic cell as the clean loaded baseline was rejected because VS Code does not invoke a notebook serializer when the document is clean, so Ctrl+S would leave a zero-byte file unchanged. Writing from the open callback was rejected because opening a file must not unexpectedly mutate disk state. Replacing the cell solely to induce dirty state was rejected because it creates unnecessary cell-identity churn; the owned metadata edit is document-scoped and invisible in the persisted cell-array contract.

### Add a minimal qnb language contribution alongside the notebook contribution

Add language ID `qnb` with only `.qnb` and the qnb light/dark PNG paths. Keep the existing `vscode-kdb-q-notebook` selector/icon and keep serializer-created code cells as language `q`. This mirrors VS Code's separation between file-label resolution and notebook/cell ownership. Associating `.qnb` directly with language `q` was rejected because it would make a JSON notebook file look like q source when explicitly reopened as text. A bundled icon theme was rejected because selecting it would affect global file-icon behavior.

### Verify stale installation separately from packaged correctness

Deterministic tests will pin both language contributions, notebook selection, asset hashes, and the blank/nonblank decode boundary. Extension Host coverage will create an actual zero-byte `.qnb`, open it, confirm one q cell and the qnb controller, save, and reopen the compatible JSON. Release acceptance will inspect the packaged manifest/assets and query the target VS Code installation's installed extension version after VSIX installation/reload. This distinguishes a correct package that is not active from a broken contribution; inferring activation from files left in an extension directory was rejected because VS Code profiles and remote hosts can select different extension locations.

## Risks / Trade-offs

- [Whitespace-only content becomes a dirty notebook seed on open and compatible JSON on explicit Save] → Disk remains unchanged until Save, and only content with no non-whitespace characters qualifies; all nonblank invalid content continues to fail closed.
- [The `qnb` language ID is visible when a user explicitly reopens a qnb as text] → Give it no grammar or language service and verify normal Open still resolves the notebook type with q code cells.
- [A file-icon theme can suppress contributed language artwork] → Keep theme precedence explicit and verify behavior under a theme that permits language fallback rather than claiming unconditional display.
- [The correct VSIX can appear broken when an older local or remote extension remains active] → Include installed-version/profile/remote-host verification in release acceptance and troubleshooting.

## Migration Plan

1. Add failing codec/serializer, dirty-state, manifest, and real Extension Host regressions for blank qnb and qnb file identity.
2. Implement the narrow bootstrap model, one-time in-memory dirty transition, and minimal qnb language contribution.
3. Update documentation/changelog and regenerate MkDocs output.
4. Run the full deterministic and Extension Host gates, package/audit the next patch VSIX, install it into the target host, and verify the active version and icon-permitting theme.
5. Roll back by restoring strict blank-input rejection and removing only the `qnb` language contribution. Any blank notebook already saved is ordinary compatible qnb JSON and needs no data migration.
