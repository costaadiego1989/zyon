# graph-rag-cypher proofs

**HEAD**: 8a5ba7975
**Tree**: clean
**Result**: 18 pass, 0 fail; mutations 3 killed, 0 not

| Check | Proof | Ran | Passed | Result |
| --- | --- | --- | --- | --- |
| C1 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG01 parameterized tenant sc` | count unknown | - | pass |
| C2 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG01 invalid contract" ./app` | count unknown | - | pass |
| C3 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG02 readonly admission" ./a` | count unknown | - | pass |
| C4 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG02 invalid results" ./apps` | count unknown | - | pass |
| C5 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG04 scoped vectors" ./apps/` | count unknown | - | pass |
| C6 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG04 no synthetic vectors" .` | count unknown | - | pass |
| C7 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG03 public provenance" ./ap` | count unknown | - | pass |
| C8 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG03 tombstone ordering" ./a` | count unknown | - | pass |
| C9 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG07 scoped synchronization"` | count unknown | - | pass |
| C10 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG05 canonical same variant"` | count unknown | - | pass |
| C11 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG05 related partial evidenc` | count unknown | - | pass |
| C12 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG06 canonical public source` | count unknown | - | pass |
| C13 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG07 disabled zero network" ` | count unknown | - | pass |
| C14 | `node --loader ./apps/api/tests/ready-prod-loader.mjs apps/api/tests/graph-rag.integration.mjs --local-disposab` | count unknown | - | pass |
| C15 | `node --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-name-pattern="RAG08 production activation g` | count unknown | - | pass |
| C16 | `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test .` | count unknown | - | pass |
| C17 | `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test -` | count unknown | - | pass |
| Build | `pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit --incremental false --pretty false` | - | - | pass |

## Mutations

| Mutation | Location | Killed |
| --- | --- | --- |
| M1 C1 remove merchant scope from the product-variant relationship | `apps\api\src\modules\graph-rag\domain\graph-query.ts:27` | yes |
| M2 C10 remove semantic candidate identity from persisted same-variant SQL eligibility | `apps\api\src\modules\catalog\infrastructure\repositories\catalog-availability-search.ts:79` | yes |
| M3 C8 allow conflicting same-version source to overwrite a persisted tombstone | `apps\api\src\modules\graph-rag\application\graph-projection.service.ts:42` | yes |
