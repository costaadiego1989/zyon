# ADR-010 — Cart-recovery scanner migrates to BullMQ

**Status:** PROPOSED (P1)
**Module:** `cart-recovery`
**Issue:** P1-006

---

## Context

`apps/api/src/modules/cart-recovery/infrastructure/jobs/recovery-scanner.job.ts` uses 15-min `setInterval` loop. Multi-replica deploy → N scanners run, each creating duplicate recovery attempts (dedup is race-prone).

BullMQ already in infra. Pattern documented in `revenue-manager`.

---

## Decision

Move scanner to BullMQ `repeat: { pattern: '*/15 * * * *' }`. Distributed lock via Redis (single-consumer guarantee).

Keep `setInterval` fallback if Redis absent (already documented).

---

## Implementation Steps

1. Add BullMQ queue + worker class.
2. Move scan loop body to `ProcessRecoveryScanUseCase` invoked by worker.
3. Add `where createdAt > now - 30min` pre-check to be extra-safe.
4. Tests: spawn two workers in same Redis, verify only one scans per cycle.

---

## Files Touched

- `apps/api/src/modules/cart-recovery/infrastructure/jobs/recovery-scanner.job.ts` (replace setInterval)
- `apps/api/src/modules/cart-recovery/infrastructure/jobs/recovery-scanner-queue.ts` (new)
- `apps/api/src/modules/cart-recovery/cart-recovery.module.ts`
- Tests
