import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type {
  MarketingInboundMessage,
  MarketingInboundDecision,
} from "../../../shared/contracts/marketing.js";
import {
  MARKETING_REPOSITORY,
  type MarketingRepository,
  type MarketingTransaction,
} from "../domain/marketing.repository.js";
import {
  MARKETING_CONTEXT,
  MARKETING_CLOCK,
  type MarketingContext,
  type MarketingClock,
  type MarketingBuyer,
} from "../domain/marketing-context.port.js";
import { marketingSuppressionHashes } from "./marketing-identity.js";
import { conversationHistoryText } from "../../../shared/privacy/conversation-history-text.js";
import {
  MARKETING_ACCEPT,
  MARKETING_DECLINE,
  MARKETING_CONSENT_TEXT,
  MARKETING_CONSENT_VERSION,
  MARKETING_STAGES,
  MarketingError,
  marketingPhone,
  canMarketingAiMove,
  requireMarketingPlan,
  marketingConsentGranted,
  type MarketingContact,
  type MarketingConversation,
  type MarketingConsent,
  type MarketingStage,
  type MarketingContactQuery,
  type MarketingChannel,
  type MarketingOrigin,
  type MarketingHistoricalRelationship,
} from "../domain/marketing.js";

@Injectable()
export class MarketingContactsService {
  constructor(
    @Inject(MARKETING_REPOSITORY)
    private readonly repository: MarketingRepository,
    @Inject(MARKETING_CONTEXT) private readonly context: MarketingContext,
    @Inject(MARKETING_CLOCK) private readonly clock: MarketingClock
  ) {}

  async enabled(merchantId: string): Promise<boolean> {
    try {
      requireMarketingPlan(await this.context.plan(merchantId));
      return true;
    } catch {
      return false;
    }
  }
  async requirePlan(merchantId: string) {
    requireMarketingPlan(await this.context.plan(merchantId));
  }
  async access(merchantId: string) {
    return {
      enabled: ["growth", "scale"].includes(
        await this.context.plan(merchantId)
      ),
      minimumPlan: "growth" as const,
    };
  }

  async inbound(
    input: MarketingInboundMessage
  ): Promise<MarketingInboundDecision> {
    if (
      !input.text.trim() ||
      input.text.length > 8000 ||
      !input.messageId ||
      input.messageId.length > 512 ||
      !input.conversationKey ||
      input.conversationKey.length > 512 ||
      !Number.isFinite(Date.parse(input.receivedAt))
    )
      throw new MarketingError("marketing_inbound_invalid");
    const phone =
      input.channel === "whatsapp" && input.verifiedPhone
        ? marketingPhone(input.verifiedPhone)
        : null;
    if (input.channel === "whatsapp" && !phone)
      throw new MarketingError("marketing_verified_phone_required");
    const buyer = input.accountId
      ? await this.context.buyer(input.accountId)
      : phone
      ? await this.context.verifiedAccount(phone)
      : null;
    if (input.accountId && !buyer)
      throw new MarketingError("marketing_buyer_not_found", 404);
    return this.repository.transaction(
      input.merchantId,
      "identities",
      async (tx) => {
        const contact = await this.resolveIdentity(
          tx,
          input.merchantId,
          input.channel,
          input.historical ? "unknown" : input.channel,
          phone,
          buyer,
          input.receivedAt
        );
        let conversation = await tx.conversationByExternal(
          input.channel,
          input.conversationKey
        );
        if (!conversation) {
          conversation = {
            id: randomUUID(),
            merchantId: input.merchantId,
            channel: input.channel,
            externalId: input.conversationKey,
            contactId: contact?.id ?? null,
            mode: "ai",
            assignedUserId: null,
            version: 0,
            lastInboundAt: input.receivedAt,
            updatedAt: input.receivedAt,
            deviceId: input.deviceId ?? null,
            openingChoice: "pending",
            pendingQuestion: null,
          };
        } else {
          if (
            input.channel === "site" &&
            conversation.contactId &&
            contact &&
            conversation.contactId !== contact.id
          )
            throw new MarketingError(
              "marketing_conversation_identity_changed",
              409
            );
          conversation = {
            ...conversation,
            contactId: contact?.id ?? conversation.contactId,
            lastInboundAt: new Date(
              Math.max(
                Date.parse(conversation.lastInboundAt),
                Date.parse(input.receivedAt)
              )
            ).toISOString(),
            updatedAt: this.clock.now().toISOString(),
            version: conversation.version + 1,
          };
        }
        let consent = contact ? await tx.consent(contact.id) : null;
        if (contact && !consent) {
          const suppression = await tx.suppression(
            marketingSuppressionHashes(
              input.merchantId,
              contact.phone,
              contact.accountId
            )
          );
          if (suppression) {
            consent = {
              id: randomUUID(),
              merchantId: input.merchantId,
              contactId: contact.id,
              channel: "whatsapp",
              status: suppression.status,
              recordedAt: suppression.recordedAt,
              version: suppression.version,
              text: "Registro mínimo de descadastro anterior",
              source: "retention_suppression",
              evidenceId: suppression.evidenceHash,
            };
            await tx.saveConsent(consent);
          }
        }
        const previousMessage = await tx.messageByKey(
          `${input.channel}:${input.messageId}`
        );
        if (previousMessage)
          return {
            conversationId: conversation.id,
            contactId: conversation.contactId,
            human: conversation.mode === "human",
            openingRequired:
              !input.historical &&
              input.channel === "whatsapp" &&
              conversation.openingChoice === "pending",
            originalQuestion:
              previousMessage.serviceQuestion ?? previousMessage.content,
            responseKey: previousMessage.responseKey ?? input.messageId,
            duplicate: true,
          };
        if (consent)
          conversation.openingChoice =
            consent.status === "granted" ? "granted" : "declined";
        const normalized = input.text.trim().toLocaleLowerCase("pt-BR");
        const suppliedDecision =
          input.consentChoice ??
          ([MARKETING_ACCEPT, "quero receber"].includes(normalized)
            ? "granted"
            : [MARKETING_DECLINE, "agora não"].includes(normalized)
            ? "declined"
            : null);
        // A cached site choice cannot replace a later revocation or restamp old
        // consent on each buyer message. Only the first opening supplies it.
        const decision =
          input.channel === "site" &&
          (consent || conversation.openingChoice !== "pending")
            ? null
            : suppliedDecision;
        const optOut =
          input.channel === "whatsapp" &&
          ["parar", "sair", "não quero receber promoções"].includes(normalized);
        let originalQuestion = input.text;
        let responseKey = input.messageId;
        if (optOut && contact && !input.historical) {
          const recorded = await this.recordConsent(
            tx,
            contact,
            "revoked",
            "whatsapp_buyer_opt_out",
            input.messageId,
            input.receivedAt
          );
          conversation.openingChoice =
            recorded.status === "granted" ? "granted" : "declined";
        } else if (decision) {
          conversation.openingChoice = decision;
          if (contact?.phone && !input.historical) {
            const recorded = await this.recordConsent(
              tx,
              contact,
              decision,
              input.channel,
              input.messageId,
              input.receivedAt
            );
            conversation.openingChoice =
              recorded.status === "granted" ? "granted" : "declined";
          }
          if (conversation.pendingQuestion) {
            originalQuestion = conversation.pendingQuestion;
            responseKey = conversation.pendingQuestionId ?? input.messageId;
            conversation.pendingQuestion = null;
            conversation.pendingQuestionId = null;
          } else if (
            input.text === MARKETING_ACCEPT ||
            input.text === MARKETING_DECLINE
          )
            originalQuestion = "Continuar atendimento";
        } else if (
          conversation.openingChoice !== "pending" &&
          contact?.phone &&
          !consent &&
          !input.historical
        ) {
          // A site visitor's previous opening choice becomes personal only now,
          // after account and channel identity have been established by the caller.
          await this.recordConsent(
            tx,
            contact,
            conversation.openingChoice,
            "site",
            input.messageId,
            input.receivedAt
          );
        }
        const openingRequired =
          !input.historical &&
          input.channel === "whatsapp" &&
          conversation.openingChoice === "pending";
        if (openingRequired && !conversation.pendingQuestion) {
          conversation.pendingQuestion = input.text;
          conversation.pendingQuestionId = input.messageId;
        }
        await tx.saveConversation(conversation);
        const inserted = await tx.appendMessage({
          id: randomUUID(),
          merchantId: input.merchantId,
          conversationId: conversation.id,
          dedupKey: `${input.channel}:${input.messageId}`,
          role: "buyer",
          content: input.text,
          createdAt: input.receivedAt,
          status: "accepted",
          providerMessageId:
            input.channel === "whatsapp" ? input.messageId : null,
          authorId: contact?.accountId ?? null,
          campaignId: null,
          serviceQuestion: originalQuestion,
          responseKey,
        });
        return {
          conversationId: conversation.id,
          contactId: contact?.id ?? null,
          human: conversation.mode === "human",
          openingRequired,
          originalQuestion,
          responseKey,
          optedOut: optOut,
          duplicate: !inserted,
        };
      }
    );
  }

  private phoneKey(phone: string) {
    return `phone:${createHash("sha256").update(phone).digest("hex")}`;
  }
  private async resolveIdentity(
    tx: MarketingTransaction,
    merchantId: string,
    channel: MarketingChannel | null,
    origin: MarketingOrigin,
    phone: string | null,
    buyer: MarketingBuyer | null,
    at: string
  ) {
    if (!phone && !buyer) return null;
    const identityKey = buyer ? `account:${buyer.id}` : this.phoneKey(phone!);
    let contact = buyer
      ? await tx.contactByAccount(buyer.id)
      : await tx.contactByPhone(phone!);
    const verifiedPhone = buyer?.verifiedPhone
      ? marketingPhone(buyer.verifiedPhone)
      : null;
    const linked = verifiedPhone
      ? await tx.contactByPhone(verifiedPhone)
      : null;
    if (contact && linked && contact.id !== linked.id) {
      await tx.mergeContacts(contact.id, linked.id);
      contact = await tx.contact(linked.id);
    }
    contact ??= linked ?? (await tx.contactByIdentity(identityKey));
    const value: MarketingContact = contact
      ? {
          ...contact,
          accountId: buyer?.id ?? contact.accountId,
          name: buyer?.name ?? contact.name,
          email: buyer?.email ?? contact.email,
          phone: phone ?? verifiedPhone ?? contact.phone,
          channels: [
            ...new Set([...contact.channels, ...(channel ? [channel] : [])]),
          ],
          origin:
            origin !== "unknown" &&
            (contact.origin === "unknown" || at < contact.firstSeenAt)
              ? origin
              : contact.origin,
          firstSeenAt: at < contact.firstSeenAt ? at : contact.firstSeenAt,
          lastSeenAt: at > contact.lastSeenAt ? at : contact.lastSeenAt,
          version: contact.version + 1,
        }
      : {
          id: randomUUID(),
          merchantId,
          identityKey,
          accountId: buyer?.id ?? null,
          name: buyer?.name ?? null,
          email: buyer?.email ?? null,
          phone: phone ?? verifiedPhone,
          origin,
          channels: channel ? [channel] : [],
          stage: "new",
          stageAt: at,
          firstSeenAt: at,
          lastSeenAt: at,
          version: 0,
          purchaseCount: 0,
          totalSpentCents: 0,
          lastPurchaseAt: null,
          interests: [],
        };
    await tx.saveContact(value);
    return value;
  }
  /** Source readers prove scope/identity. Import never asks consent or performs an outbound call. */
  async importRelationship(input: MarketingHistoricalRelationship) {
    const buyer = input.accountId
      ? await this.context.buyer(input.accountId)
      : input.verifiedPhone
      ? await this.context.verifiedAccount(marketingPhone(input.verifiedPhone))
      : null;
    const phone =
      input.channel === "whatsapp" && input.verifiedPhone
        ? marketingPhone(input.verifiedPhone)
        : null;
    if ((input.channel === "whatsapp" && !phone) || (input.accountId && !buyer))
      return null;
    if (
      phone &&
      input.accountId &&
      (!buyer?.verifiedPhone || marketingPhone(buyer.verifiedPhone) !== phone)
    )
      throw new MarketingError("marketing_history_identity_unproven");
    return this.repository.transaction(
      input.merchantId,
      "identities",
      async (tx) => {
        let contact = await this.resolveIdentity(
          tx,
          input.merchantId,
          input.channel === "unknown" ? null : input.channel,
          input.channel,
          phone,
          buyer,
          input.occurredAt
        );
        if (!contact) return null;
        if (input.lastSeenAt > contact.lastSeenAt) {
          contact = { ...contact, lastSeenAt: input.lastSeenAt };
          await tx.saveContact(contact);
        }
        let conversation = await tx.conversationByExternal(
          input.channel,
          input.conversationKey
        );
        if (
          conversation &&
          conversation.contactId &&
          conversation.contactId !== contact.id
        )
          throw new MarketingError("marketing_history_identity_unproven");
        if (!conversation) {
          conversation = {
            id: randomUUID(),
            merchantId: input.merchantId,
            channel: input.channel,
            externalId: input.conversationKey,
            contactId: contact.id,
            mode: "ai",
            assignedUserId: null,
            version: 0,
            lastInboundAt: input.occurredAt,
            updatedAt: input.lastSeenAt,
            deviceId: input.deviceId ?? null,
            openingChoice: "pending",
            pendingQuestion: null,
          };
          await tx.saveConversation(conversation);
        }
        const boundary = await tx.liveMessageBoundary(conversation.id);
        const messages = input.messages
          .filter((message) => !boundary || message.occurredAt < boundary)
          .map((message) => ({
            id: randomUUID(),
            merchantId: input.merchantId,
            conversationId: conversation!.id,
            dedupKey: `historical:${createHash("sha256")
              .update(
                JSON.stringify([
                  input.channel,
                  input.conversationKey,
                  message.role,
                  message.occurredAt,
                  message.content,
                ])
              )
              .digest("hex")}`,
            role: message.role,
            content: conversationHistoryText(
              message.content,
              message.role === "buyer" ? 4000 : 8000
            ),
            createdAt: message.occurredAt,
            status: "recorded" as const,
            providerMessageId: null,
            authorId: null,
            campaignId: null,
          }));
        return {
          contact,
          messages: await tx.appendMessages(messages),
          conversationId: conversation.id,
        };
      }
    );
  }
  async importConsent(
    merchantId: string,
    contactId: string,
    proof: {
      status: "granted" | "revoked";
      version: string;
      source: string;
      recordedAt: string;
      evidenceId: string;
    }
  ) {
    return this.repository.transaction(
      merchantId,
      `contact:${contactId}`,
      async (tx) => {
        const contact = await tx.contact(contactId);
        if (!contact) return;
        // A grant for an account without a verified WhatsApp number cannot enroll a phone.
        if (proof.status === "granted" && !contact.phone) return;
        const suppression = await tx.suppression(
          marketingSuppressionHashes(
            merchantId,
            contact.phone,
            contact.accountId
          )
        );
        if (suppression && suppression.recordedAt >= proof.recordedAt) return;
        const previous = await tx.consent(contactId);
        if (previous && previous.recordedAt >= proof.recordedAt) return;
        await tx.saveConsent({
          id: previous?.id ?? randomUUID(),
          merchantId,
          contactId,
          channel: "whatsapp",
          status: proof.status,
          version: proof.version,
          source: proof.source,
          text: `Autorização histórica referenciada pela política ${proof.version}`,
          recordedAt: proof.recordedAt,
          evidenceId: proof.evidenceId,
        });
      }
    );
  }
  async identify(
    merchantId: string,
    accountId: string,
    origin: "site" | "unknown" = "site",
    at = this.clock.now().toISOString(),
    conversationKey?: string
  ) {
    const buyer = await this.context.buyer(accountId);
    if (!buyer) throw new MarketingError("marketing_buyer_not_found", 404);
    return this.repository.transaction(merchantId, "identities", async (tx) => {
      const updated = (await this.resolveIdentity(
        tx,
        merchantId,
        origin === "site" ? "site" : null,
        origin,
        null,
        buyer,
        at
      ))!;
      const suppression = await tx.suppression(
        marketingSuppressionHashes(merchantId, updated.phone, updated.accountId)
      );
      if (suppression && !(await tx.consent(updated.id)))
        await tx.saveConsent({
          id: randomUUID(),
          merchantId,
          contactId: updated.id,
          channel: "whatsapp",
          status: suppression.status,
          recordedAt: suppression.recordedAt,
          version: suppression.version,
          text: "Registro mínimo de descadastro anterior",
          source: "retention_suppression",
          evidenceId: suppression.evidenceHash,
        });
      if (conversationKey) {
        const conversation = await tx.conversationByExternal(
          "site",
          conversationKey
        );
        if (conversation) {
          if (conversation.contactId && conversation.contactId !== updated.id)
            throw new MarketingError(
              "marketing_conversation_identity_changed",
              409
            );
          await tx.saveConversation({
            ...conversation,
            contactId: updated.id,
            version: conversation.version + 1,
          });
          if (
            updated.phone &&
            conversation.openingChoice !== "pending" &&
            !(await tx.consent(updated.id))
          )
            await this.recordConsent(
              tx,
              updated,
              conversation.openingChoice,
              "site_session",
              `identity:${conversation.id}`,
              at
            );
        }
      }
      return updated;
    });
  }
  private async recordConsent(
    tx: MarketingTransaction,
    c: MarketingContact,
    status: "granted" | "declined" | "revoked",
    source: string,
    evidenceId: string,
    at: string
  ) {
    const previous = await tx.consent(c.id);
    if (
      previous &&
      (previous.recordedAt > at ||
        (previous.recordedAt === at &&
          previous.status !== "granted" &&
          status === "granted"))
    )
      return previous;
    const consent: MarketingConsent = {
      id: previous?.id ?? randomUUID(),
      merchantId: c.merchantId,
      contactId: c.id,
      channel: "whatsapp",
      status,
      version: MARKETING_CONSENT_VERSION,
      text: MARKETING_CONSENT_TEXT,
      source,
      recordedAt: at,
      evidenceId,
    };
    await tx.saveConsent(consent);
    return consent;
  }

  async revoke(merchantId: string, contactId: string, evidenceId: string) {
    await this.repository.transaction(
      merchantId,
      `contact:${contactId}`,
      async (tx) => {
        const contact = await tx.contact(contactId);
        if (!contact)
          throw new MarketingError("marketing_contact_not_found", 404);
        await this.recordConsent(
          tx,
          contact,
          "revoked",
          evidenceId.startsWith("agent:")
            ? "merchant_recorded_opt_out"
            : "buyer_opt_out",
          evidenceId,
          this.clock.now().toISOString()
        );
      }
    );
  }
  async permission(
    merchantId: string,
    accountId: string,
    channel: "email" | "whatsapp"
  ): Promise<boolean | null> {
    if (channel !== "whatsapp") return null;
    const buyer = await this.context.buyer(accountId);
    return this.repository.transaction(merchantId, "permission", async (tx) => {
      const contact =
        (await tx.contactByAccount(accountId)) ??
        (buyer?.verifiedPhone
          ? await tx.contactByPhone(marketingPhone(buyer.verifiedPhone))
          : null);
      if (!contact) return null;
      const consent = await tx.consent(contact.id);
      if (!consent) return null;
      return (
        marketingConsentGranted(consent) &&
        !(await this.context.blockedByPreference(
          accountId,
          consent.recordedAt,
          merchantId
        ))
      );
    });
  }
  async reserveCommercial(
    merchantId: string,
    accountId: string,
    dispatchKey: string
  ) {
    const buyer = await this.context.buyer(accountId);
    return this.repository.transaction(merchantId, "frequency", async (tx) => {
      const contact =
        (await tx.contactByAccount(accountId)) ??
        (buyer?.verifiedPhone
          ? await tx.contactByPhone(marketingPhone(buyer.verifiedPhone))
          : null);
      const settings = await tx.settings();
      if (!contact || !settings?.configured) return true;
      return tx.reserveCommercial(
        contact.identityKey,
        dispatchKey,
        this.clock.now().toISOString(),
        settings.minIntervalHours,
        settings.maxMessagesPerDay
      );
    });
  }
  async list(merchantId: string, query: MarketingContactQuery) {
    await this.requirePlan(merchantId);
    if (
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      !Number.isInteger(query.offset) ||
      query.offset < 0 ||
      (query.search?.length ?? 0) > 200
    )
      throw new MarketingError("marketing_query_invalid");
    return this.repository.transaction(merchantId, "read", (tx) =>
      tx.contacts(query)
    );
  }
  async detail(merchantId: string, id: string) {
    await this.requirePlan(merchantId);
    return this.repository.transaction(
      merchantId,
      `contact:${id}`,
      async (tx) => {
        const contact = await tx.contact(id);
        if (!contact)
          throw new MarketingError("marketing_contact_not_found", 404);
        return {
          contact,
          consent: await tx.consent(id),
          history: await tx.stageHistory(id),
          activity: await tx.contactActivity(id),
          timeInStageMs: Math.max(
            0,
            this.clock.now().getTime() - Date.parse(contact.stageAt)
          ),
        };
      }
    );
  }
  async funnel(merchantId: string) {
    await this.requirePlan(merchantId);
    const rows = await this.repository.transaction(merchantId, "funnel", (tx) =>
      tx.funnel()
    );
    return { total: rows.reduce((sum, row) => sum + row.total, 0), rows };
  }
  async move(
    merchantId: string,
    id: string,
    next: MarketingStage,
    reason: string,
    actor: string,
    expectedVersion: number,
    author: "agent" | "ai" | "business" = "agent"
  ) {
    if (
      !MARKETING_STAGES.includes(next) ||
      !reason.trim() ||
      reason.length > 500
    )
      throw new MarketingError("marketing_stage_invalid");
    return this.repository.transaction(
      merchantId,
      `contact:${id}`,
      async (tx) => {
        const contact = await tx.contact(id);
        if (!contact)
          throw new MarketingError("marketing_contact_not_found", 404);
        if (contact.version !== expectedVersion)
          throw new MarketingError("marketing_contact_changed", 409);
        if (author === "ai" && !canMarketingAiMove(contact, next))
          return contact;
        if (next === "purchased" && author !== "business")
          throw new MarketingError(
            "marketing_purchase_confirmation_required",
            409
          );
        if (contact.stage === next) return contact;
        const now = this.clock.now().toISOString();
        await tx.appendStage({
          id: randomUUID(),
          merchantId,
          contactId: id,
          from: contact.stage,
          to: next,
          author,
          authorId: actor,
          reason,
          occurredAt: now,
        });
        const updated = {
          ...contact,
          stage: next,
          stageAt: now,
          version: contact.version + 1,
        };
        await tx.saveContact(updated);
        return updated;
      }
    );
  }
  async recordPurchase(
    merchantId: string,
    contactId: string,
    orderId: string,
    amountCents: number,
    occurredAt: string
  ) {
    if (
      !Number.isSafeInteger(amountCents) ||
      amountCents < 0 ||
      !Number.isFinite(Date.parse(occurredAt))
    )
      throw new MarketingError("marketing_purchase_invalid");
    return this.repository.transaction(
      merchantId,
      `contact:${contactId}`,
      async (tx) => {
        const contact = await tx.contact(contactId);
        if (!contact)
          throw new MarketingError("marketing_contact_not_found", 404);
        if (!(await tx.purchase(orderId, contactId, amountCents, occurredAt)))
          return contact;
        if (!Number.isSafeInteger(contact.totalSpentCents + amountCents))
          throw new MarketingError("marketing_purchase_total_invalid");
        const advance = occurredAt >= contact.stageAt;
        if (advance)
          await tx.appendStage({
            id: randomUUID(),
            merchantId,
            contactId,
            from: contact.stage,
            to: "purchased",
            author: "business",
            authorId: orderId,
            reason: "confirmed_purchase",
            occurredAt,
          });
        const updated: MarketingContact = {
          ...contact,
          stage: advance ? "purchased" : contact.stage,
          stageAt: advance ? occurredAt : contact.stageAt,
          purchaseCount: contact.purchaseCount + 1,
          totalSpentCents: contact.totalSpentCents + amountCents,
          lastPurchaseAt:
            !contact.lastPurchaseAt || occurredAt > contact.lastPurchaseAt
              ? occurredAt
              : contact.lastPurchaseAt,
          version: contact.version + 1,
        };
        await tx.saveContact(updated);
        return updated;
      }
    );
  }
}
