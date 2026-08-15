import type { PrismaClient } from "@prisma/client";
import type {
  BuyerConversation,
  BuyerConversationMessage,
} from "../domain/ports/buyer-conversation.port.js";
import type { BuyerConversationRepository } from "../domain/ports/buyer-conversation.port.js";

type ConversationRow = {
  id: string;
  globalUserId: string;
  sessionId: string;
  merchantId: string;
  messages: unknown;
  startedAt: Date;
  lastMessageAt: Date;
};

export class PrismaBuyerConversationRepository implements BuyerConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByBuyer(globalUserId: string, options?: { maxAgeDays?: number }): Promise<BuyerConversation[]> {
    const maxAge = options?.maxAgeDays ?? 30;
    const cutoff = new Date(Date.now() - maxAge * 24 * 3600_000);
    const rows = await (this.prisma.buyerConversation as unknown as {
      findMany: (args: {
        where: { globalUserId: string; lastMessageAt?: { gte: Date } };
        orderBy: Record<string, "desc">;
      }) => Promise<ConversationRow[]>;
    }).findMany({
      where: { globalUserId, lastMessageAt: { gte: cutoff } },
      orderBy: { lastMessageAt: "desc" },
    });
    return rows.map(toDomain);
  }

  async listByBuyerSince(globalUserId: string, since: Date): Promise<BuyerConversation[]> {
    const rows = await (this.prisma.buyerConversation as unknown as {
      findMany: (args: {
        where: { globalUserId: string; lastMessageAt: { gte: Date } };
        orderBy: Record<string, "desc">;
      }) => Promise<ConversationRow[]>;
    }).findMany({
      where: { globalUserId, lastMessageAt: { gte: since } },
      orderBy: { lastMessageAt: "desc" },
    });
    return rows.map(toDomain);
  }

  async findById(globalUserId: string, id: string): Promise<BuyerConversation | null> {
    const row = await (this.prisma.buyerConversation as unknown as {
      findFirst: (args: { where: { id: string; globalUserId: string } }) => Promise<ConversationRow | null>;
    }).findFirst({ where: { id, globalUserId } });
    return row ? toDomain(row) : null;
  }

  async findBySession(merchantId: string, sessionId: string): Promise<BuyerConversation | null> {
    const row = await (this.prisma.buyerConversation as unknown as {
      findFirst: (args: { where: { merchantId: string; sessionId: string } }) => Promise<ConversationRow | null>;
    }).findFirst({ where: { merchantId, sessionId } });
    return row ? toDomain(row) : null;
  }

  async upsertConversation(input: {
    globalUserId: string;
    sessionId: string;
    merchantId: string;
    message: BuyerConversationMessage;
  }): Promise<void> {
    const now = new Date();
    const serializedMsg = {
      id: input.message.id,
      role: input.message.role,
      content: input.message.content,
      createdAt: input.message.createdAt.toISOString(),
      rating: input.message.rating
    };

    const existing = await this.findBySession(input.merchantId, input.sessionId);
    if (existing) {
      const currentMessages = existing.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        rating: m.rating
      }));
      currentMessages.push(serializedMsg);

      await (this.prisma.buyerConversation as unknown as {
        update: (args: {
          where: { id: string };
          data: { messages: unknown; lastMessageAt: Date };
        }) => Promise<unknown>;
      }).update({
        where: { id: existing.id },
        data: { messages: currentMessages, lastMessageAt: now }
      });
    } else {
      await (this.prisma.buyerConversation as unknown as {
        create: (args: {
          data: { globalUserId: string; merchantId: string; sessionId: string; messages: unknown; startedAt: Date; lastMessageAt: Date };
        }) => Promise<unknown>;
      }).create({
        data: {
          globalUserId: input.globalUserId,
          merchantId: input.merchantId,
          sessionId: input.sessionId,
          messages: [serializedMsg],
          startedAt: now,
          lastMessageAt: now
        }
      });
    }
  }

  async upsertFromCheckout(input: {
    merchantId: string;
    sessionId: string;
    globalUserId: string;
    messages: BuyerConversationMessage[];
  }): Promise<void> {
    const now = new Date();
    const serialized = input.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      rating: m.rating
    }));

    await (this.prisma.buyerConversation as unknown as {
      upsert: (args: {
        where: { merchantId_sessionId: { merchantId: string; sessionId: string } };
        create: { globalUserId: string; merchantId: string; sessionId: string; messages: unknown; startedAt: Date; lastMessageAt: Date };
        update: { messages: unknown; lastMessageAt: Date };
      }) => Promise<unknown>;
    }).upsert({
      where: { merchantId_sessionId: { merchantId: input.merchantId, sessionId: input.sessionId } },
      create: {
        globalUserId: input.globalUserId,
        merchantId: input.merchantId,
        sessionId: input.sessionId,
        messages: serialized,
        startedAt: now,
        lastMessageAt: now
      },
      update: {
        messages: serialized,
        lastMessageAt: now
      }
    });
  }

  async rateMessage(input: {
    conversationId: string;
    messageId: string;
    globalUserId: string;
    rating: "up" | "down";
  }): Promise<void> {
    if (input.rating !== "up" && input.rating !== "down") {
      throw new Error("buyer_conversation_invalid_rating");
    }

    const conversation = await (this.prisma.buyerConversation as unknown as {
      findFirst: (args: { where: { id: string; globalUserId: string } }) => Promise<ConversationRow | null>;
    }).findFirst({
      where: { id: input.conversationId, globalUserId: input.globalUserId },
    });
    if (!conversation) throw new Error("buyer_conversation_not_found");

    const messages = parseMessages(conversation.messages);
    const target = messages.find((m) => m.id === input.messageId);
    if (!target) throw new Error("buyer_conversation_message_not_found");

    const updated = messages.map((m) =>
      m.id === input.messageId ? { ...m, rating: input.rating } : m
    );

    await (this.prisma.buyerConversation as unknown as {
      update: (args: {
        where: { id: string };
        data: { messages: unknown };
      }) => Promise<unknown>;
    }).update({
      where: { id: input.conversationId },
      data: { messages: updated },
    });
  }
}

function toDomain(row: ConversationRow): BuyerConversation {
  return {
    id: row.id,
    globalUserId: row.globalUserId,
    sessionId: row.sessionId,
    merchantId: row.merchantId,
    startedAt: row.startedAt,
    lastMessageAt: row.lastMessageAt,
    messages: parseMessages(row.messages),
  };
}

function parseMessages(data: unknown): BuyerConversationMessage[] {
  if (!Array.isArray(data)) return [];
  return data.map((m) => ({
    id: String(m.id ?? ""),
    role: m.role === "agent" || m.role === "buyer" ? m.role : "buyer",
    content: String(m.content ?? ""),
    createdAt: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt ?? 0),
    rating: m.rating === "up" || m.rating === "down" ? m.rating : null,
  } as BuyerConversationMessage));
}