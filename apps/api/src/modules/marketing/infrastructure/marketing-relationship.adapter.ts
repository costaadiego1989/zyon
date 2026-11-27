import { Inject, Injectable } from "@nestjs/common";
import type {
  MarketingInboundMessage,
  MarketingRelationshipPort,
} from "../../../shared/contracts/marketing.js";
import {
  MARKETING_REPOSITORY,
  type MarketingRepository,
} from "../domain/marketing.repository.js";
import {
  MARKETING_CLOCK,
  type MarketingClock,
} from "../domain/marketing-context.port.js";
import { MarketingContactsService } from "../application/marketing-contacts.service.js";
import { MarketingConversationsService } from "../application/marketing-conversations.service.js";
import { MarketingEventsHandler } from "./marketing-events.handler.js";
import { MarketingObservability } from "./marketing-observability.js";
@Injectable()
export class MarketingRelationshipAdapter implements MarketingRelationshipPort {
  constructor(
    private readonly contacts: MarketingContactsService,
    private readonly conversations: MarketingConversationsService,
    private readonly events: MarketingEventsHandler,
    private readonly observability: MarketingObservability,
    @Inject(MARKETING_REPOSITORY)
    private readonly repository: MarketingRepository,
    @Inject(MARKETING_CLOCK) private readonly clock: MarketingClock
  ) {}
  enabled(id: string) {
    return this.contacts.enabled(id);
  }
  async inbound(input: MarketingInboundMessage) {
    return this.observability.run("inbound", async () => {
      const decision = await this.contacts.inbound(input);
      if (
        decision.contactId &&
        !decision.human &&
        !decision.openingRequired &&
        !input.historical
      ) {
        // Classification failure must not discard the accepted message or prevent
        // service. The observer records failure; the next message can be classified.
        await this.events
          .classify(
            input.merchantId,
            decision.conversationId,
            decision.contactId,
            decision.originalQuestion,
            input.messageId
          )
          .catch(() => {});
      }
      return decision;
    });
  }
  aiReply(...args: Parameters<MarketingRelationshipPort["aiReply"]>) {
    return this.observability.run("reply", () =>
      this.conversations.aiReply(...args)
    );
  }
  opening(...args: Parameters<MarketingRelationshipPort["opening"]>) {
    return this.observability.run("reply", () =>
      this.conversations.opening(...args)
    );
  }
  async delivery(
    merchantId: string,
    id: string,
    status: "accepted" | "delivered" | "read" | "failed"
  ) {
    await this.observability.run("delivery", () =>
      this.repository.transaction(merchantId, "delivery", (tx) =>
        tx.updateDelivery(id, status)
      )
    );
  }
  permission(...args: Parameters<MarketingRelationshipPort["permission"]>) {
    return this.contacts.permission(...args);
  }
  async reserveCommercial(merchantId: string, accountId: string, key: string) {
    return this.observability.run("dispatch", () =>
      this.contacts.reserveCommercial(merchantId, accountId, key)
    );
  }
  async identified(
    merchantId: string,
    accountId: string,
    conversationKey?: string
  ) {
    if (await this.enabled(merchantId))
      await this.observability.run("identity", () =>
        this.contacts.identify(
          merchantId,
          accountId,
          "site",
          undefined,
          conversationKey
        )
      );
  }
  async conversationState(
    merchantId: string,
    channel: "site" | "whatsapp",
    key: string
  ) {
    return this.repository.transaction(merchantId, "state-read", async (tx) => {
      const c = await tx.conversationByExternal(channel, key);
      return c ? { mode: c.mode } : null;
    });
  }
  async commerce(merchantId: string, key: string) {
    await this.events.projectSession(merchantId, key);
  }
  async history(merchantId: string, channel: "site" | "whatsapp", key: string) {
    return this.repository.transaction(
      merchantId,
      "history-read",
      async (tx) => {
        const conversation = await tx.conversationByExternal(channel, key);
        if (!conversation) return null;
        return (await tx.messages(conversation.id)).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          status: m.status,
          ...(channel === "site" && (m.role === "buyer" || m.role === "ai")
            ? { requestId: m.dedupKey.slice(m.dedupKey.lastIndexOf(":") + 1) }
            : {}),
        }));
      }
    );
  }
}
