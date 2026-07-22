# Cross-extension parity evidence run

This is a bounded executable evidence report, not a claim of complete functional or visual parity. The run result is **VALID_WITH_KNOWN_GAPS** and source-of-truth sign-off is **blocked**.

## Exact baseline

- Generated: `2026-07-22T07:58:03.967Z`
- Standalone: `48e79e8369f0139e18810834f0ff0bf1e1802272`, package `vscode-kdb@0.1.4`
- Reference: `af2c7c920932274f156e31832859fa262068effe`, package `kdb-sqltools@0.3.17`
- q runtime: `/opt/data/home/.kx/bin/q` (q 5 2026.05.01)
- Standalone tracked state: clean tracked worktree
- Reference tracked state: 55 pre-existing unstaged tracked docs/** entries only; excluded from source evidence
- Reference dirty snapshot SHA-256 before/after: `4a6f553c2235640548395d2c312b691bb1d50f9c80a4d4c94c6ec51dae8029ff` / `4a6f553c2235640548395d2c312b691bb1d50f9c80a4d4c94c6ec51dae8029ff`

The reference checkout was treated as read-only source evidence. Its pre-existing generated `docs/**` renderer drift was allowed only after verifying there were no staged or non-doc changes, and the exact tracked-status snapshot was unchanged after all reference commands.

## Commands and outcomes

| Check | Exact command | Status | Outcome |
| --- | --- | --- | --- |
| standalone dependencies | `npm ls --depth=0` | PASS | installed dependency tree satisfied package metadata |
| reference dependencies | `npm ls --depth=0` | PASS | installed dependency tree satisfied package metadata |
| standalone compile | `npm run compile` | PASS | > tsc -p ./ |
| reference compile | `npm run compile` | PASS | > tsc -p ./ |
| parity runner self-tests | `node test/parity/self-test.js` | PASS | 12 parity support test groups passed. |
| standalone focused suite | `node test/run.js` | PASS | 16 focused test groups passed. |
| standalone required live-q suite | `VSCODE_KDB_LIVE_REQUIRED=1 VSCODE_KDB_Q_BIN=/opt/data/home/.kx/bin/q node test/live/run.js` | PASS | Live direct q IPC test passed using /opt/data/home/.kx/bin/q |
| reference focused suite | `node test/run.js` | PASS | All kdb-sqltools tests passed. |
| reference required live-q suite | `KDB_Q_BIN=/opt/data/home/.kx/bin/q KDB_SQLTOOLS_LIVE_REQUIRED=1 node test/live/run.js` | PASS | Live kdb+/q test passed using /opt/data/home/.kx/bin/q |
| cross-extension same-fixture suite | `npm run test:parity` | PASS | 63 classified cases; 379 assertions; VALID_WITH_KNOWN_GAPS |

No documentation build, package command, reset, add, commit, or publication command ran in `kdb-sqltools`.

## Machine-readable counts

The complete machine-readable record is checked in as [`PARITY_RUN.json`](PARITY_RUN.json). Counts from that record:

```json
{
  "caseCount": 63,
  "classifiedCaseCount": 63,
  "assertionCount": 379,
  "byStatus": {
    "PASS": 49,
    "DIFFERENT_BY_DESIGN": 5,
    "GAP": 3,
    "NOT_TESTABLE_HERE": 6
  },
  "byEvidenceMode": {
    "deterministic": 38,
    "live-q": 14,
    "boundary": 11
  },
  "unexpectedCount": 0,
  "gateResult": "VALID_WITH_KNOWN_GAPS",
  "signoffReady": false
}
```

Deterministic unit equivalence and live direct-q equivalence are counted separately. Existing project-suite commands are recorded as checks and do not inflate parity case counts.

## PASS / DIFFERENT_BY_DESIGN / GAP / NOT_TESTABLE_HERE matrix

| Case | Area | Evidence | Classification | Evidence / disposition |
| --- | --- | --- | --- | --- |
| `ipc-query-serialization` | q IPC query serialization | deterministic | **PASS** | Synchronous char-vector query frames are byte-identical. |
| `ipc-decode-scalar-int` | q decode/display: primitive | deterministic | **PASS** | The same primitive payload and supported grid/qText choices were compared. |
| `ipc-decode-vector-int` | q decode/display: vector | deterministic | **PASS** | The same vector payload and supported grid/qText choices were compared. |
| `ipc-decode-mixed-list` | q decode/display: list | deterministic | **PASS** | The same list payload and supported grid/qText choices were compared. |
| `ipc-decode-dictionary` | q decode/display: dictionary | deterministic | **PASS** | The same dictionary payload and supported grid/qText choices were compared. |
| `ipc-decode-table` | q decode/display: table | deterministic | **PASS** | The same table payload and supported grid/qText choices were compared. |
| `ipc-decode-keyed-table` | q decode/display: keyed-table | deterministic | **PASS** | The same keyed-table payload and supported grid/qText choices were compared. |
| `ipc-decode-lambda` | q decode/display: function | deterministic | **PASS** | The same function payload and supported grid/qText choices were compared. |
| `ipc-decode-primitive-function` | q decode/display: function | deterministic | **PASS** | The same function payload and supported grid/qText choices were compared. |
| `ipc-decode-q-error` | q decode/display: error | deterministic | **PASS** | The same error payload and supported grid/qText choices were compared. |
| `result-display-legacy-aliases` | q grid/qText settings aliases | deterministic | **DIFFERENT_BY_DESIGN** | SQLTools retains legacy table/text aliases. Standalone accepts only its KX-owned grid/qText core contract and normalizes UI settings at its own panel boundary. |
| `editor-exact-selection-current-line` | exact selection and physical current line | deterministic | **PASS** | Selections, whitespace, CRLF lines, and clamped cursor positions use the same exact-text contract. |
| `editor-blank-line-q-block-helper` | blank-line-bounded q block execution | deterministic | **GAP** | Rank 3: Make an explicit first-party product decision: implement a standalone q-block helper/command with tests, or formally exclude it and reclassify this row by design. Sign-off: The reviewed decision is documented and the executable case asserts the resulting standalone contract. |
| `namespace-root-passthrough` | root namespace exact-text passthrough | deterministic | **PASS** | Both public query wrappers preserve root-namespace q text byte-for-byte. |
| `namespace-wrapper-surface` | namespace and multiline wrapper surface | deterministic | **DIFFERENT_BY_DESIGN** | Standalone owns strict-root Server Explorer execution and a .Q.ld script wrapper; SQLTools exposes its legacy raw namespace wrapper through the driver. Semantic common behavior is tested live below. |
| `chart-line-temporal-unsorted` | chart data engine: line | deterministic | **PASS** | The same rows, selection, grouping, validation, and sampling request were executed by both pure engines. |
| `chart-scatter-multiple-series` | chart data engine: scatter | deterministic | **PASS** | The same rows, selection, grouping, validation, and sampling request were executed by both pure engines. |
| `chart-step-grouped` | chart data engine: step | deterministic | **PASS** | The same rows, selection, grouping, validation, and sampling request were executed by both pure engines. |
| `chart-bar-grouped` | chart data engine: bar | deterministic | **PASS** | The same rows, selection, grouping, validation, and sampling request were executed by both pure engines. |
| `chart-box-repeated-x` | chart data engine: box | deterministic | **PASS** | The same rows, selection, grouping, validation, and sampling request were executed by both pure engines. |
| `chart-candlestick-ohlc-aggregation` | chart data engine: candlestick | deterministic | **PASS** | The same rows, selection, grouping, validation, and sampling request were executed by both pure engines. |
| `chart-line-minmax-sampling` | chart data engine: line | deterministic | **PASS** | The same rows, selection, grouping, validation, and sampling request were executed by both pure engines. |
| `chart-candlestick-invalid-high` | chart data engine: candlestick | deterministic | **PASS** | The same rows, selection, grouping, validation, and sampling request were executed by both pure engines. |
| `chart-ohlc-exported-aggregation` | candlestick OHLC aggregation | deterministic | **PASS** | The exported OHLC aggregator preserved first-open, max-high, min-low, last-close and exact/bucket counts. |
| `export-text-tsv` | text export: TSV | deterministic | **PASS** | Exact export text, escaping, headers, row index, nested values, and line breaks were compared. |
| `export-text-csv` | text export: CSV | deterministic | **PASS** | Exact export text, escaping, headers, row index, nested values, and line breaks were compared. |
| `export-text-json` | text export: JSON | deterministic | **PASS** | Exact export text, escaping, headers, row index, nested values, and line breaks were compared. |
| `export-text-ndjson` | text export: NDJSON | deterministic | **PASS** | Exact export text, escaping, headers, row index, nested values, and line breaks were compared. |
| `export-text-html` | text export: HTML | deterministic | **PASS** | Exact export text, escaping, headers, row index, nested values, and line breaks were compared. |
| `export-text-markdown` | text export: MARKDOWN | deterministic | **PASS** | Exact export text, escaping, headers, row index, nested values, and line breaks were compared. |
| `export-xlsx-sheet-limits` | XLSX Excel sheet limits | deterministic | **PASS** | Header/index expansion at Excel row and column limits produced identical validation results. |
| `export-xlsx-structure` | XLSX workbook structure | deterministic | **PASS** | Private test adapters generated the same unzipped OOXML entries; ZIP timestamps/compression bytes were excluded. |
| `ipc-connect-refused-classification` | direct IPC refused connection | deterministic | **PASS** | Both direct clients rejected a closed loopback endpoint as a phase-bearing IPC error without query data. |
| `ipc-handshake-timeout-classification` | direct IPC handshake timeout | deterministic | **PASS** | A TCP peer that never completes q IPC handshake produced the same phase/timeout class and closed cleanly. |
| `ipc-query-timeout-anonymity` | direct IPC query timeout and error anonymity | deterministic | **PASS** | A stalled issued query timed out in the query phase, destroyed the uncertain transport, and omitted q source text from errors. |
| `ipc-genuine-q-error-and-reuse` | genuine q error lifecycle | deterministic | **PASS** | An encoded q error stayed KdbQError and the same healthy socket served the following query. |
| `ipc-split-timeouts-and-diagnostics` | direct IPC timeout and diagnostics ownership | boundary | **DIFFERENT_BY_DESIGN** | Standalone owns split connect/query deadlines plus a KX OutputChannel/redaction schema. The pinned SQLTools adapter retains one timeoutMs and console performance tracing. |
| `local-data-server-http-contract` | local data server token/range/format behavior | deterministic | **PASS** | Both loopback servers exercised valid/invalid tokens, methods, endpoints, metadata, current/slice/selection CSV/JSON/NDJSON, headers, ranges, and limits. |
| `local-data-server-empty-result-wording` | local data server product wording | deterministic | **DIFFERENT_BY_DESIGN** | The same no_current_result protocol code is retained, while user-facing text names the owning KX result versus the SQLTools kdb panel. |
| `live-q-scalar` | live direct-q: primitive | live-q | **PASS** | Both raw IPC clients queried the same anonymous loopback q process and compared decoded values/errors. |
| `live-q-vector` | live direct-q: vector | live-q | **PASS** | Both raw IPC clients queried the same anonymous loopback q process and compared decoded values/errors. |
| `live-q-mixed-list` | live direct-q: list | live-q | **PASS** | Both raw IPC clients queried the same anonymous loopback q process and compared decoded values/errors. |
| `live-q-dictionary` | live direct-q: dictionary | live-q | **PASS** | Both raw IPC clients queried the same anonymous loopback q process and compared decoded values/errors. |
| `live-q-table` | live direct-q: table | live-q | **PASS** | Both raw IPC clients queried the same anonymous loopback q process and compared decoded values/errors. |
| `live-q-keyed-table` | live direct-q: keyed-table | live-q | **PASS** | Both raw IPC clients queried the same anonymous loopback q process and compared decoded values/errors. |
| `live-q-lambda` | live direct-q: function | live-q | **PASS** | Both raw IPC clients queried the same anonymous loopback q process and compared decoded values/errors. |
| `live-q-primitive-function` | live direct-q: function | live-q | **PASS** | Both raw IPC clients queried the same anonymous loopback q process and compared decoded values/errors. |
| `live-q-temporal-values` | live direct-q: temporal | live-q | **PASS** | Both raw IPC clients queried the same anonymous loopback q process and compared decoded values/errors. |
| `live-q-genuine-q-error` | live direct-q: error | live-q | **PASS** | Both raw IPC clients queried the same anonymous loopback q process and compared decoded values/errors. |
| `live-namespace-root-passthrough` | live direct-q namespace execution/restoration | live-q | **PASS** | Both namespace wrappers ran against the same q process and restored the prior root namespace on success/error. |
| `live-namespace-analytics-query` | live direct-q namespace execution/restoration | live-q | **PASS** | Both namespace wrappers ran against the same q process and restored the prior root namespace on success/error. |
| `live-namespace-analytics-error` | live direct-q namespace execution/restoration | live-q | **PASS** | Both namespace wrappers ran against the same q process and restored the prior root namespace on success/error. |
| `live-q-multiline-script-grouping` | live direct-q multiline script grouping | live-q | **GAP** | Rank 2: Backport a compatible q-native script-grouping adapter to the SQLTools driver without changing its UI/session ownership. Sign-off: The shared LF and CRLF script fixtures return 30 and 5 through both adapters and restore the root namespace after success/error. |
| `manifest-standalone-runtime-boundary` | standalone manifest/package boundary | boundary | **PASS** | The standalone manifest/lock version stayed aligned and no SQLTools runtime, extension dependency, command, configuration, or source import entered the KX package. |
| `manifest-product-ux-ownership` | KX versus SQLTools product ownership | boundary | **DIFFERENT_BY_DESIGN** | Standalone owns the KX sidebar/form, SecretStorage, focused Server Explorer, Query History, and one KX result target. Reference owns SQLTools driver/session/UI targets and its extension dependency. |
| `standalone-extension-host-automation` | standalone Extension Host automation | boundary | **GAP** | Rank 1: Add a standalone Extension Host suite for activation, KX connection tree/form/SecretStorage, commands, result-panel protocol, cancellation, and settings without importing SQLTools. Sign-off: The suite runs in CI and locally on a supported VS Code build from a clean standalone commit. |
| `extension-host-visual-manual` | VS Code Extension Host and visual/manual UX | boundary | **NOT_TESTABLE_HERE** | Neither code nor code-insiders is installed, and this repository has no truthful cross-extension visual browser/Extension Host fixture. Source and webview parsing are not visual evidence. |
| `authenticated-q-endpoint` | authenticated direct q IPC | boundary | **NOT_TESTABLE_HERE** | The shared fixture is deliberately anonymous and loopback-only; no authenticated endpoint was available or invented. |
| `remote-secure-endpoints` | SSH/TLS/IPv6/remote endpoint behavior | boundary | **NOT_TESTABLE_HERE** | Only anonymous IPv4 loopback direct q was authorized. No SSH/TLS service, remote host, IPv6 listener, or multi-version q matrix was available. |
| `xlsx-application-rendering` | spreadsheet application rendering | boundary | **NOT_TESTABLE_HERE** | The gate proves OOXML ZIP structure and limits but no Excel/LibreOffice GUI application was available for visual rendering. |
| `marketplace-package-publication` | VSIX install and Marketplace publication | boundary | **NOT_TESTABLE_HERE** | This is not a feature release; the gate intentionally does not create a user-facing VSIX, install from Marketplace, or publish. |
| `server-side-cancellation-after-dispatch` | server-side q cancellation after dispatch | boundary | **NOT_TESTABLE_HERE** | Both public products document local wait/transport cancellation limits; the harness does not claim reliable interruption of already-dispatched q work. |
| `documentation-no-complete-parity-claim` | documentation conclusion boundary | boundary | **PASS** | Current standalone documentation explicitly denies complete functional/visual parity and defers source-of-truth sign-off. |

`PASS` means the common fixture and product boundary shown in that row were actually exercised. It does not generalize to the whole extension. `DIFFERENT_BY_DESIGN` means the difference was asserted and retained intentionally; it is not called a pass. `GAP` blocks source-of-truth sign-off until its condition is met. `NOT_TESTABLE_HERE` records a truthful external boundary rather than inventing a test.

## Ranked gaps before parity-program M3 sign-off

1. **standalone Extension Host automation:** Add a standalone Extension Host suite for activation, KX connection tree/form/SecretStorage, commands, result-panel protocol, cancellation, and settings without importing SQLTools. Sign-off condition: The suite runs in CI and locally on a supported VS Code build from a clean standalone commit.
2. **live direct-q multiline script grouping:** Backport a compatible q-native script-grouping adapter to the SQLTools driver without changing its UI/session ownership. Sign-off condition: The shared LF and CRLF script fixtures return 30 and 5 through both adapters and restore the root namespace after success/error.
3. **blank-line-bounded q block execution:** Make an explicit first-party product decision: implement a standalone q-block helper/command with tests, or formally exclude it and reclassify this row by design. Sign-off condition: The reviewed decision is documented and the executable case asserts the resulting standalone contract.

Here, “parity-program M3 sign-off” names the cross-extension source-of-truth evidence gate requested for this run; it is distinct from the repository roadmap's notebook-evaluation M3. Before that parity sign-off, every GAP above must be closed or reclassified through an explicit product decision backed by a new fixture and review. A clean-commit strict run (`npm run test:parity -- --fail-on-known-gap`) must exit zero. The Extension Host/manual evidence listed below must also be recorded, and any compatibility backport must pass the reference's full approved release gates in its own repository.

## Exact untestable boundaries

- **VS Code Extension Host and visual/manual UX:** Neither code nor code-insiders is installed, and this repository has no truthful cross-extension visual browser/Extension Host fixture. Source and webview parsing are not visual evidence. Required evidence: Record supported VS Code runs for activation, theme/layout, virtual scrolling, selection/keyboard, chart zoom/reset, settings, error states, and screenshots where useful.
- **authenticated direct q IPC:** The shared fixture is deliberately anonymous and loopback-only; no authenticated endpoint was available or invented. Required evidence: Run accepted and rejected credentials against an authorized real q endpoint and verify SecretStorage/error redaction without recording credentials.
- **SSH/TLS/IPv6/remote endpoint behavior:** Only anonymous IPv4 loopback direct q was authorized. No SSH/TLS service, remote host, IPv6 listener, or multi-version q matrix was available. Required evidence: Record separately authorized endpoint tests for every supported transport/address/q-version claim; keep standalone direct-only unless product scope changes.
- **spreadsheet application rendering:** The gate proves OOXML ZIP structure and limits but no Excel/LibreOffice GUI application was available for visual rendering. Required evidence: Open representative exports in supported spreadsheet applications and record data, escaping, dimensions, and limits.
- **VSIX install and Marketplace publication:** This is not a feature release; the gate intentionally does not create a user-facing VSIX, install from Marketplace, or publish. Required evidence: Use a separately authorized release gate for package inventory, clean Extension Host installation, identity, credentials, hashes, and Marketplace upload.
- **server-side q cancellation after dispatch:** Both public products document local wait/transport cancellation limits; the harness does not claim reliable interruption of already-dispatched q work. Required evidence: Define an authorized server interruption protocol and prove side-effect/cancellation semantics before claiming server-side cancellation.

The environment had no `code` or `code-insiders` command. No authenticated endpoint, VS Code Extension Host, visual browser, spreadsheet application, SSH/TLS service, Marketplace install, or publication was fabricated.

## Scope and conclusion

The executable gate compared q IPC decode/display semantics, editor-text and namespace contracts, all six chart data types, text/XLSX export structure, direct IPC lifecycle and errors, local HTTP behavior, manifest boundaries, and a shared anonymous q fixture where both public/core interfaces allowed it. Canonicalization was limited to asserted ephemeral ports, validated random tokens, path separators in paths, ZIP metadata, and fixed generated identifiers; row/column/dictionary/series/warning order and semantic error classes were preserved.

This run does **not** conclude that `vscode-kdb` and `kdb-sqltools` are functionally or visually identical. It creates repeatable evidence for the shared boundaries listed above and keeps the source-of-truth transition blocked by the recorded gaps and external verification requirements.
