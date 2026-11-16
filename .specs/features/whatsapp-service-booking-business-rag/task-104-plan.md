# T104 bounded public projection write

## Finding and scope

The unchanged native pgvector16 regression twice failed during initial public projection. Transparent compiled-adapter observation captured Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration after3114ms against the unchanged2000ms transaction deadline. Public HTTP and all15default-profile cases passed. The failure is preserved; no timeout, assertion, container limit, warm-up or retry policy is relaxed.

The current projection opens one transaction and submits three separately planned statements: version/lock admission, retirement and upsert. Hypothesis: one atomic parameterized statement reduces cold planning and round-trip overhead within the same deadline. This is a technical repair discovered by the required regression, under the existing RAG-01/02/03/04 contract, not a new business feature or a proven fix yet. Mandatory native gates decide whether it resolves the failure.

## Assumptions and files

- Keep source-root lock, publicRevision/sourceHash compare-and-set, tenant/source-scoped retirement, withdrawal, chunk/model/hash fields and one atomic transaction unchanged. A rejected revision changes no chunks. A driver error returns unavailable; existing durable worker retry remains the authority.
- Only apps/api/src/modules/graph-rag/application/public-business-projection.service.ts, new companion public-business-projection.submit.spec.ts and task/spec/evidence metadata. No driver/timeout/factory/reader/provider/SQL-writer changes and no old test modification.
- Read Neo4j5 CALL unit-subquery and FOREACH semantics in the primary manual. Unit subqueries preserve outer cardinality even without matched chunks; FOREACH supports the necessary MERGE/SET updates. Existing pinned Neo4j5.26 native tests must validate actual syntax/semantics; documentation is not runtime proof.

References: https://neo4j.com/docs/cypher-manual/5/subqueries/call-subquery/ and https://neo4j.com/docs/cypher-manual/current/clauses/foreach/ . No quoted prose copied.

## Tests and success

Executed component cohort879/879,0fail/skip/cancel at .cache/t69-gates/2026-11-16T14-49-01.502Z/unit.log (SHAaad051e441eb6ddea784ad33684d4166215e8e066dde180042726217afbba3aa). After integration of frontend-only98 into Rootf28703c69, all33own nonmetadata API/plan deltas remained byte-identical. Fresh unchanged official standard API build completed0/2543 with inputfa8cefd9363b80ef078d90bac866e17032e659bee93880a1ae10ae01fee665b7/artifact1d6187f518f5edb252623a9bcc3ba1894eb61856a7382a43fca00bd73914e4a5, recorded15:05:24.964Z. This is compilation/component proof only; actual cold Neo4j/index/revalidation remain pending.

Add boundary tests before implementation for applied/stale/withdrawn/unavailable outcomes, exact public parameters and no private error exposure. Retain the old preparation tests unchanged. The unchanged owned Neo4j indexing14 and revalidation37 cases prove real source/chunk state, current revision, retirement, isolation, rollback and canonical SQL admission on both profiles with the same2000ms deadline. No positive-path warm-up hides cold behavior.

The existing unfiltered combined component cohort automatically discovers the new graph companion; fresh complete official checked API build remains mandatory after this source change. All current69API outputs become stale until rebuilt. No task104or69completion before green; one atomic commit per task, with unrelated dirty69 source excluded from104staging. Root keeps its full original69delta and private99checkout intact. C's current independent98build has a different checkout/base and is unaffected.

## Final local gate

879components, fresh checked2543 and51actualnative (index14+revalidation37) passed with no skips. The formerly failing pgvector16initial projection now passes without warming or changing the2000ms deadline; actual five-six-family canonical/retirement/rollback/tenant assertions are unchanged. This supports the bounded-write repair on the local candidate, not a production performance guarantee. Evidence hashes and baseline failures are in task-104-evidence.json. Final feature verification remains pending.
