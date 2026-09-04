# ADR-003 — Public post-sale buyer endpoints get tenant binding

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `post-sale`
**Issue:** P0-003
**Date:** 2026-09-04

---

## Context

`apps/api/src/modules/post-sale/presentation/http/buyer-post-sale.controller.ts` exposes:

- `POST /post-sale/reviews` — accepts `merchantId` from body
- `POST /post-sale/nps` — accepts `merchantId` from body

Neither endpoint is guarded. `SubmitReviewUseCase` + `SubmitNpsUseCase` persist `merchantId` from body without check.

This is reputation fraud primitive — anyone (competitor, attacker, bot) can flood reviews/NPS for any merchant.

---

## Decision

Replace body-supplied `merchantId` with server-validated identity. Two viable patterns:

**Pattern A — EmbedToken (preferred):** Buyer is interacting from merchant's checkout widget. The widget already has an embed token. Token claims carry `merchantId`. Reject body merchantId, use token claims.

**Pattern B — Order + buyerEmail HMAC (fallback):** Buyer is interacting from a transactional email (post-delivery review request). Body includes `orderId`, `buyerEmail`, and a server-issued `hmac` (signed by the order's secret). Server validates HMAC and looks up merchantId from the order.

Pick A when the buyer is in the widget. Pick B when the buyer clicks an email link.

Add: rate-limit per IP + per merchantId; audit-log every submission.

---

## Implementation Steps

### 1. EmbedToken auth path

**File:** `apps/api/src/modules/post-sale/presentation/http/buyer-post-sale.controller.ts`

```typescript
@UseGuards(EmbedAuthGuard)
@Controller('post-sale')
export class BuyerPostSaleController {
  constructor(private readonly embedAuthGuard: EmbedAuthGuard) {}

  @Post('reviews')
  async submitReview(
    @Req() req: Request & { embedClaims: EmbedTokenClaims },
    @Body() body: SubmitReviewDto,
  ) {
    // Ignore body.merchantId — use token
    const merchantId = req.embedClaims.merchantId;
    const buyerToken = req.embedClaims.buyerToken ?? null;
    return this.submitReviewUseCase.execute({ merchantId, buyerToken, ...body });
  }
}
```

### 2. Order-HMAC fallback path

If the merchant enables email review requests:

**File:** `apps/api/src/modules/post-sale/application/use-cases/verify-order-hmac.use-case.ts` (new)

```typescript
// Sign at order.delivered:
//   hmac = HMAC-SHA256(orderSecret, orderId + buyerEmail + expiresAt)
// Embed in email URL as ?hmac=...
async execute({ orderId, buyerEmail, hmac, expiresAt }) {
  const order = await this.prisma.completedOrder.findUnique({ where: { id: orderId } });
  const expected = createHmac('sha256', order.merchantSecret)
    .update(`${orderId}${buyerEmail}${expiresAt}`).digest('hex');
  if (!timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) throw 401;
  if (Date.now() / 1000 > expiresAt) throw 410;
  return { merchantId: order.merchantId, buyerEmail };
}
```

### 3. Update use-cases

**File:** `apps/api/src/modules/post-sale/application/use-cases/submit-review.use-case.ts`

Change input from `{ merchantId, ... }` to `{ merchantId: SERVER_VERIFIED, ... }`. Remove `merchantId` from body DTO.

### 4. Rate-limit + audit

**File:** `apps/api/src/shared/rate-limit/rate-limit.decorators.ts`

```typescript
@RateLimit(5, 60_000)  // 5 reviews / minute per IP
```

Plus write to `audit_log` table (`apps/api/src/modules/audit/`):
- event: `post_sale.review.submitted`
- payload: `{ merchantId, buyerEmail, ip, ua, rating }`

### 5. Update widget

The widget calling `POST /post-sale/reviews` must now include the embed token in `Authorization: Bearer`. Update `apps/widget/src/...` to forward embed token.

---

## Verification

```bash
# 1. unit — controller rejects body.merchantId, uses token claims
pnpm --filter @zyon/api test post-sale -- --testPathPattern buyer-auth

# 2. int-spec — cross-merchant submission impossible
pnpm --filter @zyon/api test:prisma post-sale-buyer-auth

# 3. e2e — Playwright hits widget, posts review from real embed token
cd apps/widget && pnpm e2e -- --grep post-sale
```

---

## Files Touched

- `apps/api/src/modules/post-sale/presentation/http/buyer-post-sale.controller.ts`
- `apps/api/src/modules/post-sale/application/use-cases/submit-review.use-case.ts`
- `apps/api/src/modules/post-sale/application/use-cases/submit-nps.use-case.ts`
- `apps/api/src/modules/post-sale/application/use-cases/verify-order-hmac.use-case.ts` (new)
- `apps/api/src/modules/post-sale/presentation/http/dto/submit-review.dto.ts` (remove merchantId)
- `apps/api/src/modules/post-sale/post-sale.module.ts` (wire guard)
- `apps/widget/src/...` (forward embed token)
- Tests
