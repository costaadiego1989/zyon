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

  async listByBuyer(globalUserId: string): Promise<BuyerConversation[]> {
    const rows = await (this.prisma.buyerConversation as unknown as {
      findMany: (args: {
        where: { globalUserId: string };
        orderBy: Record<string, "desc">;
      }) => Promise<ConversationRow[]>;
    }).findMany({
      where: { globalUserId },
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

  async rateMessage(input: {
    conversationId: string;
    messageId: string;
    globalUserId: string;
    rating: "up" | "down";
  }): Promise<void> {
    // Validate before attempting update
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