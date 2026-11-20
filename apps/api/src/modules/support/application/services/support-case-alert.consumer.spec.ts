import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { SupportCaseAlertConsumer } from "./support-case-alert.consumer.js";
import { STAFF_ALERT_REQUESTED, staffAlertId } from "../../domain/support-case-alert.js";

test("HUM-10 an event label or caller fields cannot become staff send authority", async () => {
  let reads = 0;
  const prisma = { outboxMessage: { findFirst: async () => { reads++; throw Error("must not query"); } } } as unknown as PrismaClient;
  const consumer = new SupportCaseAlertConsumer(prisma, {} as never, {} as never, {} as never, {} as never, new TenantContextService());
  await assert.rejects(consumer.handle({ eventType: STAFF_ALERT_REQUESTED, merchantId: "merchant-a", payload: { toPhone: "+5511999991111" } } as never), /staff_alert_dispatch_required/);
  assert.equal(reads, 0);
});
test("HUM-10 a conflicting canonical tenant fails before storage or sender admission", async () => {
  let reads = 0; const tenant = new TenantContextService();
  const prisma = { outboxMessage: { findFirst: async () => { reads++; return null; } } } as unknown as PrismaClient;
  const consumer = new SupportCaseAlertConsumer(prisma, {} as never, {} as never, {} as never, {} as never, tenant);
  const alertId = staffAlertId("merchant-a", "ticket-a", 1);
  const event = { eventId: "event-a", eventType: STAFF_ALERT_REQUESTED, merchantId: "merchant-a", schemaVersion: 1, correlationId: alertId,
    causationId: "ticket-a", deliveryLeaseToken: "lease-a", payload: { alertId, ticketId: "ticket-a", bindingId: "binding-a", creationEpoch: 1 } };
  await tenant.run({ merchantId: "merchant-b", userId: "technical-test", role: "system" }, () => assert.rejects(consumer.handle(event as never), /staff_alert_scope_mismatch/));
  assert.equal(reads, 0); assert.equal(tenant.get(), null);
});
