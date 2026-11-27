import { test } from "node:test";
import assert from "node:assert/strict";
import { marketingTestFixture } from "../marketing-test-fixture.js";
import { MarketingContactsService } from "./marketing-contacts.service.js";
import { MarketingConversationsService } from "./marketing-conversations.service.js";
import type { MerchantMarketingMessaging } from "../../../shared/contracts/marketing.js";

async function setup(channel: "site" | "whatsapp" = "site") {
  const f = marketingTestFixture();
  const clock = { now: () => new Date(f.now) };
  const contacts = new MarketingContactsService(
    f.repository,
    {
      plan: async () => "growth",
      buyer: async () => null,
      verifiedAccount: async () => null,
      blockedByPreference: async () => false,
    },
    clock
  );
  let sends = 0;
  const messaging: MerchantMarketingMessaging = {
    sendFreeform: async () => {
      sends++;
      return { status: "accepted", messageId: "provider-1" };
    },
    sendOpening: async () => ({ status: "accepted" }),
    submitTemplate: async () => ({
      name: "t",
      status: "approved",
      wabaId: "w",
    }),
    checkTemplate: async () => true,
    sendCampaign: async () => ({ status: "accepted" }),
  };
  const service = new MarketingConversationsService(
    f.repository,
    contacts,
    messaging,
    clock
  );
  const inbound = await contacts.inbound({
    merchantId: f.merchantId,
    channel,
    conversationKey: "conversation",
    messageId: "first",
    text: "Olá",
    receivedAt: f.now,
    verifiedPhone: channel === "whatsapp" ? "5511999991234" : undefined,
    consentChoice: "declined",
  });
  return {
    ...f,
    contacts,
    service,
    messaging,
    clock,
    inbound,
    sends: () => sends,
  };
}
test("MKT-03/1 conversation detail shows chronological messages and known context", async () => {
  const f = await setup();
  try {
    const d = await f.service.detail(f.merchantId, f.inbound.conversationId);
    assert.equal(d.conversation.channel, "site");
    assert.equal(d.messages[0].content, "Olá");
    assert.equal(d.messages[0].role, "buyer");
    assert.equal(d.contact, null);
  } finally {
    await f.cleanup();
  }
});
test("MKT-03/2 human takeover suppresses an AI response generated before the claim", async () => {
  const f = await setup();
  try {
    const claimed = await f.service.ownership(
      f.merchantId,
      f.inbound.conversationId,
      "agent-1",
      "claim",
      0
    );
    let delivered = false;
    const result = await f.service.aiReply(
      f.merchantId,
      claimed.id,
      "late-ai",
      "Resposta atrasada",
      async () => {
        delivered = true;
        return { status: "accepted" };
      }
    );
    assert.equal(result, false);
    assert.equal(delivered, false);
    const d = await f.service.detail(f.merchantId, claimed.id);
    assert.equal(d.conversation.assignedUserId, "agent-1");
    assert.equal(
      d.messages.some((m) => m.role === "ai"),
      false
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-03/3 two agents cannot silently own the same conversation", async () => {
  const f = await setup();
  try {
    const results = await Promise.allSettled(
      ["one", "two"].map((actor) =>
        f.service.ownership(
          f.merchantId,
          f.inbound.conversationId,
          actor,
          "claim",
          0
        )
      )
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected");
    assert.ok(
      rejected?.status === "rejected" &&
        String(rejected.reason).includes("marketing_conversation_assigned")
    );
    const d = await f.service.detail(f.merchantId, f.inbound.conversationId);
    assert.equal(d.conversation.mode, "human");
    assert.ok(["one", "two"].includes(d.conversation.assignedUserId!));
  } finally {
    await f.cleanup();
  }
});
test("MKT-03/4 human reply is persisted in the original channel with the agent author", async () => {
  const f = await setup("whatsapp");
  try {
    const c = await f.service.ownership(
      f.merchantId,
      f.inbound.conversationId,
      "agent",
      "claim",
      0
    );
    const r = await f.service.reply(
      f.merchantId,
      c.id,
      "agent",
      "Posso ajudar",
      "request-1",
      c.version
    );
    assert.equal(r.message.status, "accepted");
    assert.equal(r.message.providerMessageId, "provider-1");
    assert.equal(r.message.authorId, "agent");
    const d = await f.service.detail(f.merchantId, c.id);
    assert.equal(d.messages.at(-1)?.content, "Posso ajudar");
    assert.equal(d.conversation.channel, "whatsapp");
    assert.equal(f.sends(), 1);
  } finally {
    await f.cleanup();
  }
});
test("MKT-03/5 finishing handoff restores AI with the human messages in history", async () => {
  const f = await setup();
  try {
    const c = await f.service.ownership(
      f.merchantId,
      f.inbound.conversationId,
      "agent",
      "claim",
      0
    );
    const reply = await f.service.reply(
      f.merchantId,
      c.id,
      "agent",
      "Condição esclarecida",
      "request",
      c.version
    );
    await f.service.ownership(
      f.merchantId,
      c.id,
      "agent",
      "release",
      reply.conversation.version
    );
    assert.equal(
      await f.service.aiReply(
        f.merchantId,
        c.id,
        "next",
        "Vamos continuar",
        async () => ({ status: "accepted" })
      ),
      true
    );
    const d = await f.service.detail(f.merchantId, c.id);
    assert.equal(d.conversation.mode, "ai");
    assert.equal(d.conversation.assignedUserId, null);
    assert.equal(
      d.messages.some(
        (m) => m.role === "agent" && m.content === "Condição esclarecida"
      ),
      true
    );
    assert.equal(d.messages.at(-1)?.content, "Vamos continuar");
  } finally {
    await f.cleanup();
  }
});
test("MKT-03/6 expired WhatsApp session rejects freeform without a provider call", async () => {
  const f = await setup("whatsapp");
  try {
    const c = await f.service.ownership(
      f.merchantId,
      f.inbound.conversationId,
      "agent",
      "claim",
      0
    );
    f.clock.now = () => new Date("2026-11-28T12:00:00Z");
    await assert.rejects(
      f.service.reply(
        f.merchantId,
        c.id,
        "agent",
        "Mensagem tardia",
        "request",
        c.version
      ),
      /marketing_service_window_expired/
    );
    assert.equal(f.sends(), 0);
    const d = await f.service.detail(f.merchantId, c.id);
    assert.equal(
      d.messages.some((m) => m.content === "Mensagem tardia"),
      false
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-06/4 an uncertain human send remains unknown and is not repeated", async () => {
  const f = await setup("whatsapp");
  try {
    const c = await f.service.ownership(
      f.merchantId,
      f.inbound.conversationId,
      "agent",
      "claim",
      0
    );
    let attempts = 0;
    f.messaging.sendFreeform = async () => {
      attempts++;
      throw new Error("timeout");
    };
    const first = await f.service.reply(
      f.merchantId,
      c.id,
      "agent",
      "Olá",
      "same-key",
      c.version
    );
    const replay = await f.service.reply(
      f.merchantId,
      c.id,
      "agent",
      "Olá",
      "same-key",
      c.version
    );
    assert.equal(first.message.status, "unknown");
    assert.equal(replay.message.id, first.message.id);
    assert.equal(attempts, 1);
    assert.equal(
      (await f.service.detail(f.merchantId, c.id)).messages.filter(
        (m) => m.role === "agent"
      ).length,
      1
    );
  } finally {
    await f.cleanup();
  }
});
