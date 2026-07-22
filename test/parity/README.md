# Cross-extension parity gate

Run the executable evidence gate from the `vscode-kdb` repository root:

```sh
npm run test:parity
```

The runner compiles both checkouts, runs its own self-tests, runs the reference focused and required live-q suites, and then applies common deterministic and anonymous live-q fixtures to the public/core boundaries that both products expose. It never installs dependencies or edits tracked reference source/docs, packages, stages, resets, commits, or publishes the reference repository. The approved reference compile can refresh ignored `out/**`; ignored build output is excluded from source evidence while tracked/index state is guarded before and after every reference command.

Defaults:

- reference checkout: `/opt/data/home/projects/kdb-sqltools`
- required reference commit: `af2c7c920932274f156e31832859fa262068effe`
- required q executable: `/opt/data/home/.kx/bin/q`

Overrides are explicit:

```sh
KDB_SQLTOOLS_PARITY_ROOT=/absolute/reference/path \
KDB_SQLTOOLS_PARITY_REVISION=<full-reference-commit> \
VSCODE_KDB_Q_BIN=/absolute/path/to/q \
npm run test:parity
```

Set `VSCODE_KDB_PARITY_REVISION` to require an exact standalone commit. The runner always prints the actual commits and tracked-state disclaimers. It fails before compilation when the path, package identity, revision, dependency tree, q executable, or approved reference dirty state is wrong. Only the pre-existing unstaged tracked `docs/**` reference drift is accepted, and its byte-exact porcelain snapshot must remain unchanged after every reference command.

Every stable case ends as:

- `PASS`: common fixture behavior was executed and proved equivalent;
- `DIFFERENT_BY_DESIGN`: asserted product boundaries intentionally differ and the rationale is recorded;
- `GAP`: a ranked compatibility or evidence gap remains, with an action and sign-off condition; or
- `NOT_TESTABLE_HERE`: an external boundary cannot be represented honestly in this environment, with required future evidence recorded.

The default command exits zero for a valid evidence run with registered gaps. It exits nonzero for infrastructure failure, reference-state drift, an unexpected mismatch, a new gap, or classification drift. Strict sign-off mode requires a clean standalone worktree and exits `2` while any registered `GAP` remains:

```sh
npm run test:parity:strict
# equivalent:
PARITY_STRICT_GAPS=1 npm run test:parity
```

Update the checked evidence snapshot only as an explicit action:

```sh
npm run test:parity -- --write-report
```

That writes `PARITY_RUN.json` and `PARITY_RUN.md`. The JSON is the complete machine-readable record; Markdown is generated from it. Raw ZIP bytes, random local-server tokens, allocated loopback ports, or generated IDs are not treated as semantic differences. Canonicalization validates those fields before replacing them and preserves result order, chart series/warnings, export text, and error classes.

The shared q fixture is anonymous and loopback-only. The gate does not invent an authenticated endpoint, VS Code Extension Host, browser/visual test, spreadsheet application, SSH/TLS service, Marketplace install, or publication evidence.
