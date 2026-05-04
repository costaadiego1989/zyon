# Billing Asaas Tasks

- [x] BIL-T001 Create spec/design/tasks.
  - Gate: docs exist under `.specs/features/billing-asaas/`.

- [ ] BIL-T002 Implement billing domain.
  - Gate: unit tests for plan, trial, subscription status, quota, and usage window.

- [ ] BIL-T003 Add usage and quota use cases.
  - Gate: usage idempotency and quota exceeded tests.

- [ ] BIL-T004 Add Prisma persistence.
  - Gate: integration tests for merchant-scoped plans, subscriptions, usage, and provider events.

- [ ] BIL-T005 Implement Asaas billing adapter.
  - Gate: fake HTTP tests for customer/subscription/invoice creation.

- [ ] BIL-T006 Add Asaas billing webhook.
  - Gate: duplicate provider events do not double-apply status changes.

- [ ] BIL-T007 Add feature gate port for paid modules.
  - Gate: purchase history enrichment and future negotiation can be allowed/denied by billing.

- [ ] BIL-T008 Add billing API/dashboard queries.
  - Gate: protected routes return current plan, usage, quota, and subscription status for authenticated merchant.
