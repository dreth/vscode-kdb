## Why

Notebook table scrolling can jump back toward the top as the renderer updates its rows or recalculates visible-row widths. At the same time, `.qnb` saves reject a complete Direct IPC result once pretty-printed notebook JSON exceeds 16 MiB, even though the output contract promises complete persisted results. The fixed file cap makes a successful query impossible to save or reopen.

## What Changes

- Keep the vertical and horizontal position of live and saved notebook table viewports stable while virtual rows, slices, and visible-row column widths update.
- Remove the fixed 16 MiB `.qnb` read/write ceiling. Valid notebooks of any byte size can be saved and reopened, subject to available host memory and filesystem capacity.
- Reduce large-save overhead by writing compact JSON and avoiding a redundant copy of output JSON already owned by the serializer. Existing indented notebooks stay readable; all exact values and metadata remain preserved.
- Avoid constructing another complete typed-result object tree when saving JSON output. Emit compact live MIME bytes explicitly rather than using VS Code's indented JSON factory. Add privacy-safe save timing/byte diagnostics and a realistic constrained-heap regression.
- Retain the top-level cell array, UTF-8, JSON structure/depth, cell/output-count, MIME, transient-field sanitization, and exact-result validation rules. File-system or allocation errors remain visible; no result is silently truncated.
- Add regression coverage for scrolling and a `.qnb` round trip larger than the former cap, and update the notebook guide and changelog.

## Capabilities

The live-scroll follow-up also removes repeated complete MIME parsing from host ownership checks. Unchanged byte output may reuse a bounded validation proof; metadata, exact bytes, duplicate claims, and notebook/cell/session ownership remain checked. Saved output remains complete and passive actions do not execute q.

### New Capabilities

None.

### Modified Capabilities

- `notebook-q-execution`: Save/reopen of complete `.qnb` output and stable live/saved inline table scrolling.

## Impact

`src/qnb-codec.ts`, the notebook renderer in `renderer/index.ts`, notebook tests, OpenSpec, and notebook documentation. `.ipynb` serialization remains owned by VS Code/Jupyter; both `.qnb` and `.ipynb` use the affected renderer. KX Results panel behavior and MIME v1/v2 schemas are unchanged.
