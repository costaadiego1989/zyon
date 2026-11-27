import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { BuyerRelationshipReader } from "../../buyer-account/relationship.public-api.js";
import { CheckoutRelationshipReader } from "../../checkout/relationship.public-api.js";
import { WhatsAppRelationshipHistoryReader } from "../../whatsapp-channel/history.public-api.js";
import { CampaignConsentReader } from "../../campaign-consent/public-api.js";
import {
  MARKETING_REPOSITORY,
  type MarketingRepository,
} from "../domain/marketing.repository.js";
import {
  MARKETING_CLOCK,
  type MarketingClock,
} from "../domain/marketing-context.port.js";
import {
  MarketingError,
  requireMarketingApprover,
  marketingPhone,
  type MarketingHistoryJob,
  type MarketingHistoricalRelationship,
} from "../domain/marketing.js";
import { MarketingContactsService } from "./marketing-contacts.service.js";
import { marketingSuppressionHashes } from "./marketing-identity.js";
import { MarketingObservability } from "../infrastructure/marketing-observability.js";

const batchSize = 20;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function date(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
function messages(
  value: unknown,
  snapshotAt: string
): MarketingHistoricalRelationship["messages"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = record(item);
    const at = date(entry.createdAt ?? entry.occurredAt);
    const text = entry.content ?? entry.text;
    return at &&
      at <= snapshotAt &&
      typeof text === "string" &&
      text.trim() &&
      ["buyer", "agent"].includes(String(entry.role))
      ? [
          {
            role: entry.role === "buyer" ? ("buyer" as const) : ("ai" as const),
            content: text,
            occurredAt: at,
          },
        ]
      : [];
  });
}
function boundedDate(value: Date, snapshotAt: string) {
  return value.toISOString() < snapshotAt ? value.toISOString() : snapshotAt;
}

@Injectable()
export class MarketingLifecycleService {
  constructor(
    @Inject(MARKETING_REPOSITORY)
    private readonly repository: MarketingRepository,
    @Inject(MARKETING_CLOCK) private readonly clock: MarketingClock,
    private readonly contacts: MarketingContactsService,
    private readonly buyers: BuyerRelationshipReader,
    private readonly checkout: CheckoutRelationshipReader,
    private readonly whatsapp: WhatsAppRelationshipHistoryReader,
    private readonly consents: CampaignConsentReader,
    private readonly observability: MarketingObservability
  ) {}
  async status(merchantId: string) {
    await this.contacts.requirePlan(merchantId);
    return this.repository.transaction(merchantId, "history-job", (tx) =>
      tx.historyJob()
    );
  }
  async start(merchantId: string, role: string) {
    await this.contacts.requirePlan(merchantId);
    requireMarketingApprover(role);
    return this.repository.transaction(
      merchantId,
      "history-job",
      async (tx) => {
        const current = await tx.historyJob();
        if (current && ["queued", "running"].includes(current.status))
          return current;
        const at = this.clock.now().toISOString();
        const job: MarketingHistoryJob = {
          merchantId,
          status: "queued",
          phase: "whatsapp",
          cursor: null,
          snapshotAt: at,
          records: 0,
          messages: 0,
          leaseToken: null,
          leaseUntil: null,
          reason: null,
          updatedAt: at,
        };
        await tx.saveHistoryJob(job);
        return job;
      }
    );
  }
  async process(merchantId: string) {
    return this.observability.run("history", async () => {
      try {
        await this.contacts.requirePlan(merchantId);
      } catch (error) {
        if (
          error instanceof MarketingError &&
          error.code === "marketing_plan_required"
        )
          await this.repository.transaction(
            merchantId,
            "history-job",
            async (tx) => {
              const current = await tx.historyJob();
              if (current)
                await tx.saveHistoryJob({
                  ...current,
                  status: "failed",
                  reason: "plan_unavailable",
                  leaseToken: null,
                  leaseUntil: null,
                  updatedAt: this.clock.now().toISOString(),
                });
            }
          );
        throw error;
      }
      const claim = await this.repository.transaction(
        merchantId,
        "history-job",
        async (tx) => {
          const current = await tx.historyJob();
          const now = this.clock.now();
          if (
            !current ||
            !["queued", "running"].includes(current.status) ||
            (current.leaseUntil &&
              Date.parse(current.leaseUntil) > now.getTime())
          )
            return null;
          const job: MarketingHistoryJob = {
            ...current,
            status: "running",
            leaseToken: randomUUID(),
            leaseUntil: new Date(now.getTime() + 120000).toISOString(),
            updatedAt: now.toISOString(),
          };
          await tx.saveHistoryJob(job);
          return job;
        }
      );
      if (!claim) return;
      try {
        const result =
          claim.phase === "whatsapp"
            ? await this.importWhatsApp(claim)
            : claim.phase === "buyers"
            ? await this.importBuyers(claim)
            : await this.importOrders(claim);
        await this.repository.transaction(
          merchantId,
          "history-job",
          async (tx) => {
            const current = await tx.historyJob();
            if (current?.leaseToken !== claim.leaseToken) return;
            const next =
              claim.phase === "whatsapp"
                ? "buyers"
                : claim.phase === "buyers"
                ? "orders"
                : null;
            await tx.saveHistoryJob({
              ...current,
              status: result.done && !next ? "completed" : "running",
              phase: result.done && next ? next : current.phase,
              cursor: result.done ? null : result.cursor,
              records: current.records + result.records,
              messages: current.messages + result.messages,
              leaseToken: null,
              leaseUntil: null,
              updatedAt: this.clock.now().toISOString(),
            });
          }
        );
      } catch (error) {
        await this.repository.transaction(
          merchantId,
          "history-job",
          async (tx) => {
            const current = await tx.historyJob();
            if (current?.leaseToken === claim.leaseToken)
              await tx.saveHistoryJob({
                ...current,
                status: "failed",
                reason: "history_source_unavailable",
                leaseToken: null,
                leaseUntil: null,
                updatedAt: this.clock.now().toISOString(),
              });
          }
        );
        throw error;
      }
    });
  }
  private async keepHistory(
    merchantId: string,
    lastAt: string,
    accountId: string | null,
    phone: string | null,
    purchase: boolean
  ) {
    return this.repository.transaction(
      merchantId,
      "history-retention",
      async (tx) => {
        const settings = await tx.settings();
        if (!settings?.configured || purchase) return true;
        const cutoff = new Date(
          this.clock.now().getTime() - settings.retentionDays * 86400000
        ).toISOString();
        if (lastAt >= cutoff) return true;
        const existing = accountId
          ? await tx.contactByAccount(accountId)
          : phone
          ? await tx.contactByPhone(phone)
          : null;
        return (
          !!existing &&
          (existing.purchaseCount > 0 || existing.lastSeenAt >= cutoff)
        );
      }
    );
  }
  private async importWhatsApp(job: MarketingHistoryJob) {
    const rows = await this.whatsapp.page(
      job.merchantId,
      job.snapshotAt,
      job.cursor,
      batchSize
    );
    let imported = 0;
    for (const row of rows) {
      if (!row.checkoutSessionId) {
        const state=record(row.conversationState);
        const phone=marketingPhone(row.buyerPhone);
        const lastAt=boundedDate(row.lastActivityAt,job.snapshotAt);
        if (!row.deviceId.startsWith("META_CLOUD:") || state.version !== 1 || typeof state.conversationId !== "string" || !phone
          || !await this.keepHistory(job.merchantId,lastAt,null,phone,false)) continue;
        // Native transcripts do not date each turn. Preserve the proven contact
        // without inventing message timestamps or permission evidence.
        const result=await this.contacts.importRelationship({merchantId:job.merchantId,channel:"whatsapp",conversationKey:state.conversationId,
          verifiedPhone:phone,occurredAt:row.createdAt.toISOString(),lastSeenAt:lastAt,deviceId:row.deviceId,messages:[]});
        if (result) await this.importPermission(job.merchantId,result.contact.id,result.contact.accountId);
        continue;
      }
      const source = await this.checkout.historySession(
        job.merchantId,
        row.checkoutSessionId
      );
      if (!source) continue;
      const customer = record(source.customer);
      if (
        customer.phone_verified !== true ||
        typeof customer.phone !== "string"
      )
        continue;
      const phone = marketingPhone(row.buyerPhone);
      if (marketingPhone(customer.phone) !== phone) continue;
      const lastAt = boundedDate(row.lastActivityAt, job.snapshotAt);
      if (
        !(await this.keepHistory(
          job.merchantId,
          lastAt,
          null,
          phone,
          !!(await this.checkout.order(job.merchantId, row.checkoutSessionId))
        ))
      )
        continue;
      const result = await this.contacts.importRelationship({
        merchantId: job.merchantId,
        channel: "whatsapp",
        conversationKey: row.checkoutSessionId,
        verifiedPhone: phone,
        occurredAt: row.createdAt.toISOString(),
        lastSeenAt: lastAt,
        deviceId: row.deviceId,
        messages: messages(source.chatHistory, job.snapshotAt),
      });
      if (result) {
        imported += result.messages;
        await this.importPermission(
          job.merchantId,
          result.contact.id,
          result.contact.accountId
        );
      }
    }
    return {
      done: rows.length < batchSize,
      cursor: rows.at(-1)?.id ?? null,
      records: rows.length,
      messages: imported,
    };
  }
  private async importBuyers(job: MarketingHistoryJob) {
    const rows = await this.buyers.historyPage(
      job.merchantId,
      job.snapshotAt,
      job.cursor,
      batchSize
    );
    let imported = 0;
    for (const row of rows) {
      const buyer = await this.buyers.account(row.globalUserId);
      if (!buyer) continue;
      const wa = await this.whatsapp.forCheckout(job.merchantId, row.sessionId);
      const channel =
        wa &&
        buyer.verifiedPhone &&
        marketingPhone(buyer.verifiedPhone) === marketingPhone(wa.buyerPhone)
          ? "whatsapp"
          : row.sessionId.startsWith("conv_")
          ? "site"
          : "unknown";
      const lastAt = boundedDate(row.lastMessageAt, job.snapshotAt);
      if (
        !(await this.keepHistory(
          job.merchantId,
          lastAt,
          buyer.id,
          null,
          await this.checkout.hasAccountPurchase(job.merchantId, buyer.id)
        ))
      )
        continue;
      const result = await this.contacts.importRelationship({
        merchantId: job.merchantId,
        channel,
        conversationKey: row.sessionId,
        accountId: buyer.id,
        ...(channel === "whatsapp" && wa
          ? { verifiedPhone: wa.buyerPhone, deviceId: wa.deviceId }
          : {}),
        occurredAt: row.startedAt.toISOString(),
        lastSeenAt: lastAt,
        messages: messages(row.messages, job.snapshotAt),
      });
      if (result) {
        imported += result.messages;
        await this.importPermission(
          job.merchantId,
          result.contact.id,
          buyer.id
        );
      }
    }
    return {
      done: rows.length < batchSize,
      cursor: rows.at(-1)?.id ?? null,
      records: rows.length,
      messages: imported,
    };
  }
  private async importOrders(job: MarketingHistoryJob) {
    const rows = await this.checkout.historyOrdersPage(
      job.merchantId,
      job.snapshotAt,
      job.cursor,
      batchSize
    );
    for (const row of rows) {
      if (!Number.isSafeInteger(row.amountCents) || row.amountCents < 0)
        continue;
      const buyer = await this.buyers.account(row.session.globalUserId);
      const wa = await this.whatsapp.forCheckout(job.merchantId, row.sessionId);
      const customer = record(row.session.customer);
      const phone =
        wa &&
        customer.phone_verified === true &&
        typeof customer.phone === "string" &&
        marketingPhone(customer.phone) === marketingPhone(wa.buyerPhone)
          ? marketingPhone(wa.buyerPhone)
          : null;
      if (!buyer && !phone) continue;
      const channel = phone ? "whatsapp" : "unknown";
      const result = await this.contacts.importRelationship({
        merchantId: job.merchantId,
        channel,
        conversationKey: row.sessionId,
        ...(phone
          ? { verifiedPhone: phone, deviceId: wa!.deviceId }
          : buyer
          ? { accountId: buyer.id }
          : {}),
        occurredAt: row.session.createdAt.toISOString(),
        lastSeenAt: row.completedAt.toISOString(),
        messages: [],
      });
      if (result) {
        await this.contacts.recordPurchase(
          job.merchantId,
          result.contact.id,
          row.id,
          row.amountCents,
          row.completedAt.toISOString()
        );
        await this.importPermission(
          job.merchantId,
          result.contact.id,
          result.contact.accountId
        );
      }
    }
    return {
      done: rows.length < batchSize,
      cursor: rows.at(-1)?.id ?? null,
      records: rows.length,
      messages: 0,
    };
  }
  private async importPermission(
    merchantId: string,
    contactId: string,
    accountId: string | null
  ) {
    if (!accountId) return;
    const row = await this.consents.permission(merchantId, accountId);
    if (!row) return;
    const proof = record(row.evidence);
    const decided = date(proof.decidedAt);
    const recorded = date(proof.recordedAt);
    const revoked = row.status === "revoked" && row.revokedAt;
    const granted =
      row.status === "granted" &&
      row.grantedAt &&
      !row.revokedAt &&
      row.source === "storefront_consent" &&
      row.policyVersion === "storefront_privacy_2026_10_05" &&
      decided &&
      recorded;
    if (!revoked && !granted) return;
    await this.contacts.importConsent(merchantId, contactId, {
      status: revoked ? "revoked" : "granted",
      version: row.policyVersion,
      source: `historical:${row.source}`,
      recordedAt: (revoked ? row.revokedAt! : row.grantedAt!).toISOString(),
      evidenceId: `legacy:${createHash("sha256")
        .update(
          JSON.stringify([merchantId, accountId, row.channel, row.purpose])
        )
        .digest("hex")}`,
    });
  }
  async retentionPreview(merchantId: string) {
    await this.contacts.requirePlan(merchantId);
    return this.repository.transaction(merchantId, "retention", async (tx) => {
      const settings = await tx.settings();
      if (!settings?.configured)
        throw new MarketingError("marketing_settings_required", 409);
      const before = new Date(
        this.clock.now().getTime() - settings.retentionDays * 86400000
      ).toISOString();
      return { eligible: await tx.retentionCount(before), before };
    });
  }
  async retain(merchantId: string) {
    return this.observability.run("retention", () =>
      this.repository.transaction(merchantId, "identities", async (tx) => {
        const job = await tx.historyJob();
        if (job && ["running", "queued"].includes(job.status))
          return { removed: 0, busy: true };
        const settings = await tx.settings();
        if (!settings?.configured) return { removed: 0, busy: false };
        const before = new Date(
          this.clock.now().getTime() - settings.retentionDays * 86400000
        ).toISOString();
        const contacts = await tx.retentionCandidates(before, 50);
        for (const contact of contacts) {
          const consent = await tx.consent(contact.id);
          if (consent && consent.status !== "granted")
            for (const hash of marketingSuppressionHashes(
              merchantId,
              contact.phone,
              contact.accountId
            ))
              await tx.saveSuppression(hash, {
                status: consent.status,
                recordedAt: consent.recordedAt,
                version: consent.version,
                evidenceHash: createHash("sha256")
                  .update(consent.evidenceId)
                  .digest("hex"),
              });
          await tx.removeRelationship(contact.id);
        }
        if (contacts.length < 50)
          await tx.saveSettings({
            ...settings,
            retentionLastRunAt: this.clock.now().toISOString(),
          });
        return { removed: contacts.length, busy: false };
      })
    );
  }
}
