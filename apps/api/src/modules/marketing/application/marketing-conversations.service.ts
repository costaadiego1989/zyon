import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  MERCHANT_MARKETING_MESSAGING,
  type MerchantMarketingMessaging,
  type MerchantMarketingSendResult,
} from "../../../shared/contracts/marketing.js";
import {
  MARKETING_REPOSITORY,
  type MarketingRepository,
} from "../domain/marketing.repository.js";
import {
  MARKETING_CLOCK,
  type MarketingClock,
} from "../domain/marketing-context.port.js";
import {
  MARKETING_CONSENT_TEXT,
  MarketingError,
  requireWhatsAppWindow,
  type MarketingConversation,
  type MarketingMessage,
  type MarketingConversationFilters,
  type MarketingMessageCursor,
} from "../domain/marketing.js";
import { MarketingContactsService } from "./marketing-contacts.service.js";

@Injectable()
export class MarketingConversationsService {
  constructor(
    @Inject(MARKETING_REPOSITORY)
    private readonly repository: MarketingRepository,
    private readonly contacts: MarketingContactsService,
    @Inject(MERCHANT_MARKETING_MESSAGING)
    private readonly messaging: MerchantMarketingMessaging,
    @Inject(MARKETING_CLOCK) private readonly clock: MarketingClock
  ) {}

  async list(
    merchantId: string,
    limit = 50,
    offset = 0,
    filters: MarketingConversationFilters = {}
  ) {
    await this.contacts.requirePlan(merchantId);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw new MarketingError("marketing_query_invalid");
    return this.repository.transaction(merchantId, "conversation-list", (tx) =>
      tx.conversations(limit, offset, filters)
    );
  }
  async detail(merchantId: string, id: string, before?: string) {
    await this.contacts.requirePlan(merchantId);
    let cursor: MarketingMessageCursor | undefined;
    if (before) {
      try {
        if (before.length > 300 || !/^[A-Za-z0-9_-]+$/.test(before))
          throw new Error();
        const value = JSON.parse(
          Buffer.from(before, "base64url").toString("utf8")
        );
        if (
          !value ||
          typeof value.createdAt !== "string" ||
          !Number.isFinite(Date.parse(value.createdAt)) ||
          typeof value.sequence !== "string" ||
          !/^\d{1,19}$/.test(value.sequence) ||
          BigInt(value.sequence) > 9223372036854775807n
        )
          throw new Error();
        cursor = { createdAt: value.createdAt, sequence: value.sequence };
      } catch {
        throw new MarketingError("marketing_cursor_invalid");
      }
    }
    return this.repository.transaction(
      merchantId,
      `conversation:${id}`,
      async (tx) => {
        const conversation = await tx.conversation(id);
        if (!conversation)
          throw new MarketingError("marketing_conversation_not_found", 404);
        const rows = await tx.messages(id, 51, cursor);
        const messages = rows.slice(-50);
        for (const message of messages)
          if (
            message.status === "sending" &&
            this.clock.now().getTime() - Date.parse(message.createdAt) > 120000
          ) {
            message.status = "unknown";
            await tx.saveMessage(message);
          }
        const first = messages[0];
        return {
          conversation,
          messages,
          hasMore: rows.length > 50,
          before:
            rows.length > 50 && first
              ? Buffer.from(
                  JSON.stringify({
                    createdAt: first.createdAt,
                    sequence: first.sequence,
                  })
                ).toString("base64url")
              : null,
          contact: conversation.contactId
            ? await tx.contact(conversation.contactId)
            : null,
        };
      }
    );
  }
  async ownership(
    merchantId: string,
    id: string,
    actor: string,
    action: "claim" | "release",
    version: number
  ) {
    await this.contacts.requirePlan(merchantId);
    return this.repository.transaction(
      merchantId,
      `conversation:${id}`,
      async (tx) => {
        const current = await tx.conversation(id);
        if (!current)
          throw new MarketingError("marketing_conversation_not_found", 404);
        if (current.channel === "unknown")
          throw new MarketingError("marketing_history_read_only", 409);
        if (current.mode === "human" && current.assignedUserId !== actor)
          throw new MarketingError("marketing_conversation_assigned", 409);
        if (action === "claim" && current.mode === "human") return current;
        if (current.version !== version)
          throw new MarketingError("marketing_conversation_changed", 409);
        const updated = {
          ...current,
          mode: action === "claim" ? ("human" as const) : ("ai" as const),
          assignedUserId: action === "claim" ? actor : null,
          version: current.version + 1,
          updatedAt: this.clock.now().toISOString(),
        };
        await tx.saveConversation(updated);
        await tx.appendMessage({
          id: randomUUID(),
          merchantId,
          conversationId: id,
          dedupKey: `ownership:${id}:${updated.version}`,
          role: "system",
          content:
            action === "claim"
              ? "Atendimento assumido por agente humano."
              : "Atendimento devolvido à IA.",
          authorId: actor,
          campaignId: null,
          status: "accepted",
          providerMessageId: null,
          createdAt: updated.updatedAt,
        });
        return updated;
      }
    );
  }
  async reply(
    merchantId: string,
    id: string,
    actor: string,
    text: string,
    key: string,
    expectedVersion: number
  ) {
    await this.contacts.requirePlan(merchantId);
    if (!text.trim() || text.length > 4000 || !key || key.length > 128)
      throw new MarketingError("marketing_message_invalid");
    const result = await this.outgoing(
      merchantId,
      id,
      `agent:${id}:${key}`,
      "agent",
      text.trim(),
      actor,
      expectedVersion,
      async (conversation, phone) => {
        if (conversation.channel === "site") return { status: "accepted" };
        if (!phone)
          return { status: "suppressed", reason: "contact_phone_missing" };
        return this.messaging.sendFreeform({
          merchantId,
          phone,
          deviceId: conversation.deviceId,
          text: text.trim(),
        });
      }
    );
    return { message: result.message!, conversation: result.conversation };
  }
  async aiReply(
    merchantId: string,
    id: string,
    key: string,
    text: string,
    deliver: () => Promise<{
      status: "accepted" | "unknown" | "failed";
      messageId?: string;
    }>
  ): Promise<boolean> {
    return (
      await this.outgoing(
        merchantId,
        id,
        `ai:${id}:${key}`,
        "ai",
        text,
        null,
        undefined,
        deliver
      )
    ).attempted;
  }
  async opening(
    merchantId: string,
    id: string,
    deliver: () => Promise<MerchantMarketingSendResult>
  ) {
    return (
      await this.outgoing(
        merchantId,
        id,
        `opening:${id}`,
        "system",
        MARKETING_CONSENT_TEXT,
        null,
        undefined,
        deliver
      )
    ).attempted;
  }

  /** Commit the send marker before I/O. A crash cannot roll it back and trigger a second send. */
  private async outgoing(
    merchantId: string,
    id: string,
    key: string,
    role: "agent" | "ai" | "system",
    text: string,
    actor: string | null,
    version: number | undefined,
    deliver: (
      conversation: MarketingConversation,
      phone?: string | null
    ) => Promise<MerchantMarketingSendResult>
  ) {
    const prepared = await this.repository.transaction(
      merchantId,
      `conversation:${id}`,
      async (tx) => {
        const conversation = await tx.conversation(id);
        if (!conversation)
          throw new MarketingError("marketing_conversation_not_found", 404);
        const previous = await tx.messageByKey(key);
        if (previous)
          return { message: previous, conversation, created: false };
        if (role === "agent") {
          if (
            conversation.mode !== "human" ||
            conversation.assignedUserId !== actor
          )
            throw new MarketingError("marketing_conversation_not_owned", 409);
          if (conversation.version !== version)
            throw new MarketingError("marketing_conversation_changed", 409);
        } else if (conversation.mode !== "ai")
          return { message: null, conversation, created: false };
        if (conversation.channel === "whatsapp")
          requireWhatsAppWindow(conversation.lastInboundAt, this.clock.now());
        const message: MarketingMessage = {
          id: randomUUID(),
          merchantId,
          conversationId: id,
          dedupKey: key,
          role,
          content: text,
          createdAt: this.clock.now().toISOString(),
          status: "sending",
          providerMessageId: null,
          authorId: actor,
          campaignId: null,
        };
        await tx.appendMessage(message);
        return { message, conversation, created: true };
      }
    );
    if (!prepared.created || !prepared.message)
      return { ...prepared, attempted: false };
    try {
      return await this.repository.transaction(
        merchantId,
        `conversation:${id}`,
        async (tx) => {
          const conversation = (await tx.conversation(id))!;
          const message = (await tx.messageByKey(key))!;
          const permitted =
            role === "agent"
              ? conversation.mode === "human" &&
                conversation.assignedUserId === actor &&
                conversation.version === version
              : conversation.mode === "ai";
          let result: MerchantMarketingSendResult = {
            status: "suppressed",
            reason: "conversation_ownership_changed",
          };
          if (permitted) {
            await this.contacts.requirePlan(merchantId);
            if (conversation.channel === "whatsapp")
              requireWhatsAppWindow(
                conversation.lastInboundAt,
                this.clock.now()
              );
            const contact = conversation.contactId
              ? await tx.contact(conversation.contactId)
              : null;
            try {
              result = await deliver(conversation, contact?.phone);
            } catch {
              result = { status: "unknown" };
            }
            if (
              conversation.channel === "whatsapp" &&
              result.status === "accepted" &&
              !result.messageId
            )
              result = { status: "unknown" };
          }
          message.status = result.status;
          message.providerMessageId = result.messageId ?? null;
          await tx.saveMessage(message);
          const updated = {
            ...conversation,
            updatedAt: message.createdAt,
            version: conversation.version + 1,
          };
          await tx.saveConversation(updated);
          return { message, conversation: updated, attempted: permitted };
        },
        { timeoutMs: 60000 }
      );
    } catch (error) {
      // The durable marker remains even if the final commit fails after provider acceptance.
      await this.repository.transaction(
        merchantId,
        `conversation:${id}`,
        async (tx) => {
          const message = await tx.messageByKey(key);
          if (message?.status === "sending")
            await tx.saveMessage({ ...message, status: "unknown" });
        }
      );
      throw error;
    }
  }
}
