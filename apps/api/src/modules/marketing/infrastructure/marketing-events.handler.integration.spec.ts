import { test } from "node:test";
import assert from "node:assert/strict";
import { marketingTestFixture } from "../marketing-test-fixture.js";
import { MarketingContactsService } from "../application/marketing-contacts.service.js";
import { MarketingEventsHandler } from "./marketing-events.handler.js";
import { MarketingObservability } from "./marketing-observability.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import type { MarketingClassifier } from "../domain/marketing-classifier.port.js";
async function setup() {
  const f = marketingTestFixture();
  const metrics = new MetricsService();
  const logs: unknown[] = [];
  const contacts = new MarketingContactsService(
    f.repository,
    {
      plan: async () => "growth",
      buyer: async () => null,
      verifiedAccount: async () => null,
      blockedByPreference: async () => false,
    },
    { now: () => new Date(f.now) }
  );
  const incoming = await contacts.inbound({
    merchantId: f.merchantId,
    channel: "whatsapp",
    conversationKey: "session",
    verifiedPhone: "5511999991234",
    messageId: "first",
    text: "Quero comprar tênis",
    receivedAt: f.now,
    consentChoice: "declined",
  });
  const classifier: MarketingClassifier = {
    classify: async () => ({ evidence: "Quero comprar", interests: ["Tênis"] }),
  };
  const checkout = {
    session: async () => ({
      sessionId: "session",
      conversationId: "conv",
      globalUserId: "wa-buyer",
      verifiedPhone: "5511999991234",
      shopping: false,
    }),
    order: async (): Promise<{
      id: string;
      amountCents: number;
      occurredAt: string;
    } | null> => null,
  };
  const payments = { pending: async () => false };
  const handler = new MarketingEventsHandler(
    { publish: async () => {}, subscribe: () => {}, handlersFor: () => [] },
    f.repository,
    contacts,
    checkout,
    payments,
    classifier,
    new MarketingObservability(metrics, {
      log: (v) => logs.push(v),
      warn: (v) => logs.push(v),
    })
  );
  return {
    ...f,
    contacts,
    incoming,
    classifier,
    checkout,
    payments,
    handler,
    logs,
    cleanup: async () => {
      metrics.registry.clear();
      await f.cleanup();
    },
  };
}
test("MKT-04/3 AI classification persists a justified interested stage without a financial claim", async () => {
  const f = await setup();
  try {
    await f.handler.classify(
      f.merchantId,
      f.incoming.conversationId,
      f.incoming.contactId!,
      "Quero comprar tênis",
      "classification-message"
    );
    const d = await f.contacts.detail(f.merchantId, f.incoming.contactId!);
    assert.equal(d.contact.stage, "interested");
    assert.equal(d.history[0].author, "ai");
    assert.equal(d.history[0].reason, "Quero comprar");
    assert.deepEqual(d.contact.interests, ["Tênis"]);
    assert.equal(d.contact.purchaseCount, 0);
  } finally {
    await f.cleanup();
  }
});
test("MKT-04/4 business events use the authoritative order instead of supplied event totals", async () => {
  const f = await setup();
  try {
    f.checkout.order = async () => ({
      id: "confirmed-order",
      amountCents: 12345,
      occurredAt: f.now,
    });
    await f.handler.handle({
      eventType: "order.completed",
      merchantId: f.merchantId,
      payload: { session_id: "session", order_total: 999999 },
    });
    await f.handler.handle({
      eventType: "order.completed",
      merchantId: f.merchantId,
      payload: { session_id: "session", order_total: 999999 },
    });
    const d = await f.contacts.detail(f.merchantId, f.incoming.contactId!);
    assert.equal(d.contact.stage, "purchased");
    assert.equal(d.contact.totalSpentCents, 12345);
    assert.equal(d.contact.purchaseCount, 1);
  } finally {
    await f.cleanup();
  }
});
test("MKT-10/2 classification failure preserves the contact and records an operation failure", async () => {
  const f = await setup();
  try {
    f.classifier.classify = async () => {
      throw new Error("model-unavailable");
    };
    await assert.rejects(
      f.handler.classify(
        f.merchantId,
        f.incoming.conversationId,
        f.incoming.contactId!,
        "Quero comprar",
        "classification-message"
      ),
      /model-unavailable/
    );
    const d = await f.contacts.detail(f.merchantId, f.incoming.contactId!);
    assert.equal(d.contact.stage, "new");
    assert.equal(d.contact.purchaseCount, 0);
    assert.equal(d.history.length, 0);
    assert.match(
      JSON.stringify(f.logs),
      /"operation":"classification","outcome":"failed"/
    );
  } finally {
    await f.cleanup();
  }
});
