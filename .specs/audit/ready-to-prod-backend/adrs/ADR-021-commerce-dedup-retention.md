# ADR-021 — Commerce dedup table retention

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `commerce`
**Issue:** P0-010

---

## Context

`CommercePaidEvent` table (`@@id([merchantId, paymentReference])`) holds the dedup marker for incoming webhook events. No retention policy, no TTL column, no scheduled cleanup. **Unbounded row growth + permanent unlock of the dedup table as the table bloats.**

Port comment references "automatic TTL-based stale-claim cleanup" but no scheduled job exists.

---

## Decision

Add a `claimedAt DateTime` column. New scheduled job (BullMQ cron or DataRetentionService hook) deletes rows older than `claimedAt + 90d` (configurable per merchant plan).

---

## Implementation Steps

### 1. Migration

```prisma
model CommercePaidEvent {
  // existing fields
  claimedAt  DateTime @default(now()) @map("claimed_at")
  // ...
  @@index([claimedAt])
}
```

### 2. Retention service

Add to `shared/retention/data-retention.service.ts` purge list: `commercePaidEvent` where `claimedAt < now() - 90 days`.

Or create `commerce/infrastructure/jobs/commerce-paid-event-cleanup.job.ts` with cron `0 3 * * *`.

### 3. Config

`COMMERCE_PAID_EVENT_RETENTION_DAYS` env (default 90).

---

## Verification

```bash
pnpm prisma:migrate:dev
pnpm test commerce -- --testPathPattern retention
```

---

## Files Touched

- `apps/api/prisma/schema.prisma`
- `apps/api/src/shared/retention/data-retention.service.ts` OR new commerce job
- Tests
