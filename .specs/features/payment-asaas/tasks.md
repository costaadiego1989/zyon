# Payment Asaas Tasks

- [x] PAY-T001 Create spec/design/tasks.
  - Gate: docs exist under `.specs/features/payment-asaas/`.

- [ ] PAY-T002 Implement payment domain.
  - Gate: unit tests for intent lifecycle, allowed transitions, idempotency keys, and no raw card persistence.

- [ ] PAY-T003 Add repository port and in-memory repository.
  - Gate: repository tests for tenant isolation and idempotent intent creation.

- [ ] PAY-T004 Add Prisma schema/repository.
  - Gate: Prisma integration tests for intents, attempts, provider events, and tenant indexes.

- [ ] PAY-T005 Add `PaymentProviderPort`.
  - Gate: use case tests with fake provider for Pix/card-safe responses.

- [ ] PAY-T006 Implement `AsaasPaymentAdapter`.
  - Gate: adapter tests with fake HTTP client and no secrets in returned DTOs.

- [ ] PAY-T007 Add Asaas webhook use case/controller.
  - Gate: duplicate webhook is idempotent; invalid/missing signature is rejected when signature config exists.

- [ ] PAY-T008 Connect payment approved to checkout completion.
  - Gate: payment approved completes order once and records purchase history.

- [ ] PAY-T009 Connect payment failed to checkout event/conversation trigger.
  - Gate: failed payment records `payment_failed` and does not complete order.

- [ ] PAY-T010 Add buyer checkout payment e2e.
  - Gate: checkout -> payment intent -> webhook approved -> order completed.
