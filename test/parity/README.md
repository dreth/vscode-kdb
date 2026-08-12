# Cross-extension verification

Run from the `vscode-kdb` repository root:

```sh
npm run test:parity
```

The runner compiles both checkouts, runs focused and required live-q suites, and applies common deterministic and anonymous live-q fixtures to public/core boundaries exposed by both products. It does not install dependencies, package, stage, reset, commit, or publish. Reference tracked/index state is checked before and after every reference command; a compile may refresh ignored `out/**`.

If the original reference checkout must remain byte-for-byte untouched, clone it
to a disposable directory, give that clone a satisfied dependency tree, and use
the root/revision overrides below. Do not run the compiling gate directly against
the protected checkout.

Defaults:

- reference checkout: `/opt/data/home/projects/kdb-sqltools`
- required reference commit: `b1e77c361cff685384bedfdc948078b2a597b9e3` (`v0.3.21`)
- required q executable: `/opt/data/home/.kx/bin/q`

Overrides are explicit:

```sh
KDB_SQLTOOLS_PARITY_ROOT=/absolute/reference/path \
KDB_SQLTOOLS_PARITY_REVISION=<full-reference-commit> \
VSCODE_KDB_Q_BIN=/absolute/path/to/q \
npm run test:parity
```

Set `VSCODE_KDB_PARITY_REVISION` to require an exact standalone commit. The runner fails before compilation when a path, package identity, revision, dependency tree, q executable, or reference state is wrong. Only pre-existing unstaged tracked `docs/**` drift is accepted, and its exact status snapshot must remain unchanged.

Every stable case ends as:

- `PASS`: common fixture behavior was executed and proved equivalent;
- `DIFFERENT_BY_DESIGN`: asserted product boundaries intentionally differ and the rationale is recorded;
- `GAP`: a known mismatch or missing fixture remains, with a follow-up action; or
- `NOT_TESTABLE_HERE`: the current environment cannot exercise the boundary.

The default command exits zero when results match their registered classifications. Infrastructure failures, reference-state drift, unexpected mismatches, new gaps, or classification drift exit nonzero. Strict mode requires a clean standalone worktree and exits `2` while any registered `GAP` remains:

```sh
npm run test:parity:strict
# equivalent:
PARITY_STRICT_GAPS=1 npm run test:parity
```

The runner writes no files. Progress and diagnostics go to stderr. A completed run writes one concise machine-readable line to stdout:

```text
PARITY_RESULT_JSON={"schemaVersion":1,...}
```

Raw ZIP metadata, random local-server tokens, allocated loopback ports, and generated IDs are canonicalized after validation. Result order, chart series and warnings, export text, and error classes remain significant.

The shared q fixture is anonymous and loopback-only. It does not exercise authenticated endpoints, a VS Code Extension Host, visual rendering, spreadsheet applications, SSH/TLS services, installation, or publication.
