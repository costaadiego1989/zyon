import test from "node:test";
import assert from "node:assert/strict";
import type { BuyerConversationRepository, BuyerConversation, BuyerConversationMessage } from "../domain/ports/buyer-conversation.port.js";

class InMemoryBuyerConversationRepository implements BuyerConversationRepository {
  private readonly byId = new Map<string, BuyerConversation>();

  async listByBuyer(globalUserId: string): Promise<BuyerConversation[]> {
    return [...this.byId.values()]
      .filter((c) => c.globalUserId === globalUserId)
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  }
  async findById(globalUserId: string, id: string): Promise<BuyerConversation | null> {
    const c = this.byId.get(id);
    if (!c || c.globalUserId !== globalUserId) return null;
    return c;
  }
  async rateMessage(input: {
    conversationId: string;
    messageId: string;
    globalUserId: string;
    rating: "up" | "down";
  }): Promise<void> {
    // Validate rating value (port contract)
    if (input.rating !== "up" && input.rating !== "down") {
      throw new Error("buyer_conversation_invalid_rating");
    }
    const c = this.byId.get(input.conversationId);
    if (!c || c.globalUserId !== input.globalUserId) return;
    const target = c.messages.find((m) => m.id === input.messageId);
    if (!target) throw new Error("buyer_conversation_message_not_found");
    const updated = c.messages.map((m) =>
      m.id === input.messageId ? { ...m, rating: input.rating } : m
    );
    this.byId.set(c.id, { ...c, messages: updated });
  }
  async save(c: BuyerConversation): Promise<void> {
    this.byId.set(c.id, c);
  }
}

function buildConversation(globalUserId: string, id: string): BuyerConversation {
  const now = new Date("2026-06-10T12:00:00.000Z");
  const messages: BuyerConversationMessage[] = [
    {
      id: `${id}_m1`,
      role: "buyer",
      content: "Tem desconto?",
      createdAt: now,
      rating: null,
    },
    {
      id: `${id}_m2`,
      role: "agent",
      content: "Posso oferecer 5%.",
      createdAt: new Date("2026-06-10T12:00:30.000Z"),
      rating: null,
    },
  ];
  return {
    id,
    globalUserId,
    sessionId: `session_${id}`,
    merchantId: "mrc_1",
    startedAt: now,
    lastMessageAt: messages[messages.length - 1]!.createdAt,
    messages,
  };
}

test("BuyerConversationRepository.listByBuyer returns buyer conversations ordered by recency", async () => {
  const repo = new InMemoryBuyerConversationRepository();
  await repo.save(buildConversation("guser_1", "conv_1"));
  await repo.save(buildConversation("guser_1", "conv_2"));
  await repo.save(buildConversation("guser_OTHER", "conv_3"));

  const list = await repo.listByBuyer("guser_1");
  assert.equal(list.length, 2);
  assert.equal(list[0]!.id, "conv_2");
  assert.equal(list[1]!.id, "conv_1");
});

test("BuyerConversationRepository.findById enforces buyer isolation", async () => {
  const repo = new InMemoryBuyerConversationRepository();
  await repo.save(buildConversation("guser_1", "conv_1"));

  const own = await repo.findById("guser_1", "conv_1");
  assert.ok(own);

  const stolen = await repo.findById("guser_OTHER", "conv_1");
  assert.equal(stolen, null);
});

test("Rating updates only the targeted message and leaves others unchanged", async () => {
  const repo = new InMemoryBuyerConversationRepository();
  await repo.save(buildConversation("guser_1", "conv_1"));

  await repo.rateMessage({
    conversationId: "conv_1",
    messageId: "conv_1_m2",
    globalUserId: "guser_1",
    rating: "up",
  });

  const c = await repo.findById("guser_1", "conv_1");
  assert.ok(c);
  const m2 = c!.messages.find((m) => m.id === "conv_1_m2");
  const m1 = c!.messages.find((m) => m.id === "conv_1_m1");
  assert.equal(m2!.rating, "up");
  assert.equal(m1!.rating, null);
});

test("Rating with invalid rating value throws", async () => {
  const repo = new InMemoryBuyerConversationRepository();
  await repo.save(buildConversation("guser_1", "conv_1"));
  await assert.rejects(
    () =>
      repo.rateMessage({
        conversationId: "conv_1",
        messageId: "conv_1_m2",
        globalUserId: "guser_1",
        // @ts-expect-error - intentional bad rating
        rating: "neutral",
      }),
    /buyer_conversation_invalid_rating/
  );
});

test("Rating throws when messageId does not belong to conversation", async () => {
  const repo = new InMemoryBuyerConversationRepository();
  await repo.save(buildConversation("guser_1", "conv_1"));

  await assert.rejects(
    () =>
      repo.rateMessage({
        conversationId: "conv_1",
        messageId: "conv_1_NOTFOUND",
        globalUserId: "guser_1",
        rating: "up",
      }),
    /buyer_conversation_message_not_found/
  );
});
