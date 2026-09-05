# ADR-009 — Embed consent reads merchant from claims, not session_id string

**Status:** PROPOSED (P1)
**Module:** `embed`
**Issue:** P1-005, P1-007

---

## Context

`apps/api/src/modules/embed/presentation/http/embed-consent.controller.ts:48` parses `merchantId` from `session_id.split('_')[1]`. Fragile. If session ID format changes, tenant misroutes.

`POST /embed/checkout/consent` accepts `global_user_id` from body — auth link is only session_id substring match.

---

## Decision

Source `merchantId` from JWT/embed-token claims. Tie `global_user_id` to embed session via server-side lookup.

---

## Implementation Steps

1. In `embed-consent.controller.ts`, replace substring parsing with `req.embedClaims.merchantId` (after EmbedAuthGuard sets claims).
2. Reject body-supplied `global_user_id`; require server-resolved buyer identity.
3. Update SDK to send embed token in `Authorization` header (already done in widget; verify).
4. Add regression: token A cannot grant consent for tenant B.

---

## Files Touched

- `apps/api/src/modules/embed/presentation/http/embed-consent.controller.ts`
- `apps/api/src/modules/embed/application/use-cases/update-embed-customer.use-case.ts`
- Tests
