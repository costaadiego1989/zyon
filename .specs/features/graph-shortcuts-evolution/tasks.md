# Graph and shortcuts implementation

**Approved**: 2026-11-04 - user: "agora siga com evolução do cyper e atalhos"; continuation of the concrete roadmap already delivered.
**Build**: `pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit --incremental true --tsBuildInfoFile C:/tmp/zyon-graph-shortcuts-evolution.tsbuildinfo --pretty false`
**Mutations**: 3

## Execution Plan

T1 -> T2 -> T3 -> T4. Four tasks fit one inline batch. Fresh independent Verifier after final proofs.

## Task Breakdown

### T1: Canonical Boolean predicates
**What**: Add bounded OR attribute groups to SQL/Cypher and one-variant projections; add strict rating predicate support.
**Where**: catalog criteria/ports/repositories and graph query/retrieval types and tests
**Depends on**: None
**Requirement**: GRAPH-01, GRAPH-02
**Tests**: unit
**Gate**: quick
**Done when**:
- [x] C1 passes: 14 tests, 0 failures. Strict predicates are canonical.

### T2: Structured advanced search
**What**: Wire immutable planner alternatives and exclusive boundaries through canonical product pricing and evidence.
**Where**: storefront shopping plan/planner/reader/product handlers/evidence and focused tests
**Depends on**: T1
**Requirement**: GRAPH-02, GRAPH-03
**Tests**: unit
**Gate**: quick
**Done when**:
- [x] C2 passes: 26 tests, 0 failures. Production TypeScript passed.

### T3: Functional buyer shortcut hub
**What**: Add registry, current-sender principal, protected profile/address reads, cancellation and existing shopping/quick-buy routing.
**Where**: whatsapp-channel hub services/state/adapter/module and tests
**Depends on**: T2
**Requirement**: HUB-01, HUB-02
**Tests**: unit and adapter integration
**Gate**: quick
**Done when**:
- [x] C4/C5 pass with actual adapter/native choices, missing proof and ambiguous/foreign contexts.

### T4: Address management and release acceptance
**What**: Persist transactional address CRUD/default, protect stale/repeated actions, close independent findings and verify release behavior.
**Where**: whatsapp-channel address service/hub and focused tests; roadmap and audit report
**Depends on**: T3
**Requirement**: HUB-03, HUB-04
**Tests**: unit and production walkthrough
**Gate**: build
**Done when**:
- [x] C1-C7 pass: 125 focused tests, 0 failures/skips; API production TypeScript and private gateway compilation passed. Actual private Neo4j and forced-rollback PostgreSQL preflights passed. Final regression, independent review and production/native acceptance remain release gates.

## Gate Check Commands

Quick: corresponding proof under Checks. Build: C1-C7 plus production TypeScript. Final guarded regression before release.

## Checks

**C1** - GRAPH-01 canonical same-variant Boolean predicates
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/catalog/domain/services/catalog-search-criteria.spec.ts ./apps/api/src/modules/catalog/infrastructure/repositories/catalog-search-criteria.spec.ts ./apps/api/src/modules/graph-rag/domain/graph-query.spec.ts`

**C2** - GRAPH-02 strict price and rating bounds
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/storefront/infrastructure/tool-handlers/advanced-shopping-criteria.spec.ts`

**C3** - GRAPH-03 immutable planning and compatible signed gateway
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/storefront/infrastructure/ai/structured-shopping-planner.spec.ts ./apps/api/src/modules/catalog/infrastructure/graph-catalog-search.spec.ts ./apps/api/src/modules/graph-rag/gateway/query-gateway.spec.ts ./apps/api/src/modules/graph-rag/application/graph-retrieval.service.spec.ts`

**C4** - HUB-01 executable registry and native/typed routing
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/whatsapp-channel/application/services/whatsapp-buyer-hub.spec.ts`

**C5** - HUB-02 current sender and isolated buyer identity
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/whatsapp-channel/application/services/whatsapp-buyer-hub.spec.ts ./apps/api/src/modules/whatsapp-channel/application/use-cases/handle-meta-conversation.spec.ts`

**C6** - HUB-03 transactional address lifecycle
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/whatsapp-channel/application/services/whatsapp-hub-addresses.spec.ts`

**C7** - HUB-04 phone-only account creation and address reuse without premature name/email requirements
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/whatsapp-channel/application/services/whatsapp-checkout-identity.spec.ts ./apps/api/src/modules/whatsapp-channel/application/services/whatsapp-returning-buyer.spec.ts`

**Build**: `pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit --incremental true --tsBuildInfoFile C:/tmp/zyon-graph-shortcuts-evolution.tsbuildinfo --pretty false`
**Mutations**: 3

## Handoff

**Dispatched:** none.

## Test Coverage Matrix

| Requirements | Proof | Layer |
| --- | --- | --- |
| GRAPH-01 | C1 | SQL/Cypher/domain |
| GRAPH-02 | C2 | Canonical pricing and rating |
| GRAPH-03 | C3 | Planner/private signed gateway |
| HUB-01 | C4 | Registry/adapter/native choices |
| HUB-02 | C5 | Authenticated sender principal |
| HUB-03 | C6 | Transactional addresses |
| HUB-04 | C7 | Phone-only identity and checkout |
