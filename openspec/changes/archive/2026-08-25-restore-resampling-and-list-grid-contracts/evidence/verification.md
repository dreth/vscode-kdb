# Verification record

Run from the repository root on 2026-08-25.

| Command | Outcome |
| --- | --- |
| `npm test` | Passed: 44 focused test groups, including chart density/pan reuse, list Grid/exact persistence, renderer/panel lifecycle, parity-contract, and manifest/source guards. |
| `npm run test:notebook-cross` | Passed: released `kx-notebook` 0.1.0 table, chart, and qText payloads validate/render through the TypeScript v1 contract. |
| `npm run test:notebook-python` | Passed: 22 Python notebook contract/magic tests. |
| `npm run test:live-q` | Completed successfully with the documented optional skip because no q executable is installed. A required live run is unavailable until `VSCODE_KDB_Q_BIN` points to q. |
| `npm run test:parity:self` | Environment-blocked after ten passing support groups: the runner preflight fixture requires its pinned reference repository, which is absent. No reference checkout or q executable is available for a valid override. |
| `npm run test:extension-host` | Environment-blocked after a successful compile: `/usr/bin/Xvfb` is absent. `/usr/bin/code` exists. |
| `npm run test:notebook-results-visual` | Not executable in this environment because both Xvfb and the required q executable are absent, as confirmed by the same runner prerequisites. |
| `env UV_CACHE_DIR=/tmp/vscode-kdb-uv-cache uv run --with-requirements mkdocs-src/requirements.txt mkdocs build --strict` | Passed; generated `docs/` from the documentation sources. |
| `python3 .github/scripts/clean-mkdocs-output.py docs` | Passed; normalized the generated documentation with the Pages workflow step. |
| `openspec validate restore-resampling-and-list-grid-contracts --strict` | Passed: change is valid. |
| `git diff --check` | Passed. |

The historical payload compatibility assertion explicitly confirms that an ordinary one-cell table containing a vector, without the standalone-list presentation marker, retains its prior interpretation. The candidate benchmark evidence and commands are recorded separately in `benchmark-summary.md` and the three machine-readable JSON files.
