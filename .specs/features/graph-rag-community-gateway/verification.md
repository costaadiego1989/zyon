# Community query service verification

**Verdict**: FAIL
**Mutations**: 3 - request replay (C1), server freshness clamp (C2), response authentication (C3); specified for the orchestrator, not yet executed
**Proofs**: `proofs.md` at `42a9874749f6a3f0965a4bf11b4ab1e04825c6ca` (6 pass, 0 fail; prerequisite proofs/build accepted without rerunning)
**Verifier**: independent sub-agent (author != verifier)
**Diff**: `8a5ba7975..42a9874749f6a3f0965a4bf11b4ab1e04825c6ca`

## Findings

| Finding | Evidence | Fix | Closed |
| --- | --- | --- | --- |
| V1 - GW-04 canonical public/current-variant revalidation is not exercised by the checks selected for this feature. The operational coverage matrix includes canonical revalidation, but the real integration stops at graph candidates. This is a coverage gap, not an observed production or canonical authorization failure. | `community-gateway.adapter.spec.ts:28-33` verifies signed transport and an injected writer. `graph-rag.integration.mjs:66-93` calls `GraphRetrievalService` directly and asserts its raw candidate IDs; it never invokes `GraphCatalogSearch`, `GraphKnowledgeReader`, or the current canonical variant lookup. C1-C5 select no tests for those application boundaries. Existing foundation tests exercise those components independently, but the new transport is absent from those tests. | Add a guarded check that supplies signed gateway candidates through the real canonical application readers, changes/removes the canonical product variant and revokes a public knowledge source, and asserts that those candidates never escape. Include the unavailable-gateway canonical fallback case or explicitly select its existing meaningful regression check. Match the coverage matrix to the level actually exercised; retain GW-06 as pending until served-environment acceptance exists. | `65cd947ec` - C5 now traverses signed HTTP plus the actual canonical application readers with changed/revoked sources and current variant fixtures; C6 selects same-variant SQL compilation and canonical unavailable-provider fallback regression. |

## Own boundary examples

Command, executed at the reviewed HEAD:

`node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test C:/tmp/graph-rag-community-gateway-independent-examples.mjs`

Result: **2 pass, 0 fail**, literal-loopback HTTP only; no provider or production connection.

- GW-01: a correctly signed request timestamped exactly 30,000 ms in the future returns 200; at 30,001 ms it returns 401, with the engine read count remaining one.
- GW-02: four blocked authenticated reads occupy the four slots; the fifth returns 429 before engine execution. Releasing the four allows a subsequent request to return 200. Engine calls are exactly four before release and five afterward.

The throwaway example file remains outside the repository and was not committed.

## Security and correctness scope

Reviewed request method/path/body/timestamp/nonce authentication, replay lifetime/cache bounds, fixed typed Cypher, tenant/model admission, server-owned freshness and scan bounds, row schemas, signed nonce/status/body responses, private URL validation, disabled paths, projection delegation, shutdown guards, Docker source closure, and shared model/template contracts.

No production-code security defect was established in that review. The fixed query surface does not expose projection, DDL, arbitrary Cypher, or commercial writes. Community credentials remain administrative by database capability; this report relies on the explicitly approved separate-service architecture, not on a database reader-role claim. The direct Neo4j reader-role guard remains present.

The three unique snippets in `mutations.json` target production code changed in this diff. They have not been applied or reported killed here; the orchestrator runs the final mutation/proof pass using its Windows signal compatibility shim.

## Operational limits

This review does **not** accept GW-06 as live. The local disposable graph/HTTP/actual-model record proves only its stated synthetic local scope. The prerequisite build result is not deployment evidence.

Still required before activation: the actual private gateway and API served revisions and settled deployments; private-only network configuration and distinct query/projection identities; runtime health and authenticated rejection/admission; real fixed-template reads and multilingual inference in the served artifact; current Athom canonical projection and revalidation; and owned WhatsApp/storefront acceptance. No production access, deployment, buyer/order mutation, or external message was performed by this Verifier.

## Closure

The coverage finding was closed at `65cd947ec`. Canonical ports in the disposable integration are fixtures; this does not claim a real PostgreSQL engine run. Live GW-06 remains pending.
