## Why

A 600,000-row q table fails after q returns because full MIME v2 repeats a typed envelope for every cell, producing JSON beyond Node's 536,870,888-character string limit. The notebook must retain every exact value and remain usable through execution, scrolling, save, and reopen.

## What Changes

- Introduce complete MIME v3 q-column encoding for large actual q tables/keyed tables (more than one million cells). Encode typed column vectors once and access visible cells lazily through shared helpers.
- Preserve existing v1/v2 readers, ordinary-size v2 writers, attributed/keyed table identity, nested q values, exact scalar specials/64-bit values, and zero/positive live-retention policies.
- **BREAKING for older readers of newly written large output:** older extensions cannot open MIME v3 rich output; bounded static text remains available. Updated readers accept all three versions. No existing notebook is rewritten merely by opening it.
- Preserve the qnb envelope and Jupyter ownership, strict ownership validation, passive-action/no-q rule, controller/cancellation/stale behavior, Results-panel presentation, and chart sampling. Report runtime encoding limits accurately without truncation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `notebook-q-execution`: large complete versioned output, compatible saved/live surface behavior, and exact columnar transport.

## Impact

Notebook contract/controller/message ownership, saved-result consumers and browser renderer, persistence regressions, active compatibility plans, documentation and local VSIX/ZIP release. No external dependencies or q server changes.
