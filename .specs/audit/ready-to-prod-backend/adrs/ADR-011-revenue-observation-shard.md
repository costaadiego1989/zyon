# ADR-011 — Revenue-manager observation job shards merchants

**Status:** PROPOSED (P1)
**Module:** `revenue-manager`
**Issue:** P1-008

---

## Context

`apps/api/src/modules/revenue-manager/infrastructure/jobs/daily-observation.job.ts:337` runs sequentially over merchants with concurrency=1 at 2 AM UTC. At >500 merchants the job overruns into next-day territory.

---

## Decision

Shard by `merchant_id % N` across N concurrent workers. Each worker picks up a subset. Same BullMQ job, multiple workers consuming.

---

## Implementation Steps

1. Compute `merchantShard = hash(merchantId) % shardCount`.
2. Use BullMQ `concurrency: shardCount` so a single job fans out.
3. Each invocation iterates only its shard.
4. Dashboard: leader/follower split visible via `OutboxHandlerExecution`.

---

## Files Touched

- `apps/api/src/modules/revenue-manager/infrastructure/jobs/daily-observation.job.ts`
- `apps/api/src/modules/revenue-manager/infrastructure/workers/daily-observation.worker.ts`
- Tests
