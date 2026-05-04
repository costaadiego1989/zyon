# Commerce Sync Tasks

- [x] COM-T001 Create spec/design/tasks.
  - Gate: docs exist under `.specs/features/commerce-sync/`.

- [ ] COM-T002 Standardize commerce ports.
  - Gate: TypeScript contracts for cart validation, pending order, paid order, and offer metadata.

- [ ] COM-T003 Validate cart server-side before payment.
  - Gate: tests prove browser cart total is ignored when trusted commerce cart exists.

- [ ] COM-T004 Create pending commerce order.
  - Gate: use case test creates one pending order idempotently per checkout session.

- [ ] COM-T005 Mark commerce order as paid after payment approval.
  - Gate: duplicate payment approved event does not duplicate paid sync.

- [ ] COM-T006 Implement Shopify commerce adapter.
  - Gate: fake HTTP tests for cart/order/discount calls and no payment coupling.

- [ ] COM-T007 Plan WooCommerce adapter.
  - Gate: adapter contract notes and deferred task list exist.
