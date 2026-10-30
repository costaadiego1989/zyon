import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import { CrossSellOfferAuditHandler } from "./cross-sell-offer-audit.handler.js";

test("durable cross-sell lifecycle has a stable handler and idempotent tenant audit without exposing buyer copy", async () => {
  const bus = new InMemoryDomainEventBus();
  const rows = new Map<string, any>();
  const handler = new CrossSellOfferAuditHandler(bus, { merchantAuditEvent: { upsert: async ({ where, create }: any) => {
    assert.equal(where.id, create.id); if (!rows.has(where.id)) rows.set(where.id, create); return rows.get(where.id);
  } } } as any);
  handler.onModuleInit();
  for (const eventType of ["cross-sell.offer.suggested", "cross-sell.offer.accepted", "cross-sell.offer.declined"]) {
    assert.equal(bus.handlersFor(eventType).length, 1);
    const event = { eventType, eventId: `event:${eventType}`, merchantId: "merchant-a", payload: { session_id: "session-a", promo_id: "promo-a", agent_copy: "private customer prose" } };
    await bus.publish(event); await bus.publish(event);
  }
  assert.equal(rows.size, 3);
  for (const row of rows.values()) { assert.equal(row.merchantId, "merchant-a"); assert.equal(row.metadata.sessionId, "session-a"); assert(!JSON.stringify(row).includes("private customer prose")); }
  await assert.rejects(handler.handle({ eventType: "cross-sell.offer.suggested", merchantId: "merchant-a", payload: {} }), /cross_sell_audit_scope_missing/);
});
