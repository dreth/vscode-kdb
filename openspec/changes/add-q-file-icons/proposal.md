## Why

After removing the other q extension, standalone `.q` files have no q-specific Explorer/editor icon even though this extension owns their language tooling. `.qnb` already has a generic bundled SVG, but the user has supplied distinct transparent PNG artwork for both file types and expects each surface to identify itself consistently.

## What Changes

- Add a q language icon contribution for `.q` files using the supplied `q.png` for both light and dark themes.
- Replace the `.qnb` notebook contribution's generic SVG with the supplied `qnb.png`.
- Package both PNG assets in the VSIX and add focused manifest, asset-integrity, and release-inventory regression coverage.
- Preserve the existing q language ID, `.q` association, syntax highlighting, formatting, diagnostics, notebook selector/controller, and every execution/result contract.
- Non-goals: define a complete VS Code file-icon theme, override a user's selected icon theme, recolor/redesign the supplied artwork, associate `.k` with q, or change notebook serialization/execution.

## Capabilities

### New Capabilities

- `q-file-icons`: Defines the q-specific icon contributions and packaged asset identity for `.q` and `.qnb` files.

### Modified Capabilities

None.

## Impact

The extension manifest, `icons/` assets, deterministic manifest/package guards, release audit allowlist, changelog, and packaged VSIX inventory are affected. There is no runtime API, dependency, persisted notebook, language-service, query, Results, or renderer contract change; VS Code and the active file-icon theme remain responsible for final presentation.
