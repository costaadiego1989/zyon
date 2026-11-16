# T66 preparation

T66 waits for the full green T65 commit. Its isolated projection draft passed8 preparatory checks, not a task gate. The latest change validates the embedding provider's declared384 dimensions before generating public evidence. Tombstones still work without model inference. Existing vector, Unicode, source identity, revision and public-field checks retain their assertions; fixtures now declare the dimension required by the existing port.

## Assumptions

- Canonical PostgreSQL data controls publication and operational facts. Neo4j holds a derived public projection. Prices, stock, live capacity, buyer identity, patient data and conversations are excluded.
- Only public-v1 counters are graph revisions. Every legacy version, including publication-dirty-v1 markers, must normalize from the current canonical source before embedding or submission. Never project a marker's fingerprint as evidence.
- Source writers, normalization and the final worker admission use the same merchant-first lock order. Embeddings run outside that transaction. Existing transaction and provider deadlines remain unchanged.
- Queue acknowledgement alone does not establish fresh graph evidence. Final RAG02 acceptance also requires withdrawal/backfill67 and canonical retrieval revalidation68.

## Files and approach

Keep the current public source reader, work service and runtime. Add a bounded public-business index worker and the prepared projection service. Extend the work service only with transaction-bound completion support where needed; retain its existing scoped public wrapper and all64 assertions. Wire the worker into the current synchronization/runtime lifecycle. Bootstrap the two new namespace constraints through the existing local/operator schema path; do not issue remote schema changes.

The graph namespace is ZyonPublicSourceV1/ZyonPublicChunkV1/ZyonPublicHasChunkV1. Legacy ZyonGraphDocument timestamps and catalog projection contracts remain separate.

The two existing local embedding models both produce384 dimensions but use different models. Before new SQL chunks are written, C prepares isolated legacy repository namespace guards for review. Legacy pgvector and JSON ranking must exclude public-business-v1 rows before ranking/LIMIT, and legacy upsert/delete must preserve that namespace. New readers/writers select their exact namespace/model ABI; dimension alone is insufficient. This preparation does not change productive SQL or complete66. Existing source-writer invalidation may intentionally retire all representations of changed canonical content.

Local native prerequisite: a real cached pgvector pg16 image exists. C prepares an external additive test-only database profile, with immutable local image identity, Debian UID999, no pulls/ports/external network and the original ownership/cleanup guards. It must verify an available duplex bridge rather than assume Alpine nc exists. Normal production-schema/ledger bootstrap and exact drift assertion run first; only then may the owned profile add the real vector extension/384 column and assert its exact catalog/operator shape. Default Alpine behavior remains byte/contract compatible. No current profile, extension or native result is accepted from that preparation.

For each bounded claim:

1. Normalize an opaque legacy signal and release it without calling embeddings or Neo4j. A canonical claim is compared with the current source, current canonical work and publication state before preparation.
2. Prepare deterministic Unicode-safe chunks and validated vectors outside the canonical transaction. Pin model identity and dimension to that preparation.
3. Enter the final admission transaction: merchant lock, exact work row/token, database-clock lease, latest public-v1 revision, pending legacy signals and current public fingerprint/publication. Reject stale ownership or source state before submission. Do not recapture a newer revision for an old prepared object.
4. Submit the prepared projection through the existing graph transaction adapter. A larger graph revision rejects an older projection; equal revision with equal hash is retryable. An unexpected ignored outcome must not be acknowledged as fresh indexing.
5. Persist the corresponding public SQL chunks and metadata, and complete the exact lease conditionally in the same admission transaction. Metadata includes source identity/version/hash, model/dimension and deterministic chunk hashes. Preserve original public text for RAG presentation; avoid reconstructing raw text from normalized search text.
6. On failure, preserve retryable durable work with a fixed safe error code. SQL failure after a graph commit is recoverable by the same graph revision/hash; it is not successful completion. Lease loss must roll back SQL publication and cannot acknowledge another owner's claim.

Stopping prevents new claims/preparation and drains owned in-flight work before Prisma or the graph driver closes. Runtime activation stays tenant-allowlisted. Graph unavailability never prevents a normal company/source registration from committing its work.

## Success criteria

- Actual owned PostgreSQL and Neo4j, fake embedding port explicitly local, canonical AppModule registration and zero external provider traffic.
- Duplicate/out-of-order projection, two workers, lease expiry/replacement, crash after graph commit, SQL chunk/ack failure and unavailable embeddings/graph are covered. No stale worker can replace a newer graph revision or claim fresh SQL evidence.
- Controlled source edits/publication changes during preparation, including offline modality ABA dirty signals, prevent old preparation from being submitted or acknowledged as current. Historical completed revisions remain immutable.
- All six source types index and retire with public provenance. Private canaries do not enter SQL chunks, graph parameters, diagnostics or returned evidence.
- Unchanged64 and65 regressions pass on the new checked artifact. Full gate and atomic66 commit follow only after65 is integrated; no current indexing or production acceptance is claimed.

## Implementation start after65

Dependencies are green:65 commit691b89c3e and26 integrateda451adf1c;34of97 tasks are complete.66 is in progress, not accepted. M51 currently owns all checked/native/container execution; root may edit N and run syntax/pure units only.

Assumptions remain the approved local scope: PostgreSQL owns publication, source writers commit without graph availability, embeddings run outside source transactions, public-v1 counters stay separate from all opaque/epoch legacy versions, and product purchases remain unchanged. No new business choice or remote activation is introduced.

Files for66: new public-business-projection.service.ts/spec; new public-business-index.worker.ts and pure companion; new infrastructure/prisma-public-business-index.ts plus actual SQL/Neo4j integration companion; scoped completion helper in public-source-work.service.ts; GraphRagRuntime/public projection and GraphRagSyncModule/Synchronization registration/drain; existing graph operator schema adds only distinct public-v1 constraints. Source snapshots use65's same canonical reader. Prepared projection and SQL writer share one Unicode-safe chunk function to preserve original public text and exact content hashes. The final admission validates original claim/token, fresh DB clock after locks, newest revision, no pending legacy marker, current public fingerprint/publication, exact model ABI and every prepared chunk before graph submission and SQL publication/conditionalACK. A failed conditionalACK rolls back SQL after an already committed graph projection and remains recoverable with the same version/hash.

Namespace files: knowledge-chunk-namespace.ts, PrismaKnowledgeRepository narrow namespace guards, new namespace unit and actual branch companion. Legacy384 and public384 use different models; public metadata namespace is excluded before legacy ranking/LIMIT and survives legacy upsert/delete. Public SQL publication owns its namespace only. It stores JSON when the optional vector column is absent, uses real vector384 when the verified column exists, and rejects wrong vector shape rather than treating it as a matching ABI.

Owned test profile files: additive local-postgres-profiles.mjs, narrow local-disposable-postgres/runtime/professional-fixture integration, nine new contracts, and new actual vector-profile native companion. Three frozen base files are hash-checked; only the professional fixture's known25 delta needs a three-way merge. Existing contracts and assertions stay untouched. The default Alpine profile and actual AppModule still execute as regressions. Actual graph testing gets an owner-created production Neo4jGraphAdapter capability with closed-over synthetic credentials, tracked cleanup and no free endpoint/credential argument; no real secret is printed.

External C worker is a preparation with28 pure passing tests and3ports. Root owns the actual SQL fence, graph/SQL model namespace, lifecycle composition and native gates. C is not final Verifier. Its native vector profile preparation remains unexecuted until the heavy slot is available. New data tests must exercise actual queues, rollback after graph commit, competing leases/source edits, direct model mismatch and default/vector branches, with all containers/sockets/driver clients removed and0 external provider calls.

## Current checked evidence, before native

66 remains In Progress. The fresh normal checked API build passed with2528 productive sources, input e746f14643a38173e405900312c211fa3b5672b0371e30ff00e21fb9b586121e and artifact01c2d8b27a27435d1eb97f9f4adfc73331e0025ecaff0a5522cd8ece91bd0ec0 at2026-11-15T23:19:59.307Z. Logs: .cache/t66-gates/2026-11-15T23-17-53.559Z. Pure component tests76/76 and unchanged native admission/profile contracts19/19 passed, zero skipped. These are not an actual database indexing gate. No productive TypeScript changed after that build.

New native cases include a real A-to-B-to-A company update during preparation: the public hash returns to A but its pending durable legacy signal must supersede the original claim and allocate a new canonical revision. Existing source-change/lease/SQL failure assertions remain untouched. M granted root the native slot after its checked preflight refused before capture; root profile run began2026-11-15T23:34:17Z with6324MiB available commitment against the unchanged2048MiB native threshold.

## Native profile investigation

First actual profile run .cache/t66-gates/2026-11-15T23-34-17.078Z/profile.log executed18,10passed/8failed/0skipped. Failures were fixture input application_name above PostgreSQL63-byte limit and an inspection probe that treated Docker Mounts as including HostConfig.Tmpfs. Shorter unique names preserve the exact identity assertion. The probe now checks the actual owned kernel /proc/mounts and readlink-resolved destinations, including Alpine /var/run/postgresql -> /run/postgresql; no mount is invented from requested config. Existing assertions stay intact.

Second profile run23-36-25.564Z executed10,5pass/5fail; missing symlink resolution caused cascading initialOwnership/preceding-cleanup failures. All owned runtime resources were closed. Third run .cache/t66-gates/2026-11-15T23-39-06.957Z/profile.log executed18,16pass/2fail/0skip; pgvector all9passed, default only server-EOF child plus its root failed. HTTP/audit/schema/ownership, large native pg+Prisma transport, JSON/vector ranking, namespace preservation and active-query disposal passed on both. Cleanup evidence records zero remaining owned containers/bridge sockets/children. No T66 task gate is accepted while this remains red.

A separate actual PostgreSQL probe received57P01 on default nc but no streamend/close after1s (socket1/child1); pgvector Bash received end/close and drained0/0. Probe attempts first failed before DB(import) and once after create but before try due default unix/no prismaUrl; that one exact owned container8b0133cdc68eddac3b03a5735db459ad5f0d72f568e95e00c865d384a0c1f788/run456b3ada-ac9a-4247-84f0-cdf89de5df96 was separately validated by fullID/UUIDlabel/name/creation23:41:38 and removed with absence proof. Fixed probe enters try immediately after create and always disposes. No other container was changed. These probes are diagnostic, not gates.

Root returned heavy slot to M at23:42UTC; M fresh checked began after current preflight6767MiB. Root source remains frozen TypeScript. Pure76/76 rerun passed at .cache/t66-units/2026-11-15T23-44-14.842Z/unit.log; a separate raw Node command passed28profile/isolation contracts but failed to import worker TypeScript without its normal loader, not a product regression. The corrected standard76 runner is green.

New index native file now prepares14 tests including root: six-source provenance, actual tombstone vector retirement without new embeddings, duplicate/out-of-order, lease replacement, source edit and same-hash ABA, SQL-after-graph failure/recovery, model unavailable/ABI, post-graph expiry, merchant lock expiry, tenant isolation and actual adapter outage with canonical saves. None has yet executed. C prepared67 externally only; no future-task source is restored.

## Current local transport correction and proof mapping

Full pure Graph/catalog/namespace/isolation run603/603 passed, zero skip, .cache/t66-gates/2026-11-15T23-54-53.748Z/unit.log. New Alpine capability adds5 passing contracts; all28 original profile/isolation contracts also remain green (33/33 together). No old test/assertion was edited, weakened or disabled. The next whole unit selector includes the extra5; the earlier603 result remains its exact historical count.

Owned diagnostic probe with actual child events proved the legacy Alpine nc receives57P01 but emits no stdoutend/childexit until client.end; Bash closes naturally. Both manual+automatic bridges and captured containers were removed. Root explicitly adopted a TEST-ONLY factory transport capability: direct legacy openOwnedPostgresBridge/localPostgresBridgeCommand(undefined) retain their old nc argv, pgvector stays unchanged, while the Alpine factory selects a static EOF supervisor after exact UID70/image/capability checks. This is an infrastructure correction; no product, provider, OS or commercial configuration changes. New helper is local-postgres-alpine-eof.mjs, with fixed command/no free endpoint/argv, two bounded children, original128pids/5s cleanup.

The first actual new supervisor diagnostic was NOT green: preflight succeeded, PostgreSQL saw its synthetic application name, but client handshake stayed pending. The standalone probe lacked a connect timeout. Root captured actual parent/children FDs, all correct socket-to-pipe and pipe-to-socket, then terminated only exact diagnostic backend75 in captured containerf80537f8f33771c4942b4395c763e897af799948bb19cf61c55bb9af38db9c41/run3b5411b9-1f3e-402e-a7aa-2f172fa7465d, creation2026-11-15T23:57:57. The pending probe settled with an error and its finally closed client, bridge and database. No other resource changed. Probe now has the same15s connect budget as standard native clients plus5s diagnostic queries, and prints factory-ready stages.

Inference from primary BusyBox source: cat first uses sendfile with a16MiB copy count, while dd without fullblock/twobuffer uses partial safe_read/full_write. Root changed only the new supervisor to fixed dd bs65536 statusnone in both directions, with a real dd capability preflight. New helper5/5 still passes; no native DD outcome yet. References: https://raw.githubusercontent.com/mirror/busybox/master/libbb/copyfd.c and https://raw.githubusercontent.com/mirror/busybox/master/coreutils/dd.c. The hypothesis must be settled by the unchanged actual EOF/large-payload test, not source reading.

C31/C33 proof commands now select the actual .mjs source/work/writer/index files, preserving requirement text and all Done clauses. C34 factual retrieval remains partial until68/69; no final source freshness or answer claim. Index14 setup now runs the real canonical reconciler then inserts one explicit historical-format company signal with an earlier createdAt, so opaque normalization does not depend on incidental HTTP row order. Preparation observers have a bounded2s deadline and release/drain in finally; all original result assertions remain.

## Actual DD transport diagnostic green

The corrected real factory probe exited0 in8.053s on2026-11-16T00:11UTC (local2026-11-15), both default and pgvector. Each actual PostgreSQL query succeeded, exact backend termination emitted57P01 then streamend/close/clientend, destroyed=true and individual sockets0/children0 before client.end cleanup. Both full owned databases/bridges were disposed. This closes the standalone transport diagnostic; the unchanged18-test AppModule profile must still rerun as a whole before66 acceptance. No productive TypeScript changed; the2528-source e746f146/01c2d8b2 artifact remains the candidate. Actual index14 awaits M native slot return.

## First actual index invocation, setup failure only

.cache/t66-gates/2026-11-16T00-14-14.063Z/index.log executed1 root,0passed/1failed/0skipped before any of the14 planned children. Runtime cleanup exposed a20s pending GenerateProductSeoUseCase.callLlm timer and therefore did not satisfy natural-exit5s; owned worker fallback termination and database/Redis/graph disposal ran. This is not an indexing RED or an accepted cleanup gate. Root returned the heavy slot to M after natural runner exit.

The native setup passed PrismaPublicBusinessSources into PublicBusinessReconciler, whose page port is a separate PrismaPublicBusinessSourcePages. The fixture now supplies the actual scoped page adapter, preserving the original normalization assertions. Its diagnostic catch records only bounded error name/stack frames, avoiding source text/parameters.

This one-service index case now uses the normal persisted Starter plan rather than unnecessarily enabling Growth. The existing actual billing guard rejects unrelated paid automatic SEO before entering callLlm; its policy grants remain empty and provider0 still asserted. Professional/source routes use their existing authorization unchanged. T65 separately covers Growth source registration with the real governance denial. No provider/repository/auth override, timer wait/limit change or assertion modification is introduced. Existing SEO error paths retaining their20s abort timer are a separate recorded preexisting concern; no productive SEO source is edited as part of66. Both corrected setup choices require the next actual native execution before acceptance.

## Second actual index setup result

.cache/t66-gates/2026-11-16T00-25-48.904Z/index.log executed1 root,0pass/1fail/0skip,153.261s. It stopped before the14 children because the unchanged /knowledge/policies PlanLimitGuard correctly returned403 plan_feature_unavailable for Starter. Actual natural runtime cleanup passed with no pending timers and all owned resources closed, unlike the earlier Growth/SEO case. This is fixture entitlement preparation, not an indexing RED or an accepted task gate.

The fixture now creates its one service/professional under the real basic plan, then updates its persisted subscription to Growth before the premium FAQ/policy section. All ordinary API/auth/plan guard paths and original status assertions remain active; no BYPASS or provider/repository/auth override. BillingPlanMeteringService.getSubscription re-reads the canonical subscription without a plan cache, confirmed in source. RAG/index behavior remains unexecuted until the next run; the exact e746f146/01c2d8b2 checked TypeScript source is unchanged. Heavy slot returned to M for final51 gates; no root runtime remains.

## Full local task gate passed

Index14/14 at .cache/t66-gates/2026-11-16T00-52-35.016Z/index.log and preservation106/106 at .cache/t66-gates/2026-11-16T01-06-26.749Z/regress.log passed on the same checked2528/e746f146/01c2d8b2 artifact. Zero skips, providers, pending natural-shutdown timers or remaining owned resources. Pure603 plus5 new capability tests passed separately. Earlier failed preparations remain in this chronology; none was relabeled as a product RED or a green gate. T66 is marked complete before its atomic commit. T67 and canonical retrieval/answer proofs remain unimplemented; no production action.
