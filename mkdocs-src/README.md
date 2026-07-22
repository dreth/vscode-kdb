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
node test/run.js
npm test
```

When a local q executable is available, require the live IPC check instead of allowing it to skip:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

Set `VSCODE_KDB_Q_BIN=/absolute/path/to/q` when q is not at the runner's default location.

## Workflow behavior

`.github/workflows/pages.yml` builds strictly, normalizes `docs/`, fails if committed output drifts, and uploads `docs/` as the `github-pages-docs` artifact on non-pull-request runs. It intentionally has no deployment job and does not change repository Pages configuration.
