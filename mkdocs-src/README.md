# Documentation Maintainer Notes

The documentation site is built with MkDocs Material from the Markdown files in this directory. MkDocs writes the generated static site to `../docs/`.

## Exact Pages gate

Use a clean Python virtual environment and the pinned requirements:

```sh
python3 -m venv /tmp/vscode-kdb-docs-venv
. /tmp/vscode-kdb-docs-venv/bin/activate
python -m pip install --requirement mkdocs-src/requirements.txt
mkdocs build --strict
python .github/scripts/clean-mkdocs-output.py docs
git diff --exit-code -- docs
test -z "$(git status --porcelain -- docs)"
```

The final two commands are the same generated-docs verification gate used by the Pages workflow. Edit source under `mkdocs-src/`; do not hand-edit generated files under `docs/`.

For a local preview:

```sh
mkdocs serve
```

## Extension checks

Run the standalone extension checks independently of the documentation build:

```sh
npm ci
npm run compile
npm test
npm run test:parity:self
npm run test:notebook-python
npm run test:notebook-cross
npm run test:extension-host
```

For a release candidate, require the live IPC check instead of allowing it to skip:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

Set `VSCODE_KDB_Q_BIN=/absolute/path/to/q` when q is not at the runner's default location.

The 0.2.6 release uses the standalone parity self-tests above. Do not run the separate cross-extension gate when the pinned reference checkout must remain completely unmodified: that gate compiles both checkouts even though it guards tracked reference state.

The checked [`PARITY_RUN.md`](https://github.com/dreth/vscode-kdb/blob/main/PARITY_RUN.md) remains pre-0.2.0 `VALID_WITH_KNOWN_GAPS` evidence; it is not migration, native-controller, complete functional, or visual parity evidence. Pure/provider/source tests cover detailed routing and UI contracts. `npm run test:extension-host` adds scoped non-visual activation, isolated multi-profile configuration, exact active selection, and real notebook language conversion/restoration; it does not automate the connection webview, kernel selection, toolbar/status layout, QuickPick interaction, or visual execution.

For release candidates, package the explicit versioned VSIX, create the required one-member wrapper with Python's `zipfile`, and run the repository auditor:

```sh
npx @vscode/vsce package --out vscode-kdb-0.2.6.vsix
python - <<'PY'
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

source = Path("vscode-kdb-0.2.6.vsix")
with ZipFile("vscode-kdb-0.2.6-vsix.zip", "w", ZIP_DEFLATED, compresslevel=9) as archive:
    archive.write(source, arcname=source.name)
PY
python scripts/audit-release.py vscode-kdb-0.2.6.vsix vscode-kdb-0.2.6-vsix.zip
```

`scripts/audit-release.py` validates the VSIX and an already-created wrapper; it does not create either artifact.

## Workflow behavior

`.github/workflows/pages.yml` builds strictly, normalizes `docs/`, fails if committed output drifts, and uploads `docs/` as the `github-pages-docs` artifact on non-pull-request runs. It intentionally has no deployment job and does not change repository Pages configuration.
