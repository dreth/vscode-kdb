# notebook-q-execution Specification

## Purpose

Defines reliable, exactly-once q-cell execution and inline result behavior for first-party q notebooks and mixed Jupyter notebooks.

## Requirements

### Requirement: Notebook type determines the q execution owner
The extension SHALL route a q cell according to its notebook type and SHALL NOT use a mixed-notebook output path for a controller-owned q-only notebook.

#### Scenario: qnb normal run and stay
- **WHEN** a q code cell in an open `.qnb` notebook is focused and the user invokes normal Run or `Ctrl+Enter` on Windows/Linux or `Cmd+Enter` on macOS
- **THEN** the dedicated KX q controller executes the complete current cell source exactly once through the globally active direct-q profile, retains focus on that cell, and uses the controller-owned output lifecycle

#### Scenario: qnb controller is available without the Jupyter opt-in
- **WHEN** a `.qnb` notebook opens while `vscode-kdb.notebook.enableDirectController` is false
- **THEN** its dedicated KX q controller remains available and preferred for that notebook without registering or selecting the optional mixed-Jupyter KX controller

#### Scenario: mixed Jupyter run and stay
- **WHEN** a q-language code cell in a mixed `.ipynb` notebook has text focus or command-mode selection and the user invokes `Ctrl+Enter` or `Cmd+Enter`
- **THEN** **Run q Cell (KX)** executes the complete current cell source exactly once through the globally active direct-q profile, retains the selected cell, and does not change the selected Python/Jupyter controller

#### Scenario: move and insert gestures remain conditional
- **WHEN** a tracked mixed-Jupyter q cell is invoked with `Shift+Enter` or `Alt+Enter` / `Option+Enter`
- **THEN** the same q route executes once and moves to or inserts the next cell only after execution and inline output commit succeed

#### Scenario: non-q cells remain notebook-owned
- **WHEN** the focused notebook cell is Python, another non-q code language, or Markdown, or the optional KX direct controller already owns the Jupyter notebook
- **THEN** the mixed-q keybindings do not intercept the gesture and the existing notebook/controller behavior remains authoritative

### Requirement: Successful q execution produces verified inline output
For every supported writable notebook, a completed current q execution SHALL commit and verify its inline result using the output mechanism owned by that notebook route. A local output retry SHALL reuse the already computed result and SHALL NOT issue the q source again.

#### Scenario: qnb rich result
- **WHEN** dedicated-controller execution in `.qnb` returns a supported q value
- **THEN** the cell receives the current complete exact MIME v2 output through the native execution API, including its durable output identity and live binding, without replacing the notebook cell structurally

#### Scenario: text-focused mixed-Jupyter result
- **WHEN** **Run q Cell (KX)** is invoked from a text-focused q cell in a writable `.ipynb` and q returns a supported value
- **THEN** that same cell receives one verified inline complete exact MIME v2 output while its complete source, q language, metadata, sibling cells, notebook controller, and run-and-stay focus semantics survive

#### Scenario: output edit initially rejected after issue
- **WHEN** q has already executed and VS Code initially rejects or throws while committing the still-current mixed-Jupyter cell output
- **THEN** the extension may retry only the same prepared output through a bounded focus-safe local commit, never executes q again, and succeeds only after the expected output identity is visible on the current cell

#### Scenario: output cannot be committed safely
- **WHEN** the notebook is read-only or closed, the cell/source/output has become stale, a foreign output wins, or the bounded local commit cannot be verified
- **THEN** the extension does not overwrite newer state, does not re-execute q, removes uncommitted live ownership, preserves the prior cell/output where possible, and reports whether q had already been issued

### Requirement: Existing notebook result and lifecycle contracts survive
The routing repair SHALL preserve the established direct-q evaluation, exact result, persistence, cancellation, stale-response, and shortcut-override contracts on every affected surface.

#### Scenario: Active route and q session continuity
- **WHEN** either notebook route executes a q cell
- **THEN** it uses only the globally starred active profile's existing connection, namespace, timeout, and q session and never falls back to another saved profile

#### Scenario: Save and reopen output
- **WHEN** a successfully executed `.qnb` or `.ipynb` cell is saved, closed, and reopened
- **THEN** its supported complete exact MIME v2 value and durable output identity remain available to the saved notebook renderer while transient live handles are not revived

#### Scenario: Cancellation and stale completion
- **WHEN** execution is canceled, superseded, cleared, edited, deleted, or completes after the cell, notebook, connection, or output generation changes
- **THEN** no stale result replaces current notebook state, move/insert follow-up actions do not run, and any query already issued is not silently reissued

#### Scenario: Results panel behavior is unchanged
- **WHEN** the same supported q value is displayed in KX Results or opened from a valid notebook output
- **THEN** Results-panel rendering, q identity, grid/chart behavior, copy/export behavior, and chart sampling continue to follow their existing contracts

#### Scenario: User keymap override
- **WHEN** a user or keymap extension defines a higher-priority notebook shortcut
- **THEN** VS Code's normal keybinding resolution remains authoritative and the visible appropriate run action remains available for the selected notebook route
