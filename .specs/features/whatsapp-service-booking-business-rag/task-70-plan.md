# T70 implementation plan

T69 is committed and green at ad81d32c9. This task adds a separate public-business read capability to the existing graph transport. It preserves legacy templates, hashes, TTL, admission operations and product behavior. No buyer or model can supply query syntax. Final buyer orchestration and live price/availability composition remain T71.

## Assumptions

- Public graph rows are candidates, never current answer text, price, availability or authorization. The existing canonical evidence fence remains mandatory.
- A service/professional hint is not a relationship proof. Both current public sources and the canonical published link must be admitted after retrieval in one merchant-first snapshot.
- Public static data does not acquire the legacy catalog freshness TTL. Current source version, publication and pinned embedding ABI remain required.
- An older gateway may continue serving legacy reads while its new public capability is unavailable. Public admission is separate.
- All execution waits for M54/M55 to return the sole resource window. Source work and deterministic document validation only are allowed meanwhile.

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
