# qnb and Jupyter/IPython notebooks

KX for VS Code 0.2.44 supports a first-party q-only `.qnb` format and Python-first mixed `.ipynb`. For `.ipynb`, keep the normal Python Jupyter kernel selected, make only intended cells q, activate a saved KX profile, and run those q cells through Direct IPC. KX does not register its optional pure-q Jupyter controller by default, so **KX q (Direct IPC)** is absent from Jupyter kernel candidates. The notebook's top-right Jupyter selector itself remains visible and owned by VS Code/Jupyter.

## q-only qnb workflow

Run **KX: New q Notebook** or open `*.qnb`. The notebook type is `vscode-kdb-q-notebook`; every code cell is q and every narrative cell remains Markdown. Its dedicated **KX q (Direct IPC)** controller is registered unconditionally, preferred for every open `.qnb`, and independent of `vscode-kdb.notebook.enableDirectController`, which still controls only the optional Jupyter candidate. Use normal **Run Cell** or `Ctrl+Enter` (`Cmd+Enter` on macOS); `.qnb` deliberately has no mixed-Jupyter **Run q Cell (KX)** status action or competing KX shortcut.

Creating a flat empty file also works: `touch analysis.qnb`, or create `analysis.qnb` in Explorer, and open it normally. Zero-byte, BOM-only, and whitespace-only input becomes one empty q code cell and the tab is marked unsaved. The bytes on disk remain untouched until ordinary Save writes the compatible JSON cell array; after save/reopen the notebook is clean. Nonblank malformed or unsupported input still fails visibly and is never overwritten by the bootstrap path.

Normal **Run Cell**, **Run All**, and interruption use the globally active direct-q profile, complete current cell source, normal q execution ordering, and the same result conversion/live registry as direct q in `.ipynb`. Markdown is never executed. Python/Jupyter is never invoked. A leading `%%q` is rejected because a q-only cell already contains ordinary q.

The serializer uses a top-level JSON cell array. It preserves cell/source order, empty and multiline source including final newlines, Markdown, output order and MIME values, attachments, execution summaries, and bounded JSON-compatible unknown fields. Saves use compact JSON and validate JSON output without rebuilding every typed cell; existing indented notebooks remain readable. New Direct IPC output also uses compact MIME bytes. Live scrolling and output/menu ownership checks reuse validation for unchanged bytes, preserving strict current metadata and notebook/cell/session checks without repeatedly allocating the complete result during autosave. Code language is normalized to q. There is no fixed `.qnb` file-size limit: complete Direct IPC output can make the file large and take time and memory to save or reopen. Malformed UTF-8/JSON, invalid structure, excessive cell/output counts or nesting, and unsafe result data still fail visibly rather than opening/saving an empty notebook. **Output > KX** records `.qnb` serialization sizes and timings without result content; a `serialized` event precedes VS Code's actual file write.

Explorer and editor labels can use distinct supplied artwork for `.q` and `.qnb`. This is a language-icon fallback, not a bundled file-icon theme: the active file-icon theme retains precedence and may replace or suppress it. The `qnb` identity exists only for filename/icon resolution; notebook code cells remain language `q` and receive the same highlighting, formatting, and diagnostics as `.q` source.

Current `application/vnd.kx.result+json` output retains exact q identity and the shared KX renderer. Legacy `x-application/q-notebook` output is kept unchanged; recognized primitive-list shapes get a visible index/element fallback (or one cell for a singleton), while unsupported shapes get visible preserved JSON without guessed q conversion. Generated fallback text is not written as a duplicate output. Credentials, request/session/live IDs, and IPC handles are stripped on save; durable output binding remains available after reopen.

| Selected notebook kernel + cell | Use |
| --- | --- |
| Dedicated KX q controller + `.qnb` q cell | normal Run / `Ctrl` or `Cmd`+`Enter` |
| Python selected + Python cell | normal Run |
| Python selected + q cell | **Run q Cell (KX)** / `Ctrl` or `Cmd`+`Enter` / `Shift+Enter` / `Alt+Enter` |
| Optional KX q selected + q cell | normal Run, only after enabling `vscode-kdb.notebook.enableDirectController` |

VS Code selects one controller for the notebook. KX does not patch Jupyter or pretend built-in Run can dispatch cells through multiple selected controllers. **Run q Cell (KX)** is an explicit Direct IPC gesture for q-language cells; it leaves the Python controller and Python cells untouched.

## Default Python-first mixed workflow

Keep the normal Python Jupyter controller selected. Python cells continue to use Jupyter's Run commands, execution order, variables, and outputs. KX never changes their language, controller, or source.

For each intended q cell:

1. Click the leading **Make q Cell (KX)** action. It changes the complete code cell's language to q without changing the selected Python kernel.
2. Use the visible notebook-level **Active** item or **KX: Activate q Connection** to star one saved KX profile globally.
3. Use the leading **Run q Cell (KX)** play action, or select the q cell and use `Ctrl+Enter` / `Cmd+Enter` to run and stay, `Shift+Enter` to run and move next, or `Alt+Enter` (`Option+Enter` on macOS) to run and insert below.
4. Read the route from status: `KX: <profile> · Ctrl+Enter` (`Cmd+Enter` on macOS).

The action sends the complete cell source through the starred active connection's direct KX session. It does not require `%%q`, select the KX controller, or mutate the Python controller. **KX: Restore Notebook Cell Language** restores the notebook's declared default language.

Legacy `.ipynb` target `{id, name}` metadata remains safe to read but is ignored for routing. Every run uses only the current starred active profile from `ConnectionStore`; host, port, namespace, username, password, credentials, and connection objects are never copied into notebook metadata. KX does not implicitly dirty a notebook merely to remove legacy target metadata.

With no active profile the status shows **Activate connection** and prompts for explicit activation. Mixed q never routes to list order or a connected non-active profile.

Because Python remains the selected controller, public APIs do not let KX own a native cell execution in mixed mode. **Run q Cell (KX)** leaves the old output visible while q runs, then commits the finished KX output as one normal undoable notebook edit. If VS Code rejects that local edit while the q cell still has text focus, KX leaves edit mode and retries the same already-prepared output once; it never sends q again. Exact output identity is verified before the live result is rebound or run-and-stay focus is restored. The edit marks the notebook dirty until saved and gives that q cell a new internal VS Code cell handle. It preserves the q source, q language, cell metadata, and every sibling Python/Markdown cell; it does not copy an old native execution order/timing summary onto the new KX output. If the q cell source, language, output, or execution state changes while KX is waiting, KX refuses to overwrite the newer state.

### Selected q-cell shortcuts

While a tracked q cell is selected or its editor has text focus, KX preserves the normal notebook meanings:

- `Ctrl+Enter` on Windows/Linux or `Cmd+Enter` on macOS runs the complete q cell and stays;
- `Shift+Enter` runs it and moves to the next cell; and
- `Alt+Enter` (`Option+Enter` on macOS) runs it and inserts a code cell below.

Move/insert occurs only after the Direct IPC runner returns an executed result. A canceled, busy, stale, or failed run leaves the cell position unchanged. Every public manifest guard requires all of:

- notebook editor focus;
- notebook type `jupyter-notebook`;
- code cell type;
- selected cell resource present in KX's tracked q-cell resource set; and
- the optional **KX q (Direct IPC)** controller not selected.

They cannot match Python, Markdown, an ordinary source editor, or output focus. In those other states VS Code's normal notebook shortcuts remain in charge. Extension default bindings outrank the built-in notebook rules when these exact guards match, while later user/keymap rules can still override any default shortcut. If a shortcut was customized, use the toolbar/context/Command Palette action or inspect **Developer: Toggle Keyboard Shortcuts Troubleshooting**. Clicking normal Python Run on a q-language cell remains standard Jupyter behavior and is not secretly duplicated by KX.

## Optional pure-q Direct IPC controller

Set the application-scoped `vscode-kdb.notebook.enableDirectController` setting to `true` when a pure-q native-controller workflow is wanted. KX then registers:

- controller ID `vscode-kdb.q-notebook-controller`;
- notebook type `jupyter-notebook`;
- label **KX q (Direct IPC)**; and
- `supportedLanguages = ["q"]`.

The controller is created dynamically through the public `vscode.notebooks.createNotebookController` API and appears in VS Code's normal kernel picker. With it selected, normal **Run Cell**, **Run All**, or notebook shortcuts send the complete q cell through the active KX profile. Markdown is ignored. A non-q code cell is not dispatched to q, and a leading `%%q` is rejected because it belongs to the separate Python helper route.

Turning the setting off disposes the controller. A notebook that previously saved KX as its selected controller cannot keep forcing or restore that selection while KX is unregistered. This setting controls only the KX candidate; it does not remove or modify VS Code's top-right Jupyter selector. The manifest's `onNotebook:jupyter-notebook` event still activates the mixed runner for ordinary notebooks. No proposed/private affinity API, private Jupyter API, `ms-toolsai.jupyter` runtime import, or hidden command interception is used.

## Active connection and shared q session

Mixed cells and the optional pure-q controller use the active profile only. Both Direct IPC routes reuse its profile-keyed `ConnectionManager` client and q process/session; they do not open a connection per cell. Assignments, q variables, process configuration, and namespace state remain visible across q cells while that profile remains active.

Every direct q cell uses the same complete-source path as **Run q Script**. The extension groups physical q lines on the client, including indentation continuations, comments, top-level system commands, and q's bare-`\` trailing-script-comment convention, then evaluates the groups in order through ordinary q `value`. It saves the process's current namespace, enters the profile's configured namespace, and restores the saved namespace after success or q error. A source system command retains normal q semantics and can affect later groups within that run; the outer wrapper still restores the pre-run namespace afterward.

This path has no `.Q.ld` or q release-date gate. The extension does not enforce an exact minimum q version.

An active but disconnected profile may connect on demand after an explicit KX execution gesture. Both the mixed q-cell runner and **KX q (Direct IPC)** inherit that profile's effective query timeout: its `queryTimeoutMs` override when present, otherwise the global `vscode-kdb.queryTimeoutMs`, which defaults to `3600000` milliseconds (60 minutes). Neither route adds an independent 30-second notebook query ceiling; 30 seconds remains the separate TCP connect/q IPC handshake default. A missing active profile stays actionable rather than falling through. Connect, timeout, q, and decode failures become sanitized notebook error output; credentials are not included.

Cancellation before dispatch prevents the query. Cancellation after a synchronous IPC request was sent ends the local wait; mixed mode writes a cancellation result only if the q cell is still unchanged, while the optional selected controller completes its native execution. q work or side effects already sent may continue on the server.

Query History is enabled by default. Each q command actually issued by the first-party Direct IPC `.qnb` controller or mixed-Jupyter **Run q Cell (KX)** action creates one `notebook` history entry with source, connection identity, issue time, duration, and outcome. Set `vscode-kdb.features.queryHistory` to `false` to opt out. Pre-issue rejection creates no entry, and an output-commit retry never reissues or records the command again. Metadata refreshes, variable/table previews, renderer actions, and Python-owned `%%q` companion execution are outside this capture boundary. History records no result payload, persisted MIME output, live-result identity, credentials, or Python session data, and a history storage failure cannot change notebook execution or output.

## Live KX result and saved output

A successful first-party Direct IPC result from the default mixed runner or optional controller always has a complete durable representation and, when `maxOutputRows` is positive, a second session-only representation:

1. a complete, exactly represented `application/vnd.kx.result+json` version 2 payload with a fresh output identity and a bounded `text/plain` fallback stored in notebook output; and
2. only with a positive row setting, an extension-host live result backed by the decoded q value.

While a positive-mode live record exists, the notebook renderer uses the same first-party KX result model and display policies as the standard KX Results panel. Every execution gets a fresh output identity; positive mode also gets a fresh live identity and atomically binds supported mixed-output rewrites. With `maxOutputRows: 0`, the renderer immediately uses the complete saved MIME payload and sends no live-result request, while grid, search, selection, sizing, copy/export, qText, and chart behavior continue on that durable data. Rerun always dispatches the current cell source through exactly one new bridge/IPC call, even when its source and first displayed rows are identical, and replaces the cell with the complete new result. Stale renderer generations and requests cannot claim the new output. q general null/no-value responses produced by assignments, declarations, and calls such as `hopen`, plus generic empty values, render as compact qText. In Grid mode, standalone non-character lists with two or more elements use zero-based `index`/`value` rows, a singleton such as `enlist 4` is one `value` data cell without an index data cell, and an empty typed list keeps the two-column schema with no rows. Character vectors remain quoted strings. A genuine typed zero-row q table stays a table and retains its schema.

The renderer and standard panel consume one KX Results UI contract for toolbar labels, formats, chart families, settings definitions, state summaries, focus behavior, and theme tokens. A live table exposes **Output:**, CSV/XLSX/TSV/JSON/NDJSON/HTML/Markdown, **Headers**, **Row #**, **Copy**, **Export**, **Chart**, **Columns**, and **Settings**. XLSX is export-only. With no selected rectangle, Copy or Export uses every visible column in its current order; otherwise it uses the selected range. The toolbar wraps or overflows at narrow cell widths without removing working actions.

Live tables size naturally for small results and use a bounded default for larger results. The viewport can be resized vertically; horizontal and vertical scroll positions remain stable while virtual rows, columns, and slices update. Saved tables likewise keep their position while visible-row auto-fit adjusts widths. Headers and row numbers stay fixed without covering cells. Header click cycles source/ascending/descending order, movement of at least 5 CSS pixels reorders without sorting, `Ctrl`/`Cmd`+click or `Ctrl`/`Cmd`+Space selects a column, `Enter`/`Space` sorts, and `Alt`+Left/Right reorders. Accessible labels and `aria-sort` expose the current state. Column identity and order are source-ordinal and stay local to the logical output and valid schema, including duplicate names, live refresh, and saved-output rerender; they never leak when VS Code reuses a renderer item ID for another output.

Bounded Search retains explicit **Prev**/**Next** navigation, and drag/Shift/keyboard body selection remains available. Columns can be shown, hidden, reset, moved, and resized; drag a header edge to set one positional width or double-click it to reset that position. Live slice, search, sort, copy, export, and chart requests honor source ordinals in the visible order. A selected rectangle of at most 20,000 source cells and 2,000,000 realized characters can be copied through the owning extension-host record, including rows and more than 128 selected columns outside the currently loaded virtual slice; the host rechecks both live and saved-preview requests. File export is performed by the extension host and uses the shared advisory confirmation plus the realized hard limits in [Copy & Export](copy-export.md#guardrails).

Grid shading follows alternating logical displayed rows keyed by their absolute displayed-row ordinals, not by DOM position. Virtual scrolling, sort windows, and saved paging therefore retain stable stripes, while headers remain unstriped. The subtle colors come from VS Code theme tokens. Selection, hover, focused cells, sorted columns, search, loading, errors, and high-contrast or forced-colors states remain dominant.

Decoded keyed-table key columns also receive a restrained shared tint and accessible “key column” header semantics. This identity comes from the decoded key-table structure and original source ordinals—not names or query text—so it remains attached through sorting, hide/reorder, paging, and both virtualization axes. Ordinary tables with the same labels are not marked. Complete first-party portable-v2 output stores the key ordinals as optional validated schema metadata, preserving the cue after save/reopen; legacy output without that metadata stays compatible and unhighlighted.

Live sorts prompt only above `vscode-kdb.results.largeSortWarningRowThreshold`, whose 5,000,000-row default first warns at 5,000,001. A confirmed sort approves later sorts only for that exact live output; cancellation does not approve it. Rerunning or replacing the output, reopening the notebook, or receiving a new output identity resets approval. `vscode-kdb.results.hideLargeSortWarnings` remains the global opt-out.

Notebook and panel grids share one sparse map of persistent zero-based original/source-position widths plus the **Auto-fit columns** checkbox and **Whole result**/**Visible rows** scope. **Fit columns now** clears current-column overrides and reapplies that scope even when auto-fit is already checked; it never reruns q. The map is not limited by the notebook transport's bounded live-column count, and legacy array-shaped state is normalized on read. Hide/reorder operations do not retarget source slots. Visible rows is the default: checked auto-fit measures the rendered headers and on-screen cells, updating as a live grid scrolls or a saved grid scrolls/pages. Whole result remains an explicit stable-width option: a live record measures all rows in its full in-memory result, including off-screen array/list values, while saved output measures every row actually persisted in its complete Direct IPC payload or bounded Python-helper/historical preview. Unchecking auto-fit runs no automatic measurement. A manual drag turns auto-fit off and persists the chosen width; **Reset column widths**, **Cell width**, and density preset changes clear every positional override consistently.

The full panel retains interactions tied to its editor-sized host: the draggable table/chart splitter, running-query controls, local data server, and default-off column summary statistics. The notebook grid does not compute or display summaries. **Open in KX Results** hands the decoded live value to that exact panel when a positive-mode record exists. For zero-mode and reopened complete output, it reconstructs the panel result from complete saved MIME v2/v3/v4 without live-store access or q execution. A truncated saved preview remains limited to its persisted rows: omitted rows stay unavailable and the panel gives actionable rerun/live-result guidance rather than calling the preview complete.

Inline charts use the same real capability model as the panel:

| Type | Required controls | Group By |
| --- | --- | --- |
| Line, scatter, step, bar | X and one or more Y series | Any distinct bounded scalar column |
| Box | X and one or more numeric Y series | Any distinct bounded scalar column |
| Candlestick | X and distinct Open, High, Low, Close fields | Any distinct bounded scalar column |

Decoded q numeric types (`byte`, `short`, `int`, `long`, `real`, `float`) are valid Y/OHLC values. q `timestamp`, `month`, `date`, `datetime`, `timespan`, `minute`, `second`, and `time` columns are temporal X choices for every chart family above and are not offered as numeric Y/OHLC fields. Grouping accepts distinct categorical, boolean, GUID, numeric, and temporal scalar atoms while excluding complex values. It retains at most 12 categories and 36 generated series under one shared 7,000-visual-item budget. Box statistics and candlestick OHLC aggregation remain independent per group. Saved portable schema uses the same classification, and chart controls consider every explicitly visible column even when the grid currently renders a different horizontal window.

The notebook does not expose a redundant Point cap control. Shared `vscode-kdb.results.viewer.chartMaxSourceRows` and the fixed density contract still bound work, and live inline chart requests have a hard 10,000-point safety ceiling. Compact status text distinguishes eligible source rows from returned points or family-specific visual items and names the active temporal or observation sampling level. Configuration changes leave the old rendered chart visible until **Render** is pressed; navigator, zoom, and reset input stays disabled until that explicit render completes. A compact overview directly below the main plot shows the immutable full X domain and a selected window. Drag the window to pan, drag either edge to resize, or use the focusable window/handles with bounded arrow-key adjustments. Pointer-driven plot, visible-Y, and navigator synchronization is coalesced to at most one pending browser-frame update, while pointer completion flushes the exact final range synchronously. Plain main-plot drag zoom remains available; Home and Reset restore the immutable full range. There are no dedicated Pan or Refine buttons. Multi-series charts keep a visible color-keyed legend; its pointer and **Enter**/**Space** buttons expose accurate pressed/hidden state, and the Y-series selector repeats the same swatches beside selected and available names. The selector stays contained and scrollable at narrow widths. Axis labels/ticks remain readable while gridlines stay secondary because both use VS Code theme tokens rather than fixed light/dark colors. Legend-hidden series remain hidden through navigator changes, zoom, Reset/double-click, explicit rerender, resize, renderer settings messages, and compatible configuration updates.

Every distinct settled live navigator or main-plot range, including a second viewport change nested inside a refined response, uses its absolute range from the retained full source after the debounce. The navigator window, its two resize handles, and main-plot zoom all use the same range-loading and deterministic resampling decision. Identical scale notifications are deduplicated, while programmatic reconstruction/settings/resize/hide-show scales do not recursively request data. Initial/full and ranged line, scatter, and step views return every eligible observation at or below 7,000 and exactly 7,000 shared X samples above that bound; every selected Y series has one aligned slot per returned X. A completed zoom stays local while at least 3,000 retained samples remain visible. Below that threshold, the authoritative range is refilled to every eligible observation at or below 7,000 or exactly 7,000 otherwise. Compatible same-span temporal pans keep the same epoch-anchored time level; numeric pans keep the same observation policy. Both retain overlapping samples and process indexed newly exposed source slices instead of rescanning the complete source. Bar grouping, duplicate-X consolidation, box buckets, and candlestick aggregation can honestly produce fewer visual groups or candles. Late replies cannot overwrite a reset or newer range, Y remains automatic for visible X, and **Reset zoom** restores the original full sample/domain without another request. Saved charts navigate and rebuild only from their immutable complete output or bounded Python-helper/historical preview. **Export PNG** uses the extension save dialog.

`vscode-kdb.results.*` is the common durable settings source for notebook output and the standard panel. Supported density/sizing, positional column widths, auto-fit controls, copy/export threshold, large-sort threshold and global opt-out, array formatting, qText and value-display strategies, elapsed-time display, and chart precision/source guardrails use a validated renderer/extension message path. A supported setting or manual width changed inline updates the same global VS Code configuration used by other KX notebook outputs and open KX panels, and survives VS Code restart. `vscode-kdb.results.showColumnSummaryStatistics` is a durable panel-only exception and is not presented by the notebook Settings overlay. Stored font size `0` still means the VS Code default and remains numeric in messages/configuration; notebook Settings shows it as **Auto**. The overlay is constrained and scrollable within the result, has a visible **Close** action, closes with **Escape**, and returns keyboard focus to its summary. Selection, visible-column order, sort, search, result height, chart configuration, legend-hidden state, zoom, and navigator window remain transient per-output UI state.

### Exact live lifetime

For positive row settings, the live registry exists only in memory for the current extension-host session:

- every run receives fresh opaque output and live IDs bound to its notebook URI and current cell URI; supported output rewrites atomically move only that run's binding to the exact replacement cell/output;
- rerunning a cell replaces that cell's record without allowing a stale renderer generation or request to claim the new identity;
- clearing or removing a cell output removes its live record, so the old metadata cannot resurrect stale data;
- removing a cell removes that cell's record;
- closing a notebook removes all records for that notebook;
- deactivation clears the registry; and
- a maximum of 512 records is retained, with the oldest evicted first.

With `maxOutputRows: 0`, a new result never enters this registry and no live ID is written. A successfully committed zero-mode rerun removes the previous positive-mode record; if replacement fails, the still-displayed old output retains its valid binding. The opaque live ID used in positive mode is not an IPC handle and cannot recreate a result. Output metadata always carries a separate opaque binding ID so extension-host actions can target the exact cell output. It contains no result or connection data and grants no reopened live access. If a record is absent because zero mode was used, the output was cleared, the notebook was reopened, the extension host ended, the cell was rerun, the notebook closed, or the cap evicted it, the renderer uses only the complete saved Direct IPC payload or the rows actually present in a bounded Python-helper/historical preview.

Use VS Code/Jupyter's native **Clear Cell Output** and **Clear All Outputs** actions. Direct controller results are standard notebook outputs, so KX adds no custom clear button or command.

### Complete Direct IPC output and historical previews

| Limit | Default | Accepted range |
| --- | --- | --- |
| `vscode-kdb.notebook.maxOutputRows` | `20` | `0`-`10000` |
| `vscode-kdb.notebook.maxOutputBytes` | `1000000` | `16384`-`10000000` |

Every successful first-party Direct IPC execution automatically persists every exactly representable row, column, and cell in portable v2, v3 or v4. A positive `maxOutputRows` additionally retains the decoded q result in the session live cache and is used by the optional Tag/Prepare editing aid when it writes a `%%q --max-rows` marker for the separate Python helper. Set it to `0` to skip registering, staging, binding, or retaining that duplicate live result; Tag/Prepare then uses a positive `20`-row helper fallback because the companion's marker remains bounded. `maxOutputBytes` bounds the Direct IPC `text/plain` fallback and the explicitly bounded Python-helper/static output paths; it never silently truncates the authoritative Direct IPC rich payload.

From 0.2.42, all supported native q tables and keyed tables with authoritative typed columns use the versioned **v4 packed-column** format, regardless of row/cell count. Constant columns store one scalar, numeric columns use reversible binary encoding, and homogeneous nested numeric vectors store their exact elements, row boundaries and per-vector attributes once. Lossless compression reduces the JSON payload without rounding or truncation. Other shapes retain exact portable q-vector storage. This selects a storage format, not a row limit. Non-table results and row-table fallbacks without native typed columns retain v2, and existing v1/v2/v3 output remains readable. New v4 results require **0.2.40 or later**; v3 requires **0.2.39 or later**. Every returned cell, q type, vector attribute, structural key and durable output identity survives saving and reopening in both `.qnb` and `.ipynb`. Saved actions read the complete columns without rerunning q. The notebook remains self-contained JSON with no sidecars. Existing output keeps its format on open/save; rerun produces the new format. Use `maxOutputRows = 0` to avoid retaining a second raw live result.

Portable v2 exact q cells use a versioned typed representation for atoms, typed and mixed vectors, vector attributes, null/infinity sentinels, raw long/temporal values, symbols, chars, and nested values. Complete output survives ordinary `.ipynb` JSON save/reload. A standalone list presentation marker keeps the original vector stored once and derives the same empty/singleton/multi-element Grid after reopen; a vector-valued table cell without that marker is never reclassified. qText still formats the original vector. Default grid cells use concise familiar text for ordinary scalar booleans, numerics, temporals, GUIDs, nulls, and infinities; syntax remains where needed to distinguish backtick symbols from quoted character vectors and nested or special values. Table copy and every data export format use the shared analyst conversion described in [Copy & Export](copy-export.md), without changing exact cell metadata or the persisted q value.

Complete first-party v2 output also stores q table and keyed-table column-vector attributes (sorted, unique, parted, and grouped) by original source column, independently of structural key ordinals. This covers attributed value columns and zero-row typed columns in both `.qnb` and mixed `.ipynb`; their attributes and exact row cells survive save/reopen in positive and zero `maxOutputRows` modes. The grid, copy/export, and charts keep their existing row presentation. Older v1/v2 output without this metadata remains readable and has no inferred column attribute. An older extension cannot read newly written attributed results, which previously failed instead of producing output.

If a returned q value still cannot be represented exactly—currently including top-level dictionary identity—KX reports a bounded result-encoding failure with q type and value detail when available, without suggesting a connection test after q has returned. It does not flatten or stringify the value, silently truncate the rich payload, or substitute a preview under a complete label. Direct output excludes extension-managed connection credentials, session objects, and IPC handles; supported user-returned q values remain eligible for exact persistence. Direct output does not add `text/html` or a persisted chart specification; the separate Python companion can add escaped `text/html` and an optional chart specification. The first-party output-binding ID described above is opaque targeting metadata, not an authentication or data-recovery token, and the companion does not emit it.

Bounded first-party v1/v2 Direct IPC previews already saved in notebooks remain valid and are clearly labelled **Historical saved preview**. They retain only their stored rows, and opening, copying, exporting, or charting them never claims or reconstructs omitted data. **Rerun cell** executes the current cell source as exactly one new Direct IPC request, assigns a fresh output identity and a positive-mode live identity when applicable, and replaces the historical preview with a complete new output. Passive open, render, save/reopen, and KX Results handoff never requery q. The saved-result renderer otherwise keeps the same table hierarchy, shared output formats, visible-column controls, positional resizing/auto-fit behavior, header sorting, range behavior, explicit truncation notices, and capability-valid chart workflow. For unusually wide complete results, the saved grid and Columns control page through 256 columns at a time; grid search and selection apply to that displayed window, chart choices consider every explicitly visible saved column, and Copy/Export with no selection retains every visible saved column. Complete saved qText displays a clearly marked 1,048,576-character prefix while its Copy and Export actions retain the complete text. Whole-result auto-fit, saved zoom, and the navigator operate only within stored data. Direct saved-output chart choices remain transient and do not write a chart specification. A compatible chart specification emitted by the Python helper remains persisted. Python-helper HTML/PDF export uses its escaped, network-free static fallback and does not preserve arbitrary interactive controls.

`vscode-kdb.notebook.presentation` accepts:

- `inline` (default);
- `panel`; or
- `both`.

These automatic modes apply to Python-helper output. First-party KX Direct IPC results always remain inline beneath the cell and persist completely. A live value opens in the full panel while its record exists; reopened complete v2/v3/v4 output remains complete without that record. A bounded Python-helper or historical Direct IPC preview can open only its stored rows, and **Rerun cell** is an explicit new execution of current source rather than recovery of omitted preview rows.

## Separate Python `%%q` helper route

Use the released `kx-notebook==0.1.0` companion only when q should run through the selected Python/IPython kernel. Its distribution name is `kx-notebook`; its import and IPython extension name is `kx_notebook`. This is distinct from mixed mode's **Run q Cell (KX)**: the companion remains inside Python, requires `%%q`, and does not share q variables, namespace state, session identity, live-result records, or output-binding metadata with extension-managed Direct IPC.

Python 3.9 through 3.13 is supported. Install the exact release into the same environment selected as the notebook kernel:

```sh
uv venv /tmp/vscode-kdb-kx-notebook
uv pip install --python /tmp/vscode-kdb-kx-notebook/bin/python \
  'kx-notebook==0.1.0'
```

The package is not bundled in the VSIX, and the extension never installs or modifies a kernel environment automatically. q itself is not bundled.

Direct q IPC is built in. Start the q process separately, then load and connect from Python cells:

```python
%load_ext kx_notebook
%kx connect localhost:5000
```

The connection and its q state belong to the Python process, not KX for VS Code. Named companion profiles are selected explicitly with `%kx use PROFILE` or `%%q --profile PROFILE`; profiles may store endpoint and credential-lookup metadata, but not secret values.

Three alternatives to the default direct evaluator are explicit and opt-in:

- a synchronous application callback configured with `kx_notebook.configure_evaluator`;
- `kx_notebook.evaluators.PyKXEvaluator`, with PyKX separately installed, configured, licensed, and selected; or
- `kx_notebook.evaluators.BrokerEvaluator`, supplied a loopback broker URL and bearer token at runtime.

The package does not discover or borrow the extension's connection, does not bundle PyKX or a broker, and does not persist a broker token.

### Prepare and run through Python

Leave the cell's language as Python and use normal Jupyter Run:

```q
%%q --max-rows 20 --max-bytes 1000000
select from trade where date=.z.D
```

`%%q` is IPython syntax, so a companion cell stays Python-language even though its body is q. A durable extension Direct IPC cell instead stays q-language and uses **Run q Cell (KX)**. Do not switch the same cell back and forth between the routes. The extension's Tag/Prepare editing aids are not required by `kx-notebook` 0.1.0 and do not turn an extension Direct IPC cell into companion execution.

The released `kx-notebook==0.1.0` companion emits the same bounded version 1 MIME contract plus escaped `text/html` and `text/plain` fallbacks. Its marker limits bound persisted output, not server-side q execution. It receives no extension live-result identity or output binding, even if its independently configured evaluator targets the same external q process. The extension cannot reconstruct rows omitted from that MIME bundle or turn it into the helper's original live session.

When more than the bounded helper preview is needed, choose **Run %%q live with KX** on that output (or **KX: Run %%q Preview Live via Direct IPC**). KX resolves or asks for an extension-owned notebook target, shows that target in a modal confirmation, strips only the leading `%%q` directive/options, and submits the remaining q body through the existing first-party complete-cell Direct IPC runner. This is a new execution and session route: it does not call Jupyter Run, reuse the Python evaluator/session, or silently choose a connection. The cell remains Python-language and the selected Python kernel does not change. The replacement result is a complete first-party portable-v2/v3/v4 output; its transient live record adds live actions but is not required for complete saved data.

When a helper evaluator returns `EvaluationResult(..., chart=Chart(...))`, `Chart.type` accepts `line`, `scatter`, `step`, `bar`, `box`, or `candlestick`. Every type may use a `group_by_column` distinct from its X, Y, and OHLC roles. Candlestick requires `y_columns=()` plus distinct `open_column`, `high_column`, `low_column`, and `close_column` fields. The interactive renderer supports all six; the static HTML fallback draws only ungrouped line/scatter/step/bar and clearly reports grouped, box, or candlestick selections as interactive-only.

## Cell metadata

VS Code's built-in Jupyter serializer can persist a non-default q cell as:

```json
{
  "metadata": {
    "vscode": {
      "languageId": "q"
    }
  }
}
```

That serializer-owned field is separate from the extension's optional nested `metadata.vscode-kdb` marker/limit object. Direct IPC q cells rely on the serializer-owned q language plus extension target metadata. A released-companion cell remains Python-language and persists `%%q` in its source; `kx-notebook` 0.1.0 does not require the extension tag metadata.

## Evidence boundary

Focused pure/provider tests cover default non-registration and opt-in controller registration/disposal, mixed action/toolbar/context/keybinding guards, q language assignment without a controller switch, current stable-ID target routing after same-profile endpoint edits and active changes, missing-target prompts, namespace/session continuity, complete-cell dispatch, Python-cell isolation, race/error/cancellation handling, live result lifetime, bounded snapshots, shared settings messages, companion-route separation, and bans on private Jupyter/SQLTools runtime coupling. `npm run test:notebook-cross` separately installs exactly `kx-notebook==0.1.0`, verifies `import kx_notebook`, and validates the released package's emitted version-1 MIME payload with the TypeScript contract.

The scoped real Extension Host smoke uses isolated VS Code user data and the actual `ConnectionStore` to add two application/global profiles, set active selection, edit the same targeted ID from port `5005` to `5000`, confirm both profiles remain, resolve the notebook target to current port `5000`, verify the optional controller is not registered by default, and clean up its settings, secrets, and global state. It also verifies actual q-language and KX metadata persistence through save, close, and reopen, then restores the notebook default. That smoke remains non-visual and does not automate the connection webview, top-right kernel selector, toolbar/status layout, or target QuickPick.

`npm run test:notebook-results-visual` is the narrower real UI check for this result surface. It starts q, runs a deterministic gallery in an isolated VS Code Extension Host under Xvfb, and keeps 11 validated screenshots. They cover light/dark row-striped tables and charts, visible and hidden color-keyed legends, readable dark axes, selector swatches and narrow containment, the overview navigator, the absence of notebook per-cell result Settings controls, tracked-file save/close/reopen rendering, transient live-result state, and all six chart families. Renderer automation also exercises live range selection/search, column menus, saved range selection/search, chart rendering, trusted navigator window/edge drags, bounded navigator keyboard interaction, absence of visible Pan/Refine controls, pointer and keyboard legend toggling, drag zoom, settings-rerender persistence, and Reset zoom. Automatic complete persistence, native output clearing, clipboard ownership, save dialogs, panel handoff, and rerun replacement remain focused protocol/runtime evidence rather than screenshot claims.

That acceptance scope is local Linux VS Code Extension Host/Xvfb with the installed q binary reached over loopback. That original visual gallery did not include remote acceptance. Subsequent Dev Container diagnostics verified 120 live slices during a 60,000 × 14 `.qnb` save and the actual 600,000 × 14 query through the v3 producer, exact whole-column comparison, serialization, temporary file writing, and byte-identical reopening. The latter used real VS Code output factories and left the user notebook unchanged; it did not install a new extension or exercise Jupyter’s own file writer.

### Packed-output verification

An isolated test of the existing Dev Container notebook reduced its 600,000 × 14 result from **278.8 MiB to 20.1 MiB**, below its **32.7 MiB** gzip-JSON baseline. Four nested-vector columns contain 14.3 million elements; the complete result contains **20,340,848 scalar values**. Every value, vector boundary, q type, attribute and durable identity matched after encoding and save/reopen. The user file was unchanged and q was not executed.

The test used the actual saved file and current codec/serializer with standalone notebook factory mocks. It did not replace the installed extension or exercise Jupyter's file writer. Existing live-q, runtime ownership and real browser saved-grid regressions cover execution and interaction separately.

### Standalone symbols

A standalone symbol atom such as `` `hola `` displays as qText in KX Results and live/zero-retention/reopened new notebook output, independently of list display settings. Symbol vectors such as `` `hola`ciao `` still follow Grid/qText list settings. Actual table/dictionary/list symbol cells keep their existing structured display and backticks.

New standalone-symbol output retains the exact symbol atom in complete v2 MIME and adds the strict `standalone-symbol` presentation marker. The displayed qText is derived from that atom; save/reopen, text export and Results handoff retain canonical ownership without executing q. A real one-cell table is never inferred to be a standalone atom. Existing unmarked output retains its old presentation until rerun. New marked output needs **0.2.41 or later**; previous v1/v2/v3/v4 output remains readable.

### Consistent native table sizes (0.2.42)

Reproducing the notebook query in its running Dev Container confirmed a format-cutoff bug: the installed extension saved 60k × 14 as **77.0 MiB** of v2 typed cells, but 600k × 14 as packed v4. Removing that cutoff reduced the actual 60k file to **2.05 MiB**; 600k remained **20.07 MiB**. Every cell and nested value matched after reopening under both producers. Serialization took **48 ms** for the new 60k result and **676 ms** for 600k, with temporary disk writes of **3 ms** and **33 ms** respectively. Encoding and reopening take additional time; timings vary by data and machine.

These checks used the running Extension Host, real VS Code output factories, its configured q profile and `.qnb` serializer, with only temporary output files. The original notebook was unchanged. Jupyter's file writer and installation/reload remain separate acceptance steps. Existing v2 output becomes packed when the cell is rerun using 0.2.42; opening or saving alone does not migrate it.
