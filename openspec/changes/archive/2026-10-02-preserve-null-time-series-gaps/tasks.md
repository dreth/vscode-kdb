## 1. Gap preparation and rendering

- [x] 1.1 Add failing typed-null/duplicate-time/grouped source regressions and fix source-occurrence and cached temporal-pan gap detection; verify line/step per-series continuity, zeros and unchanged density/refinement tests.
- [x] 1.2 Add a shared stroke-aware clip interval for coincident gap endpoints; verify real browser panel and notebook rendering at standard/high DPI without plotting nulls or changing finite data.
- [x] 1.3 Split static SVG finite runs and share scalar normalization; verify gaps across omitted samples, typed/legacy nulls, zero preservation and saved v1/v2/v3/v4 compatibility.

## 2. Verification and delivery

- [x] 2.1 Run focused/full, browser and live q gates and compare chart source reads/density/latency with the pre-fix and documented historical baselines; record exact commands and outcomes.
- [x] 2.2 Update chart documentation/changelog, regenerate docs and synchronize/validate the specification; verify old scenarios and contracts remain intact.
- [x] 2.3 Build audited local release artifacts and archive the verified change with accurate tasks and hashes; verify archive and release audit.
