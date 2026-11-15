# Digital Regression Asset Recovery

The supplementary existing product-types runner stopped before any business case because its required SQL file was absent from the T9 source. This is an additional setup gap, not one of the previously enumerated broad-suite failures and not a green regression result.

## Reviewed source

- Source: C:/Users/Admin/Desktop/AACP/apps/api/prisma/deploy-migrations/20261003021500_digital_order_fulfillment/migration.sql.
- Source state: untracked in the concurrent main checkout. Only this 2,758-byte file was read and reviewed; no other concurrent source is imported.
- SHA256: 485BCE8AA74D04F420512DC982B4C72CAD8B2E1FAB23BB4C7CDC0426C52943CE.
- Target: the identical missing path in the isolated N checkout.

The DDL defines the two existing digital tables, their existing unique indexes and three tenant-composite foreign keys. Columns/defaults/references were compared with both the pinned prior-service schema and current schema. It adds no model, new financial behavior, constraint bypass or destructive statement. The test's expected source path and assertions remain intact. No new historical-reference mirror is invented.

## Local recovery gate

Assumptions: this narrow reviewed asset restores the source expected by an existing owned regression. Its presence does not prove a production migration ledger or authorize executing SQL remotely.

Files: the exact SQL asset and this evidence note only. No production source, package, lockfile, test expectation or schema is changed.

Success: target bytes/hash match the reviewed source and all eight existing product-types cases execute against owned PostgreSQL with unchanged heap/network/ownership/cleanup guards. Until the runner passes, the additional regression remains failed at setup. Production migration-ledger compatibility is a separate release check before any future deployment.

## Result

PASS: all eight existing cases executed, zero provider calls and zero cleanup errors, 21,108 ms. The disposable database was removed and its bridge closed. Command: `node --import ./apps/api/tests/test-network-guard.mjs ./apps/api/tests/normal-checkout-payment.integration.mjs --product-types-only --local-disposable --prisma-loopback-exec`. The first invocation used flags from a different runner and was rejected before database creation; it is not counted as business execution.

These are synthetic persisted approvals and directly seeded historical offer/cart snapshots, including legacy mixed records. They do not enable mixed signup/catalog writes, send digital content, invoke a PSP, create an appointment or prove actual stock consumption. The guard for new catalog writes was independently validated by T17. Assertions cover frozen order totals/types/options, outbox inventory classification, digital grant/delivery records, retries and drift refusal.
