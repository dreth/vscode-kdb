# add-q-language-tooling

Deliver first-party q editor, language-server tooling, and compatible q-only `.qnb` notebooks for the 0.2.24 release so q Professional is no longer required for core authoring workflows.

## 0.2.23 baseline evidence

Captured on 2026-08-25 before product-code changes, using Node 22.17.0 and VS Code 1.132.0 on Linux x64. Temporary benchmark files, user data, and downloaded packages live under `/tmp`, not in the repository.

| Gate | Baseline |
|---|---|
| Focused project gate | `npm test` passed all 44 focused groups in 13.123 seconds wall time. The renderer bundle was 323.6 KiB. |
| Published VSIX | Marketplace 0.2.23 artifact: 675,395 bytes, 176 files, 2,567,519 expanded bytes, SHA-256 `acf3ff2f7318f90ddee8b477ecf22b4dff9aaa5a85ca6b9a302725dc0cef0f7a`. The HTTP transfer was gzip-compressed to 652,889 bytes. |
| Extension activation | Isolated Extension Host: 94.391 ms, 39,057,468-byte heap used, 176,603,136-byte RSS immediately after activation. |
| Representative large q file | A deterministic 2,000,000-byte/36,364-line `.q` file opened in 87.910 ms; editor show plus a fixed 250 ms settle took 311.607 ms. Extension-host heap used was 37,654,096 bytes and RSS was 197,267,456 bytes. |

Environment notes:

- The machine's Proto npm shim attempted to update permissions in a read-only tool directory. Baselines therefore use the pinned Node 22.17.0 tool directory first on `PATH`; this changes no repository input.
- The focused suite requires a loopback socket and passed when allowed to bind `127.0.0.1`; the sandbox-only attempt failed before the affected test with `listen EPERM`.
- The full repository Extension Host wrapper could not start because `/usr/bin/Xvfb` is absent. Dedicated activation and large-file Extension Host benchmarks ran successfully against the existing display with isolated `/tmp` user-data and extension directories.
- A local `vsce package` of the clean branch reports the pre-existing `extension/out/extension.js` missing because `out` is ignored by `.gitignore`; task 1.2 must fix package inclusion. The immutable published 0.2.23 VSIX above is the package-size baseline.

## Implementation gate evidence

Recorded on 2026-08-26 with Node 22.17.0:

- The bundled language server type-checks, starts over IPC, initializes, shuts
  down without stderr, and is included as `out/q-language-server.js`.
- The extension host, language server, renderer, JSZip, uPlot, and language
  client dependencies are self-contained bundles. The packed VSIX contains no
  `node_modules`, TypeScript, source map, test, or WebAssembly file.
- `/tmp/vscode-kdb-foundation-trimmed.vsix` contained 16 files, measured
  565,506 bytes, and had SHA-256
  `be11eaaf34549a31e0e6dca5522967147757bf1feb18ebb21e3ef337fa5149e5`.
- `npm ls --omit=dev --all` resolved Chevrotain exclusively at 13.2.0 and found
  no Chevrotain 11 or `lodash-es`; `npm audit --omit=dev` reported zero
  vulnerabilities.
- `language-server/PROVENANCE.md`, the retained adapted-source headers,
  `THIRD_PARTY_NOTICES.md`, and `language-server/APACHE-2.0.txt` record the KX,
  Chevrotain, language-protocol, and clean-room q Professional boundaries.
- Tree and VSIX scans found no q Professional source/bundle/grammar/asset,
  GPL-covered source, Chevrotain 11, `lodash-es`, or WASM artifact.

## 0.2.24 release-candidate evidence

Recorded on 2026-08-26 with Node 22.17.0 after the version bump:

- `npm test` passed all 47 focused groups plus the real language-server IPC
  smoke. The focused groups explicitly retain chart per-series 7,000/3,000
  density and pan reuse, singleton-list Grid, q value identity, Results,
  notebook, execution, metadata privacy, lazy-client, and `.qnb` codec/controller
  contracts.
- `npm run test:language` passed the lexical/parser/source, completion, hover,
  signature, symbols/navigation/rename/call-hierarchy, semantic-token, folding,
  selection, formatter, diagnostics, settings/workspace, connected-metadata,
  `.q`/`.ipynb`/`.qnb` notebook synchronization, and actual IPC request suite.
- `npm run test:notebook-cross` passed against the released
  `kx-notebook==0.1.0` package, and `npm run test:notebook-python` passed 22
  companion tests.
- `npm run benchmark:q-language` used a fixed 194,890-byte/4,000-line source:
  cold parse/index 1,825.51 ms, 100 warm provider requests 115.60 ms,
  edit-to-diagnostics 2,067.30 ms, formatting 1,726.34 ms, 250-file workspace
  index 11.54 ms, 1,000-cell `.qnb` decode/encode 8.12 ms, server
  initialize/shutdown 63.26 ms, and 168.29 MiB heap growth. The benchmark
  caught and removed quadratic diagnostic/scope lookup work before release.
- `npm audit --omit=dev` reported zero vulnerabilities and
  `npm ls --omit=dev --all` resolved only the pinned production dependency
  tree, including Chevrotain 13.2.0 with no `lodash-es`.
- Strict MkDocs generation succeeded with the pinned requirements and the
  normalized generated `docs/` tree. `openspec validate --specs --strict`
  passed all six permanent capabilities and
  `openspec validate add-q-language-tooling --strict` passed the change.
- `vscode-kdb-0.2.24.vsix` contains 17 files, is 576,590 bytes, and has SHA-256
  `bd8e33b25ecfe8fac5f5d35a5a02f3ad44119fe636ee112e39b0bdbb9887fd38`.
  It is 98,805 bytes smaller than the published 0.2.23 baseline. The release
  auditor verified two compiled modules, zero runtime-package/source/test/map
  artifacts, required licenses/provenance, manifest assets, archive safety,
  secret indicators, and the exact one-member wrapper. The wrapper SHA-256 is
  `de4521aadf63c518481bf62b2abf6a184e87712903d824365b1e5a31620d38a0`.

Environment-only gate notes:

- `npm run test:extension-host` compiled successfully but cannot start because
  `/usr/bin/Xvfb` is absent. The new real-host `.q` provider and `.qnb`
  save/close/reopen scenarios remain in `test/extension-host/index.js`; their
  host-neutral lifecycle/codec/controller equivalents pass in `npm test`.
- `VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q` cannot run because this host
  has no q executable. Connected metadata uses the same fake-runner IPC/cache
  implementation as Server Explorer and its deterministic failure/cancellation
  paths pass in `npm test`.
- `npm run test:parity:self` passed its first ten deterministic sections, then
  its runner-preflight section stopped because the configured legacy reference
  checkout is absent. No product parity assertion failed.
- Isolated GUI install smoke with q Professional absent/present is likewise
  unavailable without Xvfb. VSIX manifest/selector inspection passed, conflict
  behavior is documented, clean-room fixtures pass, and archive scans found no
  proprietary implementation artifact.

## Release result

- Release commit: `a2663a681d18c0749365824b13f330744cc06be0`
  (`release: vscode-kdb 0.2.24`).
- Annotated tag: `v0.2.24`, pointing to the release commit.
- Pushed refs: `origin/release/v0.2.23` advanced from `2007843` to `a2663a6`;
  new remote tag `v0.2.24` was created.
- Marketplace publication was attempted from the audited
  `vscode-kdb-0.2.24.vsix` and stopped after PAT verification failed with
  `TF400813`: configured user `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` is not
  authorized to access the publisher resource. No Marketplace success is
  claimed; retry requires a valid publisher PAT.
- Recoverable local artifacts remain at repository-root paths
  `vscode-kdb-0.2.24.vsix` and `vscode-kdb-0.2.24-vsix.zip` and remain excluded
  from source control.
