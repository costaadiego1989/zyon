/**
 * SUPP-H3: Handoff logic — ticket creation + message formatting.
 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { appendSupportEvent, lockSupportResource, persistSupportMessage } from "./support-persistence.js";
import type { SupportTicket } from "@zyon/shared-types";
import { SupportTicketEntity } from "../domain/entities/support-ticket.entity.js";
import {
  SUPPORT_TICKET_REPOSITORY,
  type SupportTicketRepository,
} from "../domain/ports/support-ticket-repository.port.js";
import { SupportTicketEventPublisher } from "./support-ticket-event.publisher.js";
import { productQuestionIntakeSchema, productQuestionMessageMetadataSchema, type BuyerProductQuestion } from "../domain/product-question-history.js";

export interface HandoffInput {
  merchantId: string;
  sessionId?: string;
  buyerMessage: string;
  /** Set only from authenticated server context, never from model arguments. */
  buyerId?: string;
  initialMessage?: string;
  /** Server-owned product identity, never inferred from author names or message prefixes. */
  productQuestion?: { productId: string; questionText: string };
}

export interface HandoffResult {
  ticketId: string;
  reply: string;
  questionMessageId?: string;
}

@Injectable()
export class SupportHandoffService {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY) private readonly tickets: SupportTicketRepository,
    private readonly publisher: SupportTicketEventPublisher,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  async createHandoff(
    input: HandoffInput,
    contextReply?: string,
  ): Promise<HandoffResult> {
    if (this.prisma) return this.persistHandoff(input, contextReply);
    const ticket = await this.tickets.save(
      SupportTicketEntity.create({
        merchantId: input.merchantId,
        sessionId: input.sessionId,
        buyerMessage: input.buyerMessage,
        source: "widget",
      }).snapshot(),
    );

    // Publish event fire-and-forget (ticket already persisted)
    this.publisher.publishCreated(ticket);

    return {
      ticketId: ticket.id,
      reply: formatHandoffReply(ticket, contextReply),
    };
  }

  private async persistHandoff(input: HandoffInput, contextReply?: string): Promise<HandoffResult> {
    const candidate = SupportTicketEntity.create(input).snapshot();
    const question = input.productQuestion ? productQuestionIntakeSchema.parse({ ...input.productQuestion,
      buyerId: input.buyerId, sessionId: input.sessionId }) : undefined;
    const persistInitial = async (tx: Prisma.TransactionClient, ticketId: string, content: string) => {
      const id = question ? randomUUID() : undefined;
      return persistSupportMessage(tx, { id, merchantId: input.merchantId, ticketId, senderType: "buyer", content,
        ...(question && id ? { metadata: { ...question, kind: "product_question", schemaVersion: 1,
          merchantId: input.merchantId, ticketId, questionMessageId: id } } : {}) });
    };
    const result = await this.prisma!.$transaction(async tx => {
      const sessionId = candidate.sessionId;
      if (sessionId) await lockSupportResource(tx, `support-session:${candidate.merchantId}:${sessionId}`);
      await lockSupportResource(tx, `support-open:${candidate.merchantId}:${input.buyerId || sessionId || candidate.id}`);
      const previous = sessionId || input.buyerId ? await tx.supportTicket.findFirst({ where: {
        merchantId: candidate.merchantId, source: "widget", returnId: null, mergedIntoId: null,
        status: { in: ["open", "in_progress"] },
        ...(input.buyerId ? { OR: [{ buyerId: input.buyerId }, ...(sessionId ? [{ sessionId, buyerId: null }] : [])] }
          : { sessionId, buyerId: null }),
      }, orderBy: { createdAt: "desc" } }) : null;
      if (previous) {
        if (input.buyerId && !previous.buyerId) await tx.supportTicket.update({ where: { id: previous.id }, data: { buyerId: input.buyerId } });
        const first = await tx.supportTicketMessage.findFirst({ where: { ticketId: previous.id }, select: { id: true } });
        if (!first) await persistSupportMessage(tx, { merchantId: candidate.merchantId, ticketId: previous.id,
          senderType: "buyer", content: previous.buyerMessage });
        // Reusing an active case must preserve a newly supplied intake message.
        // The same open-case lock serializes retries; identical intake text is
        // recorded once without creating a second case or creation notification.
        const initial = input.initialMessage?.trim();
        const found = initial ? await tx.supportTicketMessage.findFirst({ where: { ticketId: previous.id, senderType: "buyer", content: initial,
          ...(question ? { AND: [
            { metadata: { path: ["kind"], equals: "product_question" } }, { metadata: { path: ["schemaVersion"], equals: 1 } },
            { metadata: { path: ["merchantId"], equals: candidate.merchantId } }, { metadata: { path: ["ticketId"], equals: previous.id } },
            { metadata: { path: ["productId"], equals: question.productId } }, { metadata: { path: ["buyerId"], equals: question.buyerId } },
            { metadata: { path: ["sessionId"], equals: question.sessionId } }, { metadata: { path: ["questionText"], equals: question.questionText } },
          ] } : {}) }, select: { id: true, metadata: true } }) : null;
        const metadata = question ? productQuestionMessageMetadataSchema.safeParse(found?.metadata) : undefined;
        const existing = question ? metadata?.success && metadata.data.questionMessageId === found?.id
          && metadata.data.merchantId === candidate.merchantId && metadata.data.ticketId === previous.id
          && metadata.data.productId === question.productId && metadata.data.buyerId === question.buyerId
          && metadata.data.sessionId === question.sessionId && metadata.data.questionText === question.questionText ? found : null : found;
        let questionMessageId = question ? existing?.id : undefined;
        if (initial && !existing) {
          const message = await persistInitial(tx, previous.id, initial);
          if (question) questionMessageId = message.id;
        }
        return { created: false, questionMessageId, ticket: { ...candidate, id: previous.id, buyerMessage: previous.buyerMessage,
          status: previous.status as "open" | "in_progress", createdAt: previous.createdAt.toISOString(), updatedAt: previous.updatedAt.toISOString() } };
      }
      await tx.supportTicket.create({ data: { id: candidate.id, merchantId: candidate.merchantId,
        sessionId, buyerId: input.buyerId, buyerMessage: candidate.buyerMessage, source: "widget", status: "open",
        createdAt: new Date(candidate.createdAt), updatedAt: new Date(candidate.updatedAt) } });
      const message = await persistInitial(tx, candidate.id, input.initialMessage?.trim() || candidate.buyerMessage);
      await appendSupportEvent(tx, candidate.merchantId, candidate.id, "created");
      return { created: true, ticket: candidate, questionMessageId: question ? message.id : undefined };
    });
    if (result.created) this.publisher.publishCreated(result.ticket);
    return { ticketId: result.ticket.id, reply: formatHandoffReply(result.ticket, contextReply),
      ...(result.questionMessageId ? { questionMessageId: result.questionMessageId } : {}) };
  }

  /** Caller supplies the canonical authenticated buyer; legacy/free-text cases are not attributed retroactively. */
  async listProductQuestions(input: { merchantId: string; buyerId: string; productId: string }): Promise<
    { available: false } | { available: true; questions: BuyerProductQuestion[]; hasMore: boolean }> {
    if (!this.prisma || !input.merchantId || !input.buyerId || !input.productId) return { available: false };
    const limit = 20;
    try {
      const rows = await this.prisma.supportTicketMessage.findMany({ where: { senderType: "buyer",
        ticket: { merchantId: input.merchantId, buyerId: input.buyerId, source: "widget" },
        AND: [{ metadata: { path: ["kind"], equals: "product_question" } }, { metadata: { path: ["schemaVersion"], equals: 1 } },
          { metadata: { path: ["merchantId"], equals: input.merchantId } },
          { metadata: { path: ["productId"], equals: input.productId } }, { metadata: { path: ["buyerId"], equals: input.buyerId } }],
      }, select: { id: true, ticketId: true, metadata: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 });
      const questions = rows.slice(0, limit).flatMap(row => {
        const metadata = productQuestionMessageMetadataSchema.safeParse(row.metadata);
        if (!metadata.success || metadata.data.questionMessageId !== row.id || metadata.data.ticketId !== row.ticketId
          || metadata.data.merchantId !== input.merchantId || metadata.data.productId !== input.productId
          || metadata.data.buyerId !== input.buyerId) return [];
        return [{ id: row.id, ticketId: row.ticketId, question: metadata.data.questionText,
          date: row.createdAt.toISOString(), answerState: "not_linked" as const }];
      });
      return { available: true, questions, hasMore: rows.length > limit };
    } catch { return { available: false }; }
  }

  /** Caller must verify both the private conversation capability and buyer JWT. */
  async linkBuyerConversation(merchantId: string, sessionId: string, buyerId: string): Promise<{ linked: number }> {
    if (!this.prisma) return { linked: 0 };
    return this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, `support-session:${merchantId}:${sessionId}`);
      const linked = await tx.supportTicket.updateMany({ where: { merchantId, sessionId, source: "widget", buyerId: null }, data: { buyerId } });
      const active = await tx.supportTicket.findMany({ where: { merchantId, sessionId, buyerId, source: "widget",
        returnId: null, mergedIntoId: null, status: { in: ["open", "in_progress"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      if (active[0]) {
        if (active.length > 1) await tx.supportTicket.updateMany({ where: { merchantId, buyerId, id: { in: active.slice(1).map(ticket => ticket.id) } }, data: { mergedIntoId: active[0].id } });
        const first = await tx.supportTicketMessage.findFirst({ where: { ticketId: active[0].id }, select: { id: true } });
        if (!first) await persistSupportMessage(tx, { merchantId, ticketId: active[0].id, senderType: "buyer", content: active[0].buyerMessage });
      }
      return { linked: linked.count };
    });
  }
}

/**
 * SUPP-H3: Formats the handoff message sent to the buyer.
 * Uses last 6 chars of ticket ID as human-readable reference.
 */
function formatHandoffReply(ticket: SupportTicket, contextReply?: string): string {
  const ticketRef = ticket.id.slice(-6).toUpperCase();
  const prefix = contextReply?.trim() ? `${contextReply.trim()}\n\n` : "";
  return `${prefix}Também abri um chamado para a equipe da loja acompanhar de perto. Referência: ${ticketRef}.`;
}
