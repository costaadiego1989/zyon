# T65 execution evidence

PASS: actual canonical source writers and offline reconciliation commit durable current work atomically. This is local source/queue acceptance, not embedding/retrieval, real provider or production acceptance.

## Final gates

- Full graph/catalog unit suites and affected merchant/auth/legal suites:528/528,0fail/cancel/skip. Log .cache/t65-gates/2026-11-15T22-06-03.651Z/unit.log. The earlier supplementary529 run accidentally included the separately flagged PrismaImportJob integration file and reported one conditional skip; it was not accepted as a gate. The corrected selector classifies both .integration.spec and .int-spec as native, without changing their source or assertions.
- Real native principal plus unchanged64/63/96:84/84,0fail/skip,293528ms. Log .cache/t65-gates/2026-11-15T22-05-09.775Z/native.log. Counts:64=12,65=41,63=14,96=17. Actual AppModule/auth/HTTP/SQL,0 provider requests,0 owned containers/bridge sockets/children after cleanup.
- Additional owned PG-only mixed queue companion:4/4 (root+3children),0fail/skip. Log .cache/t65-gates/2026-11-15T22-14-18.366Z/mixed.log. Same checked artifact; no AppModule/transport override. Its fixture orders ServiceBusinessPolicy by its actual merchantId primary key, corrected before execution. Equal A preserves7/chunk, pending-legacy B advances9to10, changed C advances2to3; completed history, unrelated legacy and foreign same IDs remain exact. A queue trigger observes1000 completed first-batch inserts before rejecting batch2; a DELETE trigger observes all3 jobs before rejection. Canonical JSON/policy/work/both chunk representations fully roll back.
- Storefront normal preparation/build exit0: .cache/t65-gates/2026-11-15T21-36-28.242Z/storefront.log. Source files were not changed by this task.
- Fresh normal capture/API build/record exit0,2521 compiler sources, no noCheck or budget changes. Logs .cache/t65-gates/2026-11-15T22-00-10.816Z/. source SHA2560b20527987d0b138afe238571f64f4aaddba68b1e890921b0cb23291c9cc7cfd, artifact SHA256c12d25b3ab3cc3df35a616f28eae432bd7472a2cda99580a6851215bd7623e5c.
- Diagnostic trap retains mandatory transport refusal/exact counts;18 unchanged construction contracts passed. It logs only bounded stack frames on a failed provider attempt, without targets, body or headers.
- git diff --check and validate_tasks --execute exit0; inherited T4 multi-file granularity warning remains.

## Actual behavior and regressions

All six canonical public source families are covered by ordinary writers, offline restart/reconciliation, removal, mode round-trip, rollback and tenant/private negatives. Existing three UUID/company signals and canonical20-digit counters retain their distinct meanings. Whole-container policy null/scalar replacement dirties affected fallback aliases; omitted public fields and hash-identical changes preserve their chunks. Auth/rules/SEO/cross-sell JSON writers lock before rereading/merging, with exact blocker-PID races proving company/service-name preservation.

A real category with1005 named existing services reproduced a new sequential fanout defect:500/5182ms/54attempted source rows/TX5011ms with full rollback. Set-based source reads and canonical queue publication fixed it: final HTTP200/901ms,1005 revision2 jobs,TX750ms, all affected old chunks retired, foreign/unrelated/financial snapshots intact. Same-public-content replay creates no job and preserves a rebuilt chunk. No timeout increase, opaque evidence substitute or unlimited scalability claim.

The first native attempts and all fixture/setup failures remain recorded in task-65-plan.md and their original logs. Quota pacing honors real response headers without retries/reset/limit changes. The strict-field400 and cross-tenant403 proofs are both exact. An unrelated Growth autoSEO path initially attempted transport; the offline-AI fixture now uses the real merchant grants=[] policy and proves actual denied product_seo decisions before transport. No provider/auth/repository mock replaced the application.

Original test assertions were preserved. Old unit fixture interfaces were extended for actual merchant locking, canonical work storage and scalar/list chunk predicates. The newer audit helper receives the real canonical route template for a dynamic HTTP path. No failure was hidden by weakening, deleting or skipping a test.

## Remaining feature work

65 does not index vectors/graph or establish fresh conversational retrieval.66 must implement actual worker admission, exact model/namespace SQL+Neo4j publication and cleanup.68 must revalidate canonical data and protect against legacy FAQ/policy generation finishing after a newer edit. C's incremental review is not the final independent Verifier. Finish all97tasks and final proofs/mutations/screens before feature acceptance. No push/deploy/remote DB/provider action occurred.
