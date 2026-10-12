## 1. Consistent native storage

- [x] 1.1 Remove the native table cell-count cutoff while retaining typed-column eligibility and v2 fallbacks; verify focused producer regressions for empty, small, 60k and larger tables, attributes, keys and symbol markers.
- [x] 1.2 Adapt native-output assertions to shared version-independent table accessors; verify Results panel, live notebook and saved output through existing parity and browser suites.

## 2. Container reproduction

- [x] 2.1 Execute the notebook's 60k and 600k variants through its existing configured container q profile; record old/new bytes, save/reopen timings and exact-value checks, and verify the original notebook hash and active selection are unchanged and both queries reuse the same client.
- [x] 2.2 Close only the reproduction-created q client, remove temporary inspector references/files and close the inspector; verify cleanup without restarting VS Code or modifying the user's notebook.

## 3. Verification and release

- [x] 3.1 Update storage documentation, reconcile active compatibility specifications, and prepare version 0.2.42; verify generated documentation and strict specification validation.
- [x] 3.2 Run the full project, required live q and browser gates; record results in verification.md.
- [x] 3.3 Build and audit the 0.2.42 VSIX and single-member ZIP, synchronize the capability spec and archive the completed change; verify artifact hashes and accurate task completion.
