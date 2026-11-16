# T70 implementation plan

T69 is committed and green at ad81d32c9. This task adds a separate public-business read capability to the existing graph transport. It preserves legacy templates, hashes, TTL, admission operations and product behavior. No buyer or model can supply query syntax. Final buyer orchestration and live price/availability composition remain T71.

## Assumptions

- Public graph rows are candidates, never current answer text, price, availability or authorization. The existing canonical evidence fence remains mandatory.
- A service/professional hint is not a relationship proof. Both current public sources and the canonical published link must be admitted after retrieval in one merchant-first snapshot.
- Public static data does not acquire the legacy catalog freshness TTL. Current source version, publication and pinned embedding ABI remain required.
- An older gateway may continue serving legacy reads while its new public capability is unavailable. Public admission is separate.
- Heavy execution is serialized by the current tasks.md Handoff owner. T54 has since passed and was integrated before the fresh70attempt. T55 is not a T70dependency; its source preparation is separate and cannot run while another owner holds the slot.

## Files

- New graph domain public-business-query.ts, public-business-result.ts and public-business-query.spec.ts; external C drafts are reviewed proposals, not test evidence.
- gateway/query-protocol.ts, query-gateway.ts, community-read-engine.ts; existing adapters community-gateway.adapter.ts and neo4j-graph.adapter.ts.
- graph-rag.port.ts, new application/public-business-retrieval.service.ts and graph-rag.module.ts for the additive typed runtime capability.
- Existing public-source-evidence.ts and revalidate-public-source.service.ts add the bounded distinct revalidatePairs method. It reuses the unchanged PrismaPublicEvidenceSources read/port in one canonical snapshot and requires both endpoints plus the exact publicData.professionals ID. No canonical-port or old non-pair signature change.
- New targeted public graph transport/retrieval specs and tests/business-rag-public-query.integration.spec.mjs; necessary existing owned fixture helpers only. No auth/repository overrides or new public API.

## Success and gate

Test the new source and pair results, strict input/response bounds, all six public families, pinned ABI, canonical relationship and source withdrawals, foreign scope, current/stale/mixed hash refusal, request/response signatures, replay, shutdown and existing engine deadline. Keep every old graph/gateway/adapter/runtime/evidence test unfiltered. Use the standard full checked API artifact and owned Neo4j/PostgreSQL/Redis, with zero skips and no provider traffic. Actual AppModule buyer selection is explicitly T71, not claimed from parent-class transport tests.

The technical T70 gate selects the complete new public-business-query.spec.ts rather than ^T70 in the legacy graph-query.spec.ts. It also runs the complete old graph files and new transport/relationship files. The native gate is business-rag-public-query.integration.spec.mjs. This preserves the original Full requirement and prevents a zero-match or skipped old cohort; concrete commands and actual counts are recorded before execution.

One local task commit follows the real green Full gate, never preparation alone. No push, deployment, production migration or customer messaging.

## Source review before first execution

P reviewed the draft and current implementation read-only. The distinct revalidatePairs avoids the old flat ready/half-pair pitfall and preserves the canonical port. Before any run, Root strengthened the held-response test to release and settle its pending request on every error and honor the existing rate limiter before holding the graph response. The fixture follows the proven Starter-for-catalog then Growth-for-policy sequence, avoiding unrelated background SEO generation. No old assertion, runner deadline or productive SEO path changed. These are preparatory corrections, not executed proof.

## Follow-up source review after first component gate

The first905component cases passed before the final new caller-deadline case. Read-only P review found no blocking tenant/provenance/relationship/capability issue. The new held-graph-reply test exercises the caller timeout and verifies that a late success cannot replace the returned unavailable result. It does not claim cancellation of embeddings or in-flight driver work. Existing bounded engine transaction and legacy retrieval remain unchanged. Whole component count must be906 after the addition; no prior oracle was edited. Native05 proves a real unlink committed before post-graph canonical admission, not a lock-wait race inside that snapshot.

The exact reviewed monitored69build helpers are prepared as70task-label/path-only copies, with reuse manifest in .cache/t70-monitored-reuse-manifest.json. Full normal compiler command/coverage/heap are unchanged. Existing monitored admission3072MiB, live reserve1536MiB,300ms sampling/max500ms gap, exclusive created job, natural zero exit/current input/output identity and finalization remain mandatory. They are not a waiver for native2048or ordinary5168admission. No execution while another owner holds the slot.

## Current partial evidence

Root integrated54as9f0df7829, preserving all20nonoverlapping own dirty70files byte-for-byte. Whole906components passed on combinedsource,0fail/skip/cancel, including the new caller-timeout case. The fresh ordinaryAPIbuild captured2551sources/input52880590 and admitted5382MiB against5168, but hostcommit later fell to814MiB. Root interrupted ONLY its own execsession91036 with Ctrl-C; exit1. No compiler error was displayed, no record phase or current checked artifact exists. Read-only known-own-command scan afterstop found0; no foreign process/container was changed. task-70-evidence.json and the interruption receipt retain these boundaries. Do not run native against the old69stamp or close70until fresh checked build and actual13native cases pass.
