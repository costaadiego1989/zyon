import { test } from "node:test";
import assert from "node:assert/strict";
import { marketingTestFixture } from "../marketing-test-fixture.js";
import { MarketingContactsService } from "./marketing-contacts.service.js";
import { MARKETING_ACCEPT, MARKETING_DECLINE } from "../domain/marketing.js";
import type {
  MarketingBuyer,
  MarketingContext,
} from "../domain/marketing-context.port.js";

test("MKT-04/4 confirmed integer purchase above the 32-bit boundary is persisted exactly once", async () => {
  const f = setup();
  try {
    const first = await f.service.inbound(f.incoming());
    const result = await f.service.recordPurchase(
      f.merchantId,
      first.contactId!,
      "large-order",
      2147483648,
      f.now
    );
    const replay = await f.service.recordPurchase(
      f.merchantId,
      first.contactId!,
      "large-order",
      2147483648,
      f.now
    );
    assert.equal(result.totalSpentCents, 2147483648);
    assert.equal(replay.totalSpentCents, 2147483648);
    assert.equal(replay.purchaseCount, 1);
  } finally {
    await f.cleanup();
  }
});

test("MKT-01/5 replaying the same source message preserves exactly one contact and one original message", async () => {
  const f = setup();
  try {
    const first = await f.service.inbound(f.incoming());
    const replay = await f.service.inbound(f.incoming());
    assert.equal(replay.duplicate, true);
    assert.equal(replay.contactId, first.contactId);
    assert.equal(replay.conversationId, first.conversationId);
    assert.equal(
      (await f.service.list(f.merchantId, { limit: 10, offset: 0 })).total,
      1
    );
    const messages = await f.repository.transaction(
      f.merchantId,
      "read",
      (tx) => tx.messages(first.conversationId)
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, "Qual o preço?");
  } finally {
    await f.cleanup();
  }
});

test("MKT-04/6 importing an older purchase does not overwrite a newer commercial opportunity", async () => {
  const f = setup();
  try {
    const first = await f.service.inbound(f.incoming());
    await f.service.move(
      f.merchantId,
      first.contactId!,
      "shopping",
      "Nova oportunidade",
      "agent",
      0
    );
    const imported = await f.service.recordPurchase(
      f.merchantId,
      first.contactId!,
      "old-order",
      2500,
      "2026-10-01T12:00:00.000Z"
    );
    assert.equal(imported.stage, "shopping");
    assert.equal(imported.stageAt, f.now);
    assert.equal(imported.purchaseCount, 1);
    assert.equal(imported.totalSpentCents, 2500);
  } finally {
    await f.cleanup();
  }
});

test("MKT-02/5 out-of-order old grants cannot undo a newer WhatsApp revocation", async () => {
  const f = setup();
  try {
    const first = await f.service.inbound(
      f.incoming({
        text: "quero receber",
        receivedAt: "2026-11-27T10:00:00.000Z",
      })
    );
    await f.service.inbound(
      f.incoming({
        messageId: "new-opt-out",
        text: "PARAR",
        receivedAt: "2026-11-27T11:00:00.000Z",
      })
    );
    await f.service.inbound(
      f.incoming({
        messageId: "late-grant",
        text: "quero receber",
        receivedAt: "2026-11-27T10:30:00.000Z",
      })
    );
    const detail = await f.service.detail(f.merchantId, first.contactId!);
    assert.equal(detail.consent?.status, "revoked");
    assert.equal(detail.consent?.evidenceId, "new-opt-out");
    assert.equal(detail.consent?.recordedAt, "2026-11-27T11:00:00.000Z");
  } finally {
    await f.cleanup();
  }
});

function setup() {
  const f = marketingTestFixture();
  const buyers = new Map<string, MarketingBuyer>();
  const context: MarketingContext = {
    plan: async () => "growth",
    buyer: async (id) => buyers.get(id) ?? null,
    verifiedAccount: async (phone) =>
      [...buyers.values()].find((b) => b.verifiedPhone === phone) ?? null,
    blockedByPreference: async () => false,
  };
  const service = new MarketingContactsService(f.repository, context, {
    now: () => new Date(f.now),
  });
  const incoming = (overrides = {}) => ({
    merchantId: f.merchantId,
    channel: "whatsapp" as const,
    conversationKey: "wa-conversation",
    messageId: "wa-1",
    text: "Qual o preço?",
    receivedAt: f.now,
    verifiedPhone: "5511999991234",
    ...overrides,
  });
  return { ...f, buyers, context, service, incoming };
}
test("MKT-02/5 cached site opening cannot undo an explicit later opt-out", async () => {
  const f = setup();
  try {
    f.buyers.set("buyer-opt-out", {
      id: "buyer-opt-out",
      name: "Ana",
      email: null,
      verifiedPhone: "5511999991234",
    });
    const first = await f.service.inbound(
      f.incoming({
        channel: "site",
        conversationKey: "site-choice",
        messageId: "first-site",
        accountId: "buyer-opt-out",
        consentChoice: "granted",
      })
    );
    await f.service.revoke(f.merchantId, first.contactId!, "buyer-request");
    await f.service.inbound(
      f.incoming({
        channel: "site",
        conversationKey: "site-choice",
        messageId: "next-site",
        accountId: "buyer-opt-out",
        consentChoice: "granted",
      })
    );
    const detail = await f.service.detail(f.merchantId, first.contactId!);
    assert.equal(detail.consent?.status, "revoked");
    assert.equal(detail.consent?.evidenceId, "buyer-request");
  } finally {
    await f.cleanup();
  }
});
test("MKT-01/1 first WhatsApp message creates a nameless contact without an account", async () => {
  const f = setup();
  try {
    const r = await f.service.inbound(f.incoming());
    const d = await f.service.detail(f.merchantId, r.contactId!);
    assert.equal(d.contact.phone, "5511999991234");
    assert.equal(d.contact.name, null);
    assert.equal(d.contact.accountId, null);
    assert.equal(d.contact.origin, "whatsapp");
    assert.equal(d.consent, null);
  } finally {
    await f.cleanup();
  }
});
test("MKT-01/2 authenticated site account creates the store contact", async () => {
  const f = setup();
  try {
    f.buyers.set("buyer-1", {
      id: "buyer-1",
      name: "Ana Silva",
      email: "ana@example.test",
      verifiedPhone: null,
    });
    const r = await f.service.inbound(
      f.incoming({
        channel: "site",
        accountId: "buyer-1",
        verifiedPhone: undefined,
      })
    );
    const d = await f.service.detail(f.merchantId, r.contactId!);
    assert.equal(d.contact.accountId, "buyer-1");
    assert.equal(d.contact.name, "Ana Silva");
    assert.equal(d.contact.origin, "site");
    assert.equal(d.contact.phone, null);
  } finally {
    await f.cleanup();
  }
});
test("MKT-01/3 anonymous site conversations do not create leads", async () => {
  const f = setup();
  try {
    const r = await f.service.inbound(
      f.incoming({ channel: "site", verifiedPhone: undefined })
    );
    assert.equal(r.contactId, null);
    assert.equal(
      (await f.service.list(f.merchantId, { limit: 10, offset: 0 })).total,
      0
    );
    const history = await f.repository.transaction(f.merchantId, "read", (tx) =>
      tx.messages(r.conversationId)
    );
    assert.equal(history[0].content, "Qual o preço?");
  } finally {
    await f.cleanup();
  }
});
test("MKT-01/4 unverified account phone never merges with WhatsApp", async () => {
  const f = setup();
  try {
    const wa = await f.service.inbound(f.incoming());
    f.buyers.set("buyer-2", {
      id: "buyer-2",
      name: "Outra Pessoa",
      email: null,
      verifiedPhone: null,
    });
    const site = await f.service.inbound(
      f.incoming({
        channel: "site",
        conversationKey: "site-2",
        messageId: "site-1",
        accountId: "buyer-2",
      })
    );
    assert.notEqual(site.contactId, wa.contactId);
    assert.equal(
      (await f.service.list(f.merchantId, { limit: 10, offset: 0 })).total,
      2
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-02/1 opening preserves the original question before a commercial answer", async () => {
  const f = setup();
  try {
    const r = await f.service.inbound(f.incoming());
    assert.equal(r.openingRequired, true);
    const conversation = await f.repository.transaction(
      f.merchantId,
      "read",
      (tx) => tx.conversation(r.conversationId)
    );
    assert.equal(conversation?.pendingQuestion, "Qual o preço?");
    const reply = await f.service.inbound(
      f.incoming({ messageId: "wa-2", text: MARKETING_ACCEPT })
    );
    assert.equal(reply.originalQuestion, "Qual o preço?");
    assert.equal(reply.openingRequired, false);
  } finally {
    await f.cleanup();
  }
});
test("MKT-02/2 accepted opening records tenant channel evidence without an account", async () => {
  const f = setup();
  try {
    const first = await f.service.inbound(f.incoming());
    await f.service.inbound(
      f.incoming({ messageId: "wa-2", text: MARKETING_ACCEPT })
    );
    const d = await f.service.detail(f.merchantId, first.contactId!);
    assert.equal(d.consent?.status, "granted");
    assert.equal(d.consent?.channel, "whatsapp");
    assert.equal(d.consent?.merchantId, f.merchantId);
    assert.equal(d.consent?.evidenceId, "wa-2");
    assert.equal(d.consent?.version, "marketing-opening-v1");
  } finally {
    await f.cleanup();
  }
});
test("MKT-02/3 declining continues the original question without promotional permission", async () => {
  const f = setup();
  try {
    const first = await f.service.inbound(f.incoming());
    const r = await f.service.inbound(
      f.incoming({ messageId: "wa-2", text: MARKETING_DECLINE })
    );
    assert.equal(r.originalQuestion, "Qual o preço?");
    assert.equal(r.openingRequired, false);
    assert.equal(
      (await f.service.detail(f.merchantId, first.contactId!)).consent?.status,
      "declined"
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-02/4 anonymous site choice becomes personal only after verified identity", async () => {
  const f = setup();
  try {
    const visitor = await f.service.inbound(
      f.incoming({
        channel: "site",
        verifiedPhone: undefined,
        consentChoice: "granted",
      })
    );
    assert.equal(visitor.contactId, null);
    f.buyers.set("buyer-1", {
      id: "buyer-1",
      name: "Ana",
      email: null,
      verifiedPhone: "5511999991234",
    });
    const identified = await f.service.inbound(
      f.incoming({
        channel: "site",
        messageId: "site-2",
        accountId: "buyer-1",
        verifiedPhone: undefined,
      })
    );
    assert.equal(identified.conversationId, visitor.conversationId);
    assert.equal(
      (await f.service.detail(f.merchantId, identified.contactId!)).consent
        ?.status,
      "granted"
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-04/2 manual movement persists previous stage, author and reason", async () => {
  const f = setup();
  try {
    const first = await f.service.inbound(f.incoming());
    await f.service.move(
      f.merchantId,
      first.contactId!,
      "interested",
      "Pediu preço",
      "agent-1",
      0
    );
    const d = await f.service.detail(f.merchantId, first.contactId!);
    assert.equal(d.contact.stage, "interested");
    assert.equal(d.history[0].from, "new");
    assert.equal(d.history[0].authorId, "agent-1");
    assert.equal(d.history[0].reason, "Pediu preço");
  } finally {
    await f.cleanup();
  }
});
test("MKT-04/5 text claiming payment cannot confirm a purchase", async () => {
  const f = setup();
  try {
    const first = await f.service.inbound(f.incoming({ text: "Já paguei" }));
    await assert.rejects(
      f.service.move(
        f.merchantId,
        first.contactId!,
        "purchased",
        "Já paguei",
        "agent",
        0
      ),
      /marketing_purchase_confirmation_required/
    );
    const d = await f.service.detail(f.merchantId, first.contactId!);
    assert.equal(d.contact.stage, "new");
    assert.equal(d.contact.purchaseCount, 0);
  } finally {
    await f.cleanup();
  }
});
test("MKT-04/4 confirmed orders update money once even when the event repeats", async () => {
  const f = setup();
  try {
    const first = await f.service.inbound(f.incoming());
    await f.service.recordPurchase(
      f.merchantId,
      first.contactId!,
      "order-1",
      12990,
      f.now
    );
    await f.service.recordPurchase(
      f.merchantId,
      first.contactId!,
      "order-1",
      12990,
      f.now
    );
    const d = await f.service.detail(f.merchantId, first.contactId!);
    assert.equal(d.contact.stage, "purchased");
    assert.equal(d.contact.purchaseCount, 1);
    assert.equal(d.contact.totalSpentCents, 12990);
  } finally {
    await f.cleanup();
  }
});
test("MKT-04/6 a new opportunity preserves the buyer's previous purchases", async () => {
  const f = setup();
  try {
    const first = await f.service.inbound(f.incoming());
    const bought = await f.service.recordPurchase(
      f.merchantId,
      first.contactId!,
      "order-1",
      5000,
      f.now
    );
    await f.service.move(
      f.merchantId,
      first.contactId!,
      "shopping",
      "Nova compra",
      "agent",
      bought.version
    );
    const d = await f.service.detail(f.merchantId, first.contactId!);
    assert.equal(d.contact.stage, "shopping");
    assert.equal(d.contact.purchaseCount, 1);
    assert.equal(d.contact.totalSpentCents, 5000);
  } finally {
    await f.cleanup();
  }
});
test("MKT-01/4 verified linkage merges prior site and WhatsApp contacts without losing purchases", async () => {
  const f = setup();
  try {
    f.buyers.set("buyer-1", {
      id: "buyer-1",
      name: "Ana Silva",
      email: "ana@example.test",
      verifiedPhone: null,
    });
    const site = await f.service.inbound(
      f.incoming({
        channel: "site",
        conversationKey: "site",
        messageId: "site-first",
        accountId: "buyer-1",
        verifiedPhone: undefined,
      })
    );
    await f.service.recordPurchase(
      f.merchantId,
      site.contactId!,
      "prior-order",
      9900,
      f.now
    );
    const wa = await f.service.inbound(
      f.incoming({ consentChoice: "declined" })
    );
    assert.notEqual(site.contactId, wa.contactId);
    f.buyers.set("buyer-1", {
      id: "buyer-1",
      name: "Ana Silva",
      email: "ana@example.test",
      verifiedPhone: "5511999991234",
    });
    const linked = await f.service.inbound(
      f.incoming({
        channel: "site",
        conversationKey: "site",
        messageId: "site-verified",
        accountId: "buyer-1",
        verifiedPhone: undefined,
      })
    );
    assert.equal(linked.contactId, wa.contactId);
    const all = await f.service.list(f.merchantId, { limit: 10, offset: 0 });
    assert.equal(all.total, 1);
    assert.equal(all.items[0].purchaseCount, 1);
    assert.equal(all.items[0].totalSpentCents, 9900);
    assert.equal(all.items[0].name, "Ana Silva");
    assert.deepEqual(
      new Set(all.items[0].channels),
      new Set(["site", "whatsapp"])
    );
    const conversation = await f.repository.transaction(
      f.merchantId,
      "read",
      (tx) => tx.conversation(site.conversationId)
    );
    assert.equal(conversation?.contactId, wa.contactId);
  } finally {
    await f.cleanup();
  }
});
