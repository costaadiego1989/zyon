import test from "node:test";
import assert from "node:assert/strict";
import type { BuyerConversationRepository, BuyerConversation, BuyerConversationMessage } from "../domain/ports/buyer-conversation.port.js";

class InMemoryBuyerConversationRepository implements BuyerConversationRepository {
  private readonly byId = new Map<string, BuyerConversation>();

  async listByBuyer(globalUserId: string, options?: { maxAgeDays?: number }): Promise<BuyerConversation[]> {
    const maxAge = options?.maxAgeDays ?? 30;
    const cutoff = new Date(Date.now() - maxAge * 24 * 3600_000);
    return [...this.byId.values()]
      .filter((c) => c.globalUserId === globalUserId && c.lastMessageAt >= cutoff)
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  }
  async listByBuyerSince(globalUserId: string, since: Date): Promise<BuyerConversation[]> {
    return [...this.byId.values()]
      .filter((c) => c.globalUserId === globalUserId && c.lastMessageAt >= since)
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  }
  async findById(globalUserId: string, id: string): Promise<BuyerConversation | null> {
    const c = this.byId.get(id);
    if (!c || c.globalUserId !== globalUserId) return null;
    return c;
  }
  async findBySession(merchantId: string, sessionId: string): Promise<BuyerConversation | null> {
    return [...this.byId.values()].find((c) => c.merchantId === merchantId && c.sessionId === sessionId) ?? null;
  }
  async upsertConversation(input: {
    globalUserId: string;
    sessionId: string;
    merchantId: string;
    message: BuyerConversationMessage;
  }): Promise<void> {
    const existing = await this.findBySession(input.merchantId, input.sessionId);
    if (existing) {
      existing.messages.push(input.message);
      existing.lastMessageAt = new Date();
      this.byId.set(existing.id, existing);
    } else {
      const id = `conv_${Date.now()}`;
      this.byId.set(id, {
        id,
        globalUserId: input.globalUserId,
        merchantId: input.merchantId,
        sessionId: input.sessionId,
        startedAt: new Date(),
        lastMessageAt: new Date(),
        messages: [input.message]
      });
    }
  }
  async upsertFromCheckout(input: {
    merchantId: string;
    sessionId: string;
    globalUserId: string;
    messages: BuyerConversationMessage[];
  }): Promise<void> {
    const existing = await this.findBySession(input.merchantId, input.sessionId);
    const id = existing?.id ?? `conv_${Date.now()}`;
    this.byId.set(id, {
      id,
      globalUserId: input.globalUserId,
      merchantId: input.merchantId,
      sessionId: input.sessionId,
      startedAt: existing?.startedAt ?? new Date(),
      lastMessageAt: new Date(),
      messages: input.messages
    });
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
  const now = new Date(Date.now() - 5 * 24 * 3600_000); // 5 days ago (within 30-day window)
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
      createdAt: new Date(now.getTime() + 30_000),
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
  const c1 = buildConversation("guser_1", "conv_1");
  c1.lastMessageAt = new Date(Date.now() - 4 * 24 * 3600_000); // 4 days ago
  const c2 = buildConversation("guser_1", "conv_2");
  c2.lastMessageAt = new Date(Date.now() - 2 * 24 * 3600_000); // 2 days ago (more recent)
  await repo.save(c1);
  await repo.save(c2);
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

test("upsertConversation creates new conversation when none exists", async () => {
  const repo = new InMemoryBuyerConversationRepository();
  const msg: BuyerConversationMessage = {
    id: "msg_1",
    role: "buyer",
    content: "Oi, tem estoque?",
    createdAt: new Date("2026-08-01T10:00:00Z"),
    rating: null,
  };

  await repo.upsertConversation({
    globalUserId: "guser_1",
    sessionId: "sess_new",
    merchantId: "mrc_1",
    message: msg,
  });

  const found = await repo.findBySession("mrc_1", "sess_new");
  assert.ok(found);
  assert.equal(found!.messages.length, 1);
  assert.equal(found!.messages[0]!.content, "Oi, tem estoque?");
});

test("upsertConversation appends message to existing conversation", async () => {
  const repo = new InMemoryBuyerConversationRepository();
  await repo.save(buildConversation("guser_1", "conv_1"));

  const msg: BuyerConversationMessage = {
    id: "msg_new",
    role: "agent",
    content: "Sim, temos em estoque!",
    createdAt: new Date("2026-08-01T11:00:00Z"),
    rating: null,
  };

  await repo.upsertConversation({
    globalUserId: "guser_1",
    sessionId: "session_conv_1",
    merchantId: "mrc_1",
    message: msg,
  });

  const found = await repo.findBySession("mrc_1", "session_conv_1");
  assert.ok(found);
  assert.equal(found!.messages.length, 3); // 2 original + 1 appended
  assert.equal(found!.messages[2]!.content, "Sim, temos em estoque!");
});

test("listByBuyerSince filters by date cutoff", async () => {
  const repo = new InMemoryBuyerConversationRepository();
  const recent = buildConversation("guser_1", "conv_recent");
  recent.lastMessageAt = new Date("2026-08-10T12:00:00Z");
  await repo.save(recent);

  const old = buildConversation("guser_1", "conv_old");
  old.lastMessageAt = new Date("2026-06-01T12:00:00Z");
  await repo.save(old);

  const since = new Date("2026-07-01T00:00:00Z");
  const result = await repo.listByBuyerSince("guser_1", since);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, "conv_recent");
});
