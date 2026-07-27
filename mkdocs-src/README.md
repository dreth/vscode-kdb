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
npm run test:parity
npm run test:notebook-python
npm run test:notebook-cross
npm run test:extension-host
npm run test:notebook-results-visual
```

For a release candidate, require the live IPC check instead of allowing it to skip:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

The full parity gate compiles its reference checkout. If that checkout must remain
byte-for-byte untouched, point `KDB_SQLTOOLS_PARITY_ROOT` and
`KDB_SQLTOOLS_PARITY_REVISION` at a disposable clone with a satisfied dependency
tree rather than the protected checkout.

Set `VSCODE_KDB_Q_BIN=/absolute/path/to/q` when q is not at the runner's default location.

The checked [`PARITY_RUN.md`](https://github.com/dreth/vscode-kdb/blob/main/PARITY_RUN.md) remains pre-0.2.0 `VALID_WITH_KNOWN_GAPS` evidence; it is not migration, current notebook, or complete functional/visual parity evidence. Pure/provider/source tests cover detailed routing and UI contracts. `npm run test:notebook-cross` installs exactly `kx-notebook==0.1.0`, imports `kx_notebook`, and validates the released MIME contract. `npm run test:extension-host` uses isolated VS Code user data and the actual store for two application/global profiles, exact active selection, same-ID port `5005`→`5000` edit/current target resolution, default controller non-registration, cleanup, and real q-language/KX metadata persistence through save, close, and reopen; that smoke is non-visual. `npm run test:notebook-results-visual` separately executes real q in VS Code under Xvfb and keeps the existing set of 12 validated screenshots, including light/dark tables/charts, visible/hidden legends, dark-axis readability, narrow selector containment, and Settings Auto/scroll/dismissal evidence. That acceptance is local Linux Extension Host/Xvfb plus loopback q only. Remote/devcontainer acceptance was not run, and the unavailable Docker daemon blocks Docker-backed coverage.

For release candidates, package the explicit versioned VSIX, create the required one-member wrapper with Python's `zipfile`, and run the repository auditor:

```sh
npx @vscode/vsce package --out vscode-kdb-0.2.8.vsix
python - <<'PY'
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

source = Path("vscode-kdb-0.2.8.vsix")
with ZipFile("vscode-kdb-0.2.8-vsix.zip", "w", ZIP_DEFLATED, compresslevel=9) as archive:
    archive.write(source, arcname=source.name)
PY
python scripts/audit-release.py vscode-kdb-0.2.8.vsix vscode-kdb-0.2.8-vsix.zip
```

`scripts/audit-release.py` validates the VSIX and an already-created wrapper; it does not create either artifact.

## Workflow behavior

`.github/workflows/pages.yml` builds strictly, normalizes `docs/`, fails if committed output drifts, and uploads `docs/` as the `github-pages-docs` artifact on non-pull-request runs. It intentionally has no deployment job and does not change repository Pages configuration.
