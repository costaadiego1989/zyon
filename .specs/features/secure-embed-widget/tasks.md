# Secure Embed Widget Tasks

- [x] SEW-T001 Create spec/design/tasks.
  - Gate: docs exist under `.specs/features/secure-embed-widget/`.

- [x] SEW-T002 Implement embed session token domain.
  - Gate: `EmbedTokenService` + `apps/api/src/modules/embed/domain/embed-token.service.spec.ts` — sign/verify/expiry/tamper.

- [x] SEW-T003 Add protected token issue endpoint.
  - Gate: **`POST /embed-sessions`** (authenticated); `embed-sessions.controller.spec.ts`.

- [x] SEW-T004 Add public tokenized embed endpoints (**MVP slice**).
  - Implemented **`POST /embed/start`**, **`POST /embed/track`**, **`POST /embed/chat`** with **`EmbedAuthGuard`** (header `X-AACP-Embed-Token` or Bearer). Body `merchant_id` ignored/overridden by token merchant; **`/embed/offers/apply`** and **`/embed/payment/start`** not implemented yet. Env: **`EMBED_TOKEN_SECRET`** recommended (required in production).


- [ ] SEW-T005 Adapt widget to token-only initialization.
  - Gate: widget build and tests prove no sensitive payload keys are sent.

- [ ] SEW-T006 Add security scenario tests.
  - Gate: expired token, replay token, cross-merchant token, malformed token, and spoofed body tests pass.

- [ ] SEW-T007 Add embed e2e.
  - Gate: widget -> API flow starts checkout, tracks event, chats, and starts payment without exposing sensitive fields.
