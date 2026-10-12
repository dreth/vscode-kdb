## Context

The authoritative source is decoded q columns during creation and complete MIME after commit/reopen. Existing shared row/cell accessors already isolate downstream saved grid, chart, static output, export and Results consumers from v3 column storage. Browser validation is synchronous. The actual saved result contains four mixed columns of typed numeric vectors, averaging six elements per row.

## Goals / Non-Goals

**Goals:** Reduce the actual notebook below its 32.7 MiB gzip-JSON baseline; preserve exact full output while avoiding full typed-cell/nested-node trees on the saved path.

**Non-Goals:** Change q/database execution, scalar/list presentation, ordinary v2 output, Python-helper output, chart source/density/refinement, native Jupyter filesystem ownership, or permanently install/publish.

## Decisions

1. Add explicit full v4 `packed-q-columns` with columns containing either a strict packed vector descriptor or an existing exact portable vector fallback. Reuse v2 envelope validation and original schema/type/attribute/cardinality/key checks. Keep old formats readable. Constant columns store one exact scalar. Typed numerics and homogeneous ragged numeric vectors use binary blocks; arbitrary mixed/GUID/symbol shapes retain exact fallback, with repeated symbols eligible for constant storage.
2. Homogeneous ragged columns store original mixed type, element q type, row boundaries, per-row attributes and flattened scalar values. Decoded values use typed numeric arrays and offsets; only requested cells allocate portable q nodes. No vectors are inferred from value similarity; packing requires their actual q types and shapes.
3. Integers use reversible signed delta varints; 64-bit values use BigInt arithmetic. Floating values use decimal-scaled delta integers only when every scalar round-trips with exact numeric equality and safe integer arithmetic; otherwise try decimal predictions with exact binary64 XOR residuals, retaining full binary64 XOR encoding when scaled predictions exceed safe integer bounds. A bounded sample selects a candidate scale for compression only; every encoded scalar retains exact residual bits and the decoder validates every value. Special values have explicit validated codes; no sentinel or negative-zero ambiguity. Preserve original q types independently of numeric encoding.
4. Compress blocks using zlib/DEFLATE and base64 within plain notebook JSON. A bundled browser inflater permits shared synchronous validation. Host production can use native zlib compression through an explicit compressor argument. Compare packed size with exact fallback where practical; incompressible data has no promised fixed size. Ordinary gzip-JSON still carries repeated headers and decimal text; binary packing removes those costs before compression. Whole-file gzip would change qnb/Jupyter readability and leave runtime MIME large.
5. Strictly validate descriptors, canonical base64, declared size, complete compression consumption, varint bounds, special/value validity, vector offsets and attributes, and exact end-of-buffer. Streaming inflation rejects output exceeding its declared length before accepting it. Metadata/encoded-byte snapshots guard decoded WeakMap caching against mutated payloads; canonical ownership byte cache and live notebook/cell/session rules stay unchanged. Decoded storage is collected with its payload.
6. Same shared cell helpers serve saved grids/search/sort/selection/sizing, copy/export, charts/static output and panel handoff. Positive mode retains its live raw q record; zero mode retains only complete MIME. No passive action executes q, and clear/close/replacement and stale rules remain as currently implemented.

## Risks / Trade-offs

- New v4 files require new readers → document explicitly and test old v1/v2/v3 compatibility.
- Scaling or binary decoding could corrupt identity → compare every original value and q metadata; use exact fallback when packing is unsuitable.
- Inflation/allocation abuse or mutated cache entries → structural bounds, streaming byte accounting, complete-consumption checks, fail-closed mutation regressions. Runtime exhaustion remains an explicit encoding error, never a truncated success.
- Decompression costs and typed-array memory → measure actual saved result and constrained-memory fixtures; avoid nested-node expansion and repeated decoding.
- Surface drift → browser/runtime/contract tests plus existing full release gates; chart sampling remains untouched.

## Migration Plan

Build an audited local 0.2.40 VSIX/ZIP after all tests. Existing files are unchanged on open; a fresh result uses v4. Verify against the actual saved container file through a temporary output/file, without requerying or editing the user notebook. Reader rollback cannot richly display new v4 output.

## Implementation evidence

The first actual-file pass reduced 279 MiB to 20.1 MiB with all 20,340,848 scalars verified. The codec also supports reversible decimal predictions with exact IEEE residuals when ordinary scaling would require a whole-column raw-bits fallback. A second actual-file pass remained 20.1 MiB because its floats already scale exactly; other finite floating values retain exact bits. Int64 delta-of-delta and fixed/XOR measurements offered little additional reduction for this data and were not added.
