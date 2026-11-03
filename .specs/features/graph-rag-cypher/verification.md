# GraphRAG and controlled Cypher verification

**Verdict**: FAIL
**Mutations**: 3 - tenant relationship scope (C1), persisted same-variant SQL restriction (C10 plus its co-located SQL test), persisted tombstone ordering (C8); specifications written, execution reserved for the orchestrator's final pass
**Proofs**: `proofs.md` at ecfae54e0b859da7fe8b2802e3b0b33162522a05
**Verifier**: independent sub-agent (author != verifier)

Read scope: approved spec, tasks Checks and required coverage, proofs, production diff and relevant tests. The author's Handoff was not read. No screen criteria apply. No production access, deploy, source edits, existing-test edits, full proof rerun or build rerun was performed.

## Findings

| Finding | Evidence | Fix | Closed |
| --- | --- | --- | --- |
| F1 - An unavailable graph discards an available PostgreSQL knowledge answer (RAG-02 AC4, RAG-04 AC6) | `query-knowledge.use-case.ts:41-42` returns `graph.search(input) ?? []` whenever configuration/allowlist enablement is true. Enablement remains true after reader admission failure and `GraphKnowledgeReader.search()` returns null on provider/embedding failures. Own example 1 returned `{chunks: []}` with zero PostgreSQL reads although the PostgreSQL fixture held a current public FAQ answer. The graph reader tests prove null/empty fail-closed responses, but no check invokes the real query use case with this fallback state. | Keep the PostgreSQL query path when graph retrieval is unavailable. Revalidate PostgreSQL FAQ/policy chunks against current canonical public snapshots before returning them; never revive stale/private config or revoked text. Add a query-use-case test for graph unavailable/failed admission/embedding failure and public, stale, revoked and foreign fallback candidates. | |
| F2 - C8 can remain green after the real tombstone admission predicate is weakened (RAG-03 AC2) | The fixture in `graph-projection.service.spec.ts:14-24` independently calculates `old.version > version` / equal-hash admission and never executes or asserts the actual ROOT_CATALOG ordering predicate. Proposed mutation M3 changes production `p.sourceVersion < $sourceVersion` to `<=`, admitting a same-version conflicting hash and allowing reactivation after a same-version tombstone. C8 only sends a strictly older upsert, and its independent mock will still reject it. This is a predicted survivor, not a claimed mutation execution result. | Cover a tombstone followed by active content at exactly the same version with a different hash, for catalog and documents. Ensure the proof observes the production predicate/real engine rather than having the mock manufacture the expected admission result. Update M3's narrow proof if needed; the final mutation run must kill it. | |
| F3 - C9's assertion cannot establish zero canonical reads for an unlisted merchant (RAG-07 AC3; required lifecycle/allowlist coverage) | `graph-rag.module.spec.ts:38-41` asserts the page's merchant inside `catalog.page`, while `GraphRagSynchronization.synchronize()` catches all exceptions. If the readiness/allowlist guard is bypassed, an unlisted `shop-b` page read throws inside that catch, produces no projection-call entries, and satisfies the outer unchanged-`calls.length` assertion. | Record page/list/projection calls before any assertions and assert the exact recorded calls after synchronizing an unlisted tenant. Assertions that establish zero reads must run outside the production catch. Also observe provider call counts for failed readiness. | |
| F4 - Shutdown closes graph drivers before in-flight synchronization drains (lifecycle wiring) | `GraphRagRuntime.onApplicationShutdown()` closes the adapter at `graph-rag.module.ts:35`; the dependent synchronization module clears its interval and awaits running work only in the same shutdown phase at `graph-sync.service.ts:58`. Installed Nest core `nest-application-context.js:261-265,284-290` invokes that phase in dependency-first module distance order, so the runtime's module closes before the dependent sync module drains. A sync paused in canonical reads or embeddings can subsequently call `withProjection`; the adapter resets writer/reader to undefined on close and has no terminal close guard, so it can create a new driver after shutdown closure. This is a local source/framework inspection finding, not a production observation. | Stop accepting new sync work, clear its timer and drain pending work in `beforeApplicationShutdown`, before any graph driver close in `onApplicationShutdown`. Prevent post-close driver recreation or make runtime readiness terminal on shutdown. Add an independent delayed-work test that observes stop, drain, then close and no new drivers. If a new acceptance criterion is needed, append a new requirement/check rather than rewriting an approved criterion. | |

## Own examples

Both examples were run at the reviewed HEAD using:

`node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test ./apps/api/tests/.graph-rag-verifier-examples.mjs`

The temporary example file was removed after the run. It did not replace or edit any existing test.

1. **FAIL, F1:** an enabled graph reader returns null while the PostgreSQL fixture has one current public FAQ chunk for `boundary-shop` about Saturday support. Expected one PostgreSQL read and that public chunk; observed zero reads and no chunks. This probes the unavailable graph/public fallback boundary that the named checks do not invoke through the query use case.
2. **PASS:** a public catalog source contains an inactive `retired-hit` variant and an active `live-sibling` variant; the graph hit has the correct current source version/hash but identifies only the inactive variant. `GraphCatalogSearch` returned the original empty canonical result and made exactly one canonical call, so the active sibling did not broaden the graph candidate's variant identity.

Observed runner total: 2 tests, 1 pass, 1 fail, zero skips. No sockets or external provider calls were needed.

## Review conclusions and limits

The query compiler parameterizes user text and constrains the currently implemented node/relationship traversals by merchant. The catalog SQL places semantic candidate IDs inside the same variant predicate as price, stock and attributes; subsequent canonical hydration also restricts variants. Public document hits are rehydrated using the canonical source's current merchant, type, version, source hash and chunk hash. Disabled and unlisted guards are present in production code; F3 concerns the proof's observation quality.

The existing real-engine acceptance verifies two synthetic merchants, actual multilingual embeddings, deletion ordering for strictly older catalog updates and tenant isolation. Its current fixtures do not exercise equal-version conflicting-content resurrection or module shutdown ordering. Reader admission remains a production activation gate; this review supplies no production activation evidence.

`mutations.json` contains three production-code edits whose old snippets each occur once. Their proof commands are narrow existing local tests and include the test-network guard. M3 is intentionally aimed at the C8 proof gap. The orchestrator must run and record actual mutation outcomes after the single fix pass, and fill each finding's Closed cell with its closing commit and proving check.
