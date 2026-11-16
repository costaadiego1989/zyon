# T67 gate evidence

Status: FULL LOCAL GATE PASSED. T67 is complete in its atomic commit. Final feature proofs, independent verification and production acceptance remain pending.

## Implementation

Canonical normalization uses set-based pages, at most100 identities per page and two pages per source family per cycle. The cursor advances only after commit. Restart safely replays equal content. Historical missing/deleted sources produce scoped tombstones. Normalization retains merchant-first locks and the existing transaction limit. The old single-source caller contract remains supported.

Completed public work with the wrong model or dimensions gets exactly one new revision. An ABI-only change invalidates only public-business-v1 chunks. Real canonical content/publication/legacy-dirty changes retain the prior all-namespace invalidation. Healthy legacy content and its separate384-dimensional vector space are preserved during public model migration.

## Current artifact and successful gates

- Normal checked API:2531 productive sources, compiler exit0. Input e457653782227823637f0d556cd0ca14d05ff4af810105f5e67e1614d3996f23; artifact bc63b9c3b009c95268fb89877c80ba34dacd2540a985656147514f0f0de33caa. Record2026-11-16T02:36:53.719Z; logs .cache/t67-gates/2026-11-16T02-33-36.360Z.
- Focused components41/41,0fail/skip. .cache/t67-units/2026-11-16T02-33-27.152Z/unit.log.
- Full component preservation614/614,0fail/skip,83.140s. .cache/t67-gates/2026-11-16T02-40-19.772Z/unit.log. The41 overlap this614 and are not an additional41 unique tests.
- Actual new backfill15/15,0fail/skip,165.753s. .cache/t67-gates/2026-11-16T02-37-29.351Z/backfill.log.
- Unchanged index14 plus source/work/writer/profile/service-name/mixed preservation106:120/120,0fail/skip,670.132s. .cache/t67-gates/2026-11-16T02-50-03.053Z/regress.log. Same checked artifact, no productive TS changed between these gates. Combined new15 plus preserved120 is135 actual native tests,0provider calls and naturalcleanup0.

Native backfill uses owned actual PostgreSQL/pgvector, Neo4j and canonical source data, with deterministic pinned-model384 embeddings. Provider calls0; natural cleanup0 with no remaining owned resources. This proves indexing/backfill mechanics, not provider delivery or model answer quality.

## Preserved RED and scope

Before the minimum namespace correction, the new legacy preservation case failed on the actual prior checked artifact:15tests,13pass,2fail (child and parent),0skip; legacy row was null. Log .cache/t67-gates/2026-11-16T02-22-46.714Z/backfill.log. Original14 assertions were unchanged. Fresh-artifact15green proves the correction, including exact legacy row/vector before and after worker drain and nonempty refreshed public chunks.

A read-only incremental reviewer found an incomplete foreign snapshot in the prepared fixture. Root added canonical professional/product/variant/link/support-setting snapshots without changing original assertions. No final feature Verifier has run. All work remains local, with no push/deploy/remote database/provider/customer action. Canonical retrieval admission, provenance, service-query composition and final independent feature verification remain later tasks.
