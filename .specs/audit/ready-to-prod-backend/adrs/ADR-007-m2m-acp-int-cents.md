# ADR-007 — M2M and ACP cart totals become integer cents

**Status:** PROPOSED (P1)
**Module:** `negotiation`, `public-api/agentic-protocol`
**Issue:** P1-002

---

## Context

- `apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts:204-207` — float cart total → `Math.round(x*100)` for cents.
- `apps/api/src/modules/public-api/agentic-protocol/agentic-protocol.controller.ts:321-323` — `items.reduce((sum,item)=>sum+item.price*item.quantity,0)*100)/100`.

Both lose precision across many line items.

---

## Decision

Integer cents everywhere. Conversion to float only at the very edge (response serialization, UI).

---

## Implementation Steps

1. Define DTO field as `priceCents: number` (int). Reject if `!Number.isInteger(priceCents)`.
2. Replace `Math.round` chains with integer arithmetic.
3. Convert to display currency at response boundary.
4. Update widget / integration test data.

---

## Files Touched

- `apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts`
- `apps/api/src/modules/public-api/agentic-protocol/agentic-protocol.controller.ts`
- DTOs
- Tests
