## 1. Lock the persisted contract with regressions

- [x] 1.1 Replace the existing attributed-table rejection assertions with ordinary/keyed Direct IPC success cases covering key and value columns, multiple attributes, exact cells, and zero-row typed columns.
- [x] 1.2 Add MIME v2 creation, JSON save/reopen, and strict-validator cases for the optional source-ordinal attributes; reject duplicate, unordered, out-of-range, invalid-code, sparse, decorated, v1, and preview metadata while retaining old v1/v2 output compatibility.

## 2. Preserve whole-column attributes during result creation

- [x] 2.1 Extend the shared portable table input/schema and validation with sparse `columnAttributes` metadata for complete first-party v2 output, and keep creation plus read validation consistent.
- [x] 2.2 Capture original ordinary/keyed q column attributes before row projection and pass them through `directQPortableResult`; preserve structural key ordinals and existing exact row-cell encoding.
- [x] 2.3 Keep unsupported top-level dictionary and genuinely unencodable cell failures explicit, without producing a lossy complete result.

## 3. Keep notebook routes and result surfaces correct

- [x] 3.1 Add controller and mixed-Jupyter route regressions proving attributed results commit once in positive and zero row-limit modes, retain output identity and lifecycle semantics, and survive save/reopen without a q rerun.
- [x] 3.2 Verify equivalent attributed keyed data in direct KX Results, current notebook output, and saved output has the same row values, types, order, key cues, copy/export and chart inputs; opening saved output in KX Results must use persisted data without executing q.
- [x] 3.3 Distinguish post-query encoding errors from IPC/connection errors in controller output, with focused tests for both diagnostic paths and exactly-once query issuance.

## 4. Documentation and verification

- [x] 4.1 Update `mkdocs-src/notebooks.md`, `mkdocs-src/results-viewer.md`, and `CHANGELOG.md` to describe supported column attributes, saved-output behavior, and remaining exact failures; regenerate `docs/` with strict MkDocs validation.
- [x] 4.2 Run focused portable-contract, controller, mixed-notebook, and result-surface tests, then `npm run test:notebook-cross` and `npm test`; record any environment-only gate limitations without weakening the specified behavior.
- [x] 4.3 Validate this change and all active OpenSpec changes with strict CLI validation, confirm the checkboxes match verified work, and leave archiving until implementation and verification are complete.
