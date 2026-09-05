# ADR-014 — Cross-sell accept becomes idempotent

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `cross-sell`
**Issue:** P0-007

---

## Context

`accept-cross-sell-suggestion.use-case.ts` writes via `findFirst → save updated entity → create funnel event → outbox → cart mutation`. Two concurrent accepts both pass findFirst, double-apply discount + cart item.

Strategy fallback at `list-eligible-cross-sells.use-case.ts:97-126` uses `Date.now()` for IDs — collisions possible.

---

## Decision

DB-level uniqueness on `(merchantId, suggestionId, sessionId)` accept event. `INSERT ... ON CONFLICT DO NOTHING` or `try-catch P2002` → idempotent.

Strategy fallback IDs: `crypto.randomUUID()`.

---

## Implementation Steps

### 1. Prisma unique constraint

```prisma
model CrossSellAcceptEvent {
  id          String   @id @default(cuid())
  suggestionId String  @map("suggestion_id")
  sessionId   String   @map("session_id")
  merchantId  String   @map("merchant_id")
  acceptedAt  DateTime @default(now()) @map("accepted_at")

  @@unique([merchantId, suggestionId, sessionId])
  @@map("cross_sell_accept_events")
}
```

### 2. Repository `tryRecordAccept`

```typescript
async tryRecordAccept(suggestionId, sessionId, merchantId): Promise<boolean> {
  try {
    await this.prisma.crossSellAcceptEvent.create({ data: { ... } });
    return true;
  } catch (err) {
    if (err.code === 'P2002') return false;
    throw err;
  }
}
```

### 3. Use-case refactor

```typescript
const isNewAccept = await this.acceptRepo.tryRecordAccept(suggestion.id, session.id, merchantId);
if (!isNewAccept) return { ok: true, alreadyAccepted: true };
```

### 4. Strategy fallback IDs

Replace `strat_${strategy}_${session_id}_${Date.now()}` with `crypto.randomUUID()`.

### 5. List eligibility dedup

Same DB unique on `(merchantId, sessionId, promoId)` for pending suggestions.

---

## Verification

```bash
pnpm test cross-sell -- --testPathPattern accept-idempotency
pnpm test:prisma cross-sell-concurrent-accept
```

---

## Files Touched

- `apps/api/prisma/schema.prisma`
- `apps/api/src/modules/cross-sell/infrastructure/repositories/prisma-cross-sell-suggestion.repository.ts`
- 2 use-cases
- Tests
