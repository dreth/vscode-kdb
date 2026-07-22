# Feedback

Use the [vscode-kdb GitHub issue tracker](https://github.com/dreth/vscode-kdb/issues) for bugs, capability requests, and documentation corrections.

Before filing, check the source-backed [`PARITY.md`](https://github.com/dreth/vscode-kdb/blob/main/PARITY.md). A documented standalone boundary is still useful feedback, but it should not be reported as a regression from a feature the extension never claimed.

## Useful report details

- KX for VS Code version or commit.
- VS Code version and operating system.
- kdb+/q version.
- Whether the target is loopback, private network, or a separately managed tunnel.
- Endpoint host category and port, with sensitive infrastructure generalized when needed.
- Which command and execution mode failed: current line, single-line selection, multiline selection, or script.
- For notebooks: Python/IPython and `kx_notebook` versions, whether an explicit callback or optional PyKX adapter was configured, presentation setting, marker row/byte limits, persisted preview/total row counts, and whether the issue occurs in VS Code rendering, reopen, or static HTML/PDF export.
- Result shape and approximate rows/columns for viewer, chart, copy/export, or performance problems.
- Minimal reproduction steps and expected/actual behavior.
- Relevant **View > Output > KX** records after reviewing them for environment-sensitive metadata.
- Whether `vscode-kdb.performance.trace` was enabled.

Never include passwords, authentication strings, SecretStorage contents, tokenized local-data-server URLs, proprietary result values, or production query text. Diagnostics are designed to omit credentials and query values, but review copied output before posting it publicly.

For charting reports, include the chart type, selected column kinds, whether grouping was enabled, and the displayed sampling/warning status. For notebook charts, also distinguish the emitted persisted specification from renderer-only session changes. For cancellation reports, distinguish local panel cancellation from explicit connection disconnect.
