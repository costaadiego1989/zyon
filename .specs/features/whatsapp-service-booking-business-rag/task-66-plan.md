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
