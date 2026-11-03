# Community gateway implementation tasks

**Approved**: 2026-11-03 - user: "Community com serviço privado de consultas controladas, sem licença Enterprise (recomendado)"
**Status**: In Progress
**Mutations**: 3
**Build**: `pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit --incremental false --pretty false`

## Test Coverage Matrix

| Layer | Tests | Gate |
| --- | --- | --- |
| Protocol and HTTP service | HMAC, replay, scope, typed reads, rejection call counts | unit with network guard and literal loopback HTTP |
| API transport | signed admission/response, scope, unavailable/disabled/terminal state | unit with network guard |
| Operational integration | real Neo4j + HTTP + pinned actual model + canonical revalidation | isolated engine, then private Railway/provider/channel proof |

## Execution Plan

T1 -> T2 -> T3, one verified commit per component. Independent Verifier after prerequisite checks; no screen criteria or binding captures.

## Task Breakdown

### T1: Build the private typed query surface

**What**: Shared read-result admission, HMAC protocol, bounded HTTP server and Community fixed-read engine.
**Where**: `apps/api/src/modules/graph-rag/gateway/`
**Depends on**: Completed GraphRAG foundation and review fixes.
**Requirement**: GW-01, GW-02
**Tests**: unit
**Gate**: quick
**Done when**:

- [x] Rejected requests perform zero graph reads.
- [x] Only fixed templates and scoped typed rows escape the service.

### T2: Connect API and preserve canonical authority

**What**: Authenticated gateway adapter, explicit Community mode, model identity and safe lifecycle/fallback.
**Where**: `apps/api/src/modules/graph-rag/infrastructure/community-gateway.adapter.ts`
**Depends on**: T1
**Requirement**: GW-03, GW-04, GW-05
**Tests**: unit
**Gate**: quick
**Done when**:

- [x] Tampered/foreign/malformed responses fail admission.
- [x] Disabled and shutdown paths open no new connections; canonical criteria remain.

### T3: Package, deploy privately and activate with evidence

**What**: Minimal gateway Docker artifact, model-cached API build, scoped Railway setup and live acceptance.
**Where**: `apps/graph-query-gateway/Dockerfile`
**Depends on**: T2
**Requirement**: GW-06
**Tests**: integration
**Gate**: build
**Done when**:

- [x] Actual engine/HTTP/model proof, standalone build, Docker build/entrypoint and production TypeScript pass. Full regression is a release gate after independent review.
- [ ] Railway source/health/private authentication and current Athom projection verified.
- [ ] Actual shared-channel searches and remaining acceptance states reported honestly.

## Checks

**C1** - Request authentication rejects tamper/replay/stale input before reads (GW-01)
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test ./apps/api/src/modules/graph-rag/gateway/query-gateway.spec.ts`

**C2** - Fixed engine preserves tenant/model/result bounds (GW-02)
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test ./apps/api/src/modules/graph-rag/gateway/community-read-engine.spec.ts`

**C3** - API admits only signed matching capability and scoped responses (GW-03/GW-04)
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test ./apps/api/src/modules/graph-rag/infrastructure/community-gateway.adapter.spec.ts`

**C4** - Disabled and terminal lifecycle remains bounded (GW-05)
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test ./apps/api/src/modules/graph-rag/graph-rag.module.spec.ts ./apps/api/src/modules/graph-rag/infrastructure/community-gateway.adapter.spec.ts`

**C5** - Real graph, signed HTTP and actual model interoperate (GW-06)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs apps/api/tests/graph-rag.integration.mjs --local-disposable`

## Handoff

**Settled mid-build:** T1 five security/engine tests pass; T2 eleven transport/runtime tests pass plus strict targeted TypeScript. T3 code/package passes a real Neo4j5.26.32 plus signed HTTP plus actual pinned multilingual model; standalone gateway build, Docker build/entrypoint and API production TypeScript pass. Railway service8c56a46c-5c6e-443e-992e-bdddfa6b7f1f is empty and configured privately, not deployed. Neo4j restartcd414e5c-dd7e-452e-9d44-d7c2cfa69584 is SUCCESS; distinct query/indexer users exist and six constraints persisted. API variables/revision are unchanged; activation is off. User explicitly chose the private Community service. Foundation source at8a5ba7975; its final mutation runner needed a local Windows SIGHUP compatibility shim, not a change to the skill. Direct-driver read-role guard stays in place. Athom is the only activation allowlist entry; no new payment/order/stock operation.
**Dispatched:** none; three tasks inline. A fresh independent Verifier follows code/proof completion.
**Walked:** no new UI; actual shared-channel acceptance follows the served revision.
