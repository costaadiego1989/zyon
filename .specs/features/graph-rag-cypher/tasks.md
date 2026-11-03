# GraphRAG implementation tasks

## Execution Protocol

Use tlc-spec-driven Execute with one verified commit per component. The user explicitly asked to implement the previously written plan; this record restates that authorization and does not claim an additional formal review occurred.

**Design**: `.specs/features/graph-rag-cypher/design.md`
**Status**: In Progress
**Approved**: 2026-11-03 - user: "ENTAO VAMOS IMPLEMENTAR O CYPHER VC JA TINHA FEITO UM PLANO PARA ISSO"
**Mutations**: 3
**Build**: `pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit --incremental false --pretty false`

## Test Coverage Matrix

Generated from apps/api/package.json, tests/ready-prod-loader.mjs, tests/test-network-guard.mjs and existing shopping/knowledge contract tests. No ESLint configuration exists in this isolated source baseline; no global lint success will be claimed.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain compiler | unit | All contracts, tenant parameters, bounds and injection edge cases | graph-rag/domain/*.spec.ts | node loader and node:test |
| Adapter and projection | unit + real integration | Result admission, transaction bounds, stale/duplicate/delete ordering | graph-rag/**/*.spec.ts | node loader; isolated Neo4j integration |
| Canonical adapters | unit | Same variant, missing negative attributes, stale state and revoked source | catalog and knowledge-base co-located specs | node loader with network blocked |
| Lifecycle/configuration | unit | Disabled means zero network; allowlist; errors isolated | graph-rag/*.spec.ts | node loader with network blocked |
| Operational runner | integration | Real Neo4j, two tenants, real model, no commercial writes | apps/api/tests/graph-rag.integration.mjs | explicit local-disposable runner |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Each component with unit tests | `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit <task spec>` |
| Full | Operational integration | `node --loader ./apps/api/tests/ready-prod-loader.mjs apps/api/tests/graph-rag.integration.mjs --local-disposable` |
| Build | Final integration | Production TypeScript check plus the graph and existing storefront regression suites |

## Execution Plan

### Phase 1: Implementation

```text
T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7 -> T8
```

## Task Breakdown

### T1: Compile bounded read queries

**What**: Controlled Cypher compiler and its validated public contracts.
**Where**: `apps/api/src/modules/graph-rag/domain/graph-query.ts`
**Depends on**: None
**Requirement**: RAG-01
**Tests**: unit
**Gate**: quick
**Done when**:

- [x] Contracts reject invalid vectors, bounds and fields before execution.
- [x] User text stays in parameters and every graph traversal is tenant-scoped.

### T2: Execute through separate Neo4j identities

**What**: Driver adapter with role admission and bounded read/write transactions.
**Where**: `apps/api/src/modules/graph-rag/infrastructure/neo4j-graph.adapter.ts`
**Depends on**: T1
**Requirement**: RAG-02
**Tests**: unit
**Gate**: quick
**Done when**:

- [x] Reader admission rejects writer/admin roles and identical read/write identities in production.
- [x] Malformed, stale or foreign results do not escape the adapter.

### T3: Project versioned public sources

**What**: Idempotent projection service with tombstone ordering.
**Where**: `apps/api/src/modules/graph-rag/application/graph-projection.service.ts`
**Depends on**: T2
**Requirement**: RAG-03
**Tests**: unit
**Gate**: quick
**Done when**:

- [x] Public sources carry IDs, model, content hash and version.
- [x] Duplicate/old projections cannot replace a newer source or deletion.

### T4: Retrieve with multilingual vectors

**What**: Retrieval service with model identity, bounded vector generation and fallback outcomes.
**Where**: `apps/api/src/modules/graph-rag/application/graph-retrieval.service.ts`
**Depends on**: T3
**Requirement**: RAG-04
**Tests**: unit
**Gate**: quick
**Done when**:

- [x] Ranked evidence belongs to the requested merchant and the same configured vector model.
- [x] Missing embeddings return an explicit unavailable outcome, never synthetic vectors.

### T5: Revalidate document evidence

**What**: Knowledge module adapter that rereads public canonical sources.
**Where**: `apps/api/src/modules/knowledge-base/infrastructure/graph-knowledge.reader.ts`
**Depends on**: T4
**Requirement**: RAG-06
**Tests**: unit
**Gate**: quick
**Done when**:

- [ ] Revoked, changed or foreign sources are discarded before answering.

### T6: Revalidate semantic product candidates

**What**: Catalog adapter that feeds graph IDs into canonical variant filtering and evidence.
**Where**: `apps/api/src/modules/catalog/infrastructure/graph-catalog-search.ts`
**Depends on**: T5
**Requirement**: RAG-05
**Tests**: unit
**Gate**: quick
**Done when**:

- [ ] Current commercial constraints apply to the same candidate variant.
- [ ] Semantic selection is explicitly related and partial.

### T7: Wire scoped lifecycle and synchronization

**What**: Module integration with merchant allowlist, public-source ports and non-blocking synchronization.
**Where**: `apps/api/src/modules/graph-rag/graph-rag.module.ts`
**Depends on**: T6
**Requirement**: RAG-07
**Tests**: unit
**Gate**: quick
**Done when**:

- [ ] Disabled mode opens no graph connection and keeps legacy paths.
- [ ] Only enabled merchants are projected and failures remain isolated.

### T8: Deliver operational bootstrap and acceptance

**What**: Reproducible local Neo4j acceptance runner and configuration guide.
**Where**: `apps/api/tests/graph-rag.integration.mjs`
**Depends on**: T7
**Requirement**: RAG-08
**Tests**: integration
**Gate**: build
**Done when**:

- [ ] Real graph checks prove tenant isolation, vectors, relationships and tombstones.
- [ ] Production enablement remains off without its own infrastructure and reader-role proof.

## Checks

**C1** - User text never becomes Cypher and all traversals retain tenant scope (RAG-01, AC 1)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG01 parameterized tenant scope" ./apps/api/src/modules/graph-rag/domain/graph-query.spec.ts`

**C2** - Invalid vectors, unknown fields and bounds are rejected before connections (RAG-01, AC 2)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG01 invalid contract" ./apps/api/src/modules/graph-rag/domain/graph-query.spec.ts`

**C3** - Production query credentials are a separate reader identity (RAG-02, AC 3)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG02 readonly admission" ./apps/api/src/modules/graph-rag/infrastructure/neo4j-graph.adapter.spec.ts`

**C4** - Foreign/stale/malformed graph results are discarded (RAG-02, AC 4)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG02 invalid results" ./apps/api/src/modules/graph-rag/infrastructure/neo4j-graph.adapter.spec.ts`

**C5** - Candidate vectors retain the configured model and merchant (RAG-04, AC 5)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG04 scoped vectors" ./apps/api/src/modules/graph-rag/application/graph-retrieval.service.spec.ts`

**C6** - Unavailable embeddings produce fallback without fake vectors (RAG-04, AC 6)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG04 no synthetic vectors" ./apps/api/src/modules/graph-rag/application/graph-retrieval.service.spec.ts`

**C7** - Projection records public provenance and model (RAG-03, AC 1)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG03 public provenance" ./apps/api/src/modules/graph-rag/application/graph-projection.service.spec.ts`

**C8** - Old and duplicate versions cannot overwrite a tombstone (RAG-03, AC 2)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG03 tombstone ordering" ./apps/api/src/modules/graph-rag/application/graph-projection.service.spec.ts`

**C9** - Synchronization only reads public sources for enabled merchants (RAG-07, AC 3)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG07 scoped synchronization" ./apps/api/src/modules/graph-rag/graph-rag.module.spec.ts`

**C10** - Same-variant current constraints survive semantic retrieval (RAG-05, AC 1)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG05 canonical same variant" ./apps/api/src/modules/catalog/infrastructure/graph-catalog-search.spec.ts`

**C11** - Semantic results are labelled related and partial (RAG-05, AC 2)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG05 related partial evidence" ./apps/api/src/modules/catalog/infrastructure/graph-catalog-search.spec.ts`

**C12** - Revoked, stale and foreign documentary sources are discarded (RAG-06, AC 3)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG06 canonical public source" ./apps/api/src/modules/knowledge-base/infrastructure/graph-knowledge.reader.spec.ts`

**C13** - Disabled graph opens zero connections (RAG-07, AC 4)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG07 disabled zero network" ./apps/api/src/modules/graph-rag/graph-rag.module.spec.ts`

**C14** - The isolated acceptance uses a real Neo4j engine (RAG-08, AC 5)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs apps/api/tests/graph-rag.integration.mjs --local-disposable`

**C15** - Missing production admission leaves enablement disabled (RAG-08, AC 6)
Proof: `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG08 production activation gate" ./apps/api/src/modules/graph-rag/graph-rag.module.spec.ts`

## Handoff

**Settled mid-build:** Existing plan implementation authorized; user selected Preparar uma instancia no Railway; preparing the instance is authorized, commercial license choices are not inferred. T1 passed4 tests; compiler rejects invalid inputs and retains tenant scope. T2 passed4 tests and executed an empty scoped read on real local Neo4j5.26.32/Bolt5.8; no production reader admission claimed. T3 passed4 tests, strict core TypeScript, and real graph tenant/duplicate/tombstone/document checks with explicit fixture vectors. T4 passed5 tests and strict core TypeScript. Real pinned multilingual model:384 dimensions, Portuguese related cosine0.65689 versus unrelated0.03360; no synthetic runtime vectors. Railway Neo4j service43301b5a-1842-43fd-887a-bd1e9e0b2da7 deploymentba042d3a-f612-4704-a3a6-5dd5161665e7 is SUCCESS, private-only, persistent1GB volume; production graph reads remain off because Community cannot satisfy actual reader-role admission.
**Dispatched:** none; eight tasks execute inline. A fresh Verifier is required after the last task.
**Walked:** no new screen or binding capture; existing-channel acceptance follows an actually enabled environment.
