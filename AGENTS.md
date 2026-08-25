# OpenSpec workflow

Use the repository's OpenSpec workflow for new features, user-visible behavior
changes, compatibility changes, and substantial cross-component refactors.
Start with `$openspec-propose`, review the resulting proposal/specs/design/tasks,
then implement with `$openspec-apply-change`. Update an active plan with
`$openspec-update-change` when implementation discoveries change the design.

Small, behavior-preserving fixes may be made directly, but they still require a
focused regression test. If a fix changes a documented or persisted contract,
use OpenSpec.

Before implementation, record both the requested behavior and the existing
behavior that must survive. Inspect the affected code, tests, changelog, and
documentation. Do not silently remove, weaken, or replace an existing invariant.
When a feature spans the KX Results panel, live notebook output, or saved notebook
output, specify and test the expected behavior for each surface.

Treat `openspec/specs/` as the source of truth for current requirements and
`openspec/changes/` as the reviewable history of intent. Keep task checkboxes
accurate, validate the change, and archive it only after implementation and
verification are complete.
