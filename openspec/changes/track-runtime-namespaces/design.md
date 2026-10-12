## Context

The current `VariablesTreeProvider` obtains the shared configured-namespace root snapshot, filters that snapshot to `kind === 'variable'`, and renders one flat generation-owned list. `SERVER_VARIABLES_QUERY` derives names from the current q context, excludes `tables[]`, and classifies q types 100 through 112 as functions. The same lower-level metadata policy also feeds Server Explorer and, through `QMetadataService`, optional connected language intelligence, so broadening that existing root response would accidentally disclose process-wide names to consumers whose documented scope is the configured namespace.

q exposes a different process-workspace shape. ``key `.`` lists bindings in the default namespace, while ``key ` `` lists top-level namespaces. A clean runtime reports KX-owned roots such as `.Q`, `.q`, `.z`, `.h`, `.j`, and version/feature-dependent peers. KX documentation reserves all one-character namespaces, providing a stable structural boundary that is safer than a hard-coded observed-name list. Multi-character roots such as `.qr` are application namespaces and must remain visible whether they were populated by a startup script, the current client, or another client.

Namespaces are K-tree dictionaries and can nest. Ordinary q dictionaries have the same broad q type, so type 99 alone is not sufficient to decide that a binding is expandable. The metadata query must recognize the namespace-context marker/shape and return only that classification, not return the dictionary value itself.

The change builds on `add-runtime-sidebar-views`, whose completed but unarchived delta currently defines configured-namespace-only Variables behavior. It must be reconciled after that prerequisite so the later process-wide contract replaces, rather than coexists ambiguously with, the earlier requirement.

## Goals / Non-Goals

**Goals:**

- Present root and nested application namespaces as a native hierarchical KX Variables tree.
- Include every safely named runtime binding class currently present, using preloaded callable `.demo.calculate` only as a conditional fixture example, while structurally excluding KX-reserved top-level namespace roots.
- Keep discovery metadata-only, manually driven, bounded, generation-owned, and isolated to the active direct-q session.
- Reuse one qualified-name validation, classification, stale-state, and bounded-preview policy.
- Preserve configured-namespace behavior and privacy boundaries for Server Explorer and connected language intelligence.

**Non-Goals:**

- Continuous monitoring, transactional runtime snapshots, query instrumentation, object provenance, watch expressions, mutation, or debugging.
- Listing contents of any one-character top-level namespace, even if an application has written into one.
- Treating arbitrary dictionary data as a namespace or executing callable bindings from the tree.
- Changing result conversion/rendering, Query History capture, connection persistence, or live/saved notebook output.

## Decisions

### 1. Exclude reserved namespaces by top-level shape, not by a builtin-name catalogue

The root discovery parser will reject every top-level namespace symbol whose single path segment has length one. That covers the documented KX-reserved namespace class, including current `.Q`, `.q`, `.z`, `.h`, `.j`, `.m` and version-dependent `.o`/`.s` roots, without requiring releases to chase runtime variations. Every safely named multi-character top-level root actually returned by q is treated as application-owned and included; `.qr` therefore passes only when it exists. The filter does not apply to a one-character nested segment below an included application root or to an unqualified one-character root binding.

A name allowlist was rejected because the extension cannot know application namespace names in advance. A hard-coded system denylist was rejected because clean-runtime roots vary by q version and loaded KX features, and it could expose future KX internals until the extension updates. Value/provenance inspection was rejected because q does not retain trustworthy creator provenance and such inspection would exceed a metadata-only refresh.

### 2. Add a Variables-only process-workspace metadata path

The shared pure query/parser module will gain separate builders and parsers for:

- the process root, returning safe root bindings and accepted top-level namespace roots; and
- one validated namespace context, returning immediate child names, q types, and a namespace-versus-binding discriminator.

`QMetadataService` may host the transport/cancellation/bounds implementation, but it will expose a distinct process-workspace API and cache namespace children only within the Variables provider's current refresh generation. Existing configured-namespace `root()` and `table()` responses, their 30-second cache, and their Server Explorer/language-server consumers will not be widened or repurposed.

All q expressions used by this API are extension-owned templates. The root query contains no returned name interpolation. A child query accepts only a context path whose segments have passed the shared standard-q-identifier validator and whose total encoded request remains within the existing request-safety bound. Queries return names and scalar classification metadata only. They do not serialize user values, install q functions, change namespace permanently, open another connection, or enter Query History.

Reusing the existing root response was rejected because it intentionally represents only the configured namespace and would make process-wide names available to connected language intelligence. Returning an entire recursive workspace in one response was rejected because a large or deeply nested process could impose unbounded server work before the Extension Host could enforce response limits.

### 3. Discover the root on refresh and namespace children on explicit expansion

An explicit Variables refresh will create a new generation, clear prior nodes and child caches, and atomically publish a root-context node plus accepted top-level application namespace nodes. Expanding a namespace is an explicit user action that issues one bounded immediate-child metadata request for that context. Successful children are cached for that generation and sorted by a deterministic namespace-first/name order. Expanding a nested namespace repeats the same operation; ordinary leaves never trigger traversal.

Each branch owns loading, empty, omitted, canceled, oversized, and failed states so one inaccessible application namespace does not erase successfully discovered siblings. A refresh replaces the entire generation, cancels local waits where supported, and makes all late completions no-ops. Connection ID, connected client/session identity, configured namespace, and connection state remain in the snapshot to preserve the existing conservative invalidation behavior even though absolute binding paths no longer depend on the configured namespace.

Lazy traversal trades a single exhaustive response for bounded, inspectable q work. It also means “snapshot” denotes one UI refresh generation rather than a transactionally frozen q heap: another client can mutate an unexpanded context after root discovery. Preview-time revalidation and manual refresh handle that unavoidable q-runtime race.

Automatic recursive refresh was rejected because it can create hidden, unbounded IPC traffic. Polling after each query was rejected because it still misses mutations by other clients and violates the existing no-background-query invariant.

### 4. Model namespaces and all binding kinds explicitly

The Variables model will carry a validated context path and immediate name separately and derive, rather than trust, the displayed fully qualified name. Its conservative kind union will distinguish `namespace`, `table`, `variable`, `function`, `projection`, and `unknown`. Tables and callable q types will use the existing shared classifiers. Unknown or future q types remain visible as metadata but are non-actionable.

For a type-99 child, the q-side classifier will test the K-tree namespace-context marker/shape before labeling it a namespace. A normal dictionary, including one stored beneath a namespace, remains a `variable` leaf. The parser will reject duplicate, malformed, overlong, mismatched, or non-scalar metadata and count unsafe child names rather than turn remote strings into executable text.

Keeping the old data-only filter was rejected because it would hide a present application callable. The provider never synthesizes an example or any other absent name. Treating every dictionary as expandable was rejected because it would misrepresent user data as namespace hierarchy and invite unintended traversal.

### 5. Restrict Results actions to revalidated materializable bindings

Only `variable` and `table` rows will contribute the existing hover/focus Results action. Namespace, function, projection, and unknown rows remain inspectable but non-actionable. The command will resolve only an item owned by the current provider generation, re-fetch or validate current type metadata for its exact qualified symbol, verify the active route/session snapshot again after confirmation, and use a shared absolute-qualified preview builder.

Tables keep the existing server-side cell/outer-item bound. Other data bindings keep the existing outer-item bound and materialization warning. The builder receives validated path segments, never a tree label, and cannot emit a callable invocation. Preview execution stays outside Query History and flows through the existing q-value conversion and KX Results panel pipeline. It never creates notebook output.

Showing a Results action for functions was rejected because even apparently harmless materialization can expose large closures or lead future code toward invocation semantics. Running any callable with guessed arguments is explicitly outside the tracker contract.

### 6. Verify the policy at pure, provider, consumer-isolation, and live-q boundaries

Pure tests will cover top-level reserved-root filtering, qualified path validation, deterministic ordering, type/kind parsing, malformed/oversized responses, ordinary dictionaries, and preview construction. Provider tests will cover root refresh, lazy nesting, branch-local states, generation invalidation, action eligibility, confirmation, retyping, and unchanged active-route ownership.

Live-q fixtures will define root data, tables, functions, an application-namespace callable, nested application contexts, and an ordinary dictionary, then verify the tracker query distinguishes them while excluding every clean-runtime one-character root. The fixture will also remove or omit that callable and verify that the tracker returns no such row rather than manufacturing one. Existing Server Explorer and `QMetadataService.root()` tests will assert they remain configured-namespace-only. Results tests will assert bounded qualified data/table handoff and no function invocation; notebook tests need only the existing regression gate because neither live nor saved notebook output is touched.

## Risks / Trade-offs

- [A future q release changes the internal namespace-context marker] → Keep the predicate isolated in one tested q helper, cover it with the supported live-q version matrix, and fail a questionable type-99 child closed as a non-expandable binding rather than traversing it.
- [A large process contains more names than the metadata bounds allow] → Bound each immediate-context response, show an explicit incomplete/oversized state, retain successfully loaded sibling contexts, and never describe a truncated branch as complete.
- [Many manual expansions create multiple IPC round trips] → Cache successful children for the current generation and issue nothing for collapsed/unvisited namespaces; refresh deliberately clears the cache.
- [Another client mutates q between discovery and preview] → Treat the tree as a manual generation, revalidate kind and route immediately before materialization, and fail closed on removal or retyping.
- [The structural rule hides an application-created `.x` namespace] → Document that q reserves every one-character top-level namespace; honoring that platform boundary is preferable to exposing KX internals or guessing provenance.
- [Process-wide names leak into unrelated metadata consumers] → Keep a dedicated Variables API and add negative regression tests around Server Explorer and connected-language payloads.
- [Unsafe or surprising names enter q through remote metadata] → Validate each segment, derive qualified labels locally, report omissions, and accept only provider-owned generation-current items in commands.

## Migration Plan

1. Add the pure process-root/context metadata schemas, safe q builders, namespace classifier, and deterministic tests without changing existing configured-namespace helpers.
2. Add the dedicated bounded metadata transport and live-q coverage, then move KX Variables to generation-owned hierarchical nodes and branch loading.
3. Extend the current Results command to qualified data/table rows with revalidation while keeping callable/unknown rows metadata-only.
4. Update source documentation, generated docs, and the changelog; run focused tests, live-q coverage, the full `npm test` gate, and strict OpenSpec validation.
5. Reconcile this delta after `add-runtime-sidebar-views` so its modified requirements replace that change's configured-namespace/data-only wording before archival.

No persisted data or setting migration is required. Rollback can restore the flat Variables provider and remove the process-workspace metadata API without changing profiles, history, results, or notebooks.

## Open Questions

None. The structural reserved-namespace boundary, current-runtime-only lazy discovery model, and callable metadata-only behavior are fixed by this proposal.
