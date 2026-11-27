import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
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
  MARKETING_CONTEXT,
  MARKETING_CLOCK,
  type MarketingContext,
  type MarketingClock,
} from "../domain/marketing-context.port.js";
import {
  marketingConsentGranted,
  withinMarketingHours,
  type MarketingConversation,
  type MarketingRecipient,
  type MarketingMessage,
} from "../domain/marketing.js";
import { MarketingObservability } from "./marketing-observability.js";

@Injectable()
export class MarketingCampaignWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    @Inject(MARKETING_REPOSITORY)
    private readonly repository: MarketingRepository,
    @Inject(MARKETING_CONTEXT) private readonly context: MarketingContext,
    @Inject(MERCHANT_MARKETING_MESSAGING)
    private readonly messaging: MerchantMarketingMessaging,
    @Inject(MARKETING_CLOCK) private readonly clock: MarketingClock,
    private readonly observability: MarketingObservability
  ) {}
  onModuleInit() {
    if (process.env.MARKETING_CAMPAIGN_WORKER_ENABLED !== "true") return;
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => {});
    }, 15_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async runOnce() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.observability.run("dispatch_scan", async () => {
        for (const c of await this.repository.dueCampaigns(
          this.clock.now(),
          20
        ))
          await this.runCampaign(c.merchantId, c.id);
      });
    } finally {
      this.busy = false;
    }
  }
  async runCampaign(merchantId: string, id: string) {
    return this.observability.run("dispatch", async () => {
      const plan = await this.context.plan(merchantId);
      if (!["growth", "scale"].includes(plan)) {
        await this.repository.transaction(
          merchantId,
          `campaign:${id}`,
          async (tx) => {
            const c = await tx.campaign(id);
            if (c)
              await tx.saveCampaign({
                ...c,
                status: "paused",
                pauseReason: "plan_unavailable",
              });
          }
        );
        return;
      }
      for (let count = 0; count < 20; count++) {
        // A committed sending marker precedes all external I/O. A crashed lease is
        // reconciled as unknown and is never retried blindly by another worker.
        const claimed = await this.repository.transaction(
          merchantId,
          `campaign:${id}`,
          async (tx) => {
            const c = await tx.campaign(id);
            const now = this.clock.now().toISOString();
            if (
              !c ||
              !["scheduled", "running"].includes(c.status) ||
              c.approvedVersion !== c.version ||
              (c.scheduledAt && Date.parse(c.scheduledAt) > Date.parse(now))
            )
              return null;
            const stale = await tx.expiredRecipient(id, now);
            if (stale) {
              await tx.saveRecipient({
                ...stale,
                status: "unknown",
                reason: "dispatch_lease_expired",
                leaseToken: null,
                leaseUntil: null,
                updatedAt: now,
              });
            }
            const settings = await tx.settings();
            if (
              !settings?.configured ||
              !withinMarketingHours(settings, this.clock.now())
            )
              return null;
            const next = await tx.nextRecipient(id);
            if (!next) {
              const totals = await tx.recipientCounts(id);
              if (!totals.sending)
                await tx.saveCampaign({
                  ...c,
                  status: totals.unknown ? "paused" : "completed",
                  pauseReason: totals.unknown
                    ? "provider_outcome_unknown"
                    : undefined,
                  updatedAt: now,
                });
              return null;
            }
            if (c.reservedCents + c.maxUnitCostCents > c.budgetCents) {
              await tx.saveCampaign({
                ...c,
                status: "paused",
                pauseReason: "budget_exhausted",
                updatedAt: now,
              });
              return null;
            }
            const recipient: MarketingRecipient = {
              ...next,
              status: "sending",
              leaseToken: randomUUID(),
              leaseUntil: new Date(Date.parse(now) + 120_000).toISOString(),
              attemptedAt: now,
              costReservedCents: c.maxUnitCostCents,
              updatedAt: now,
            };
            await tx.saveRecipient(recipient);
            await tx.saveCampaign({
              ...c,
              status: "running",
              reservedCents: c.reservedCents + c.maxUnitCostCents,
              updatedAt: now,
            });
            return recipient;
          }
        );
        if (!claimed) return;
        try {
          await this.dispatch(merchantId, id, claimed);
        } catch {
          await this.repository.transaction(
            merchantId,
            `campaign:${id}`,
            async (tx) => {
              const r = await tx.recipient(claimed.id);
              if (
                r?.status === "sending" &&
                r.leaseToken === claimed.leaseToken
              ) {
                await tx.saveRecipient({
                  ...r,
                  status: "unknown",
                  reason: "dispatch_outcome_unknown",
                  leaseToken: null,
                  leaseUntil: null,
                  updatedAt: this.clock.now().toISOString(),
                });
                this.observability.dispatchOutcome("unknown");
              }
            }
          );
        }
      }
    });
  }
  private async dispatch(
    merchantId: string,
    id: string,
    claim: MarketingRecipient
  ) {
    await this.repository.transaction(
      merchantId,
      `campaign:${id}`,
      async (tx) => {
        const r = await tx.recipient(claim.id);
        if (!r || r.status !== "sending" || r.leaseToken !== claim.leaseToken)
          return;
        const c = await tx.campaign(id);
        const contact = await tx.contact(r.contactId);
        const settings = await tx.settings();
        const consent = contact ? await tx.consent(contact.id) : null;
        const plan = await this.context.plan(merchantId);
        let reason = !["growth", "scale"].includes(plan)
          ? "plan_unavailable"
          : !c || c.status !== "running"
          ? "campaign_paused"
          : c.approvedVersion !== c.version || r.campaignVersion !== c.version
          ? "approval_changed"
          : !contact?.phone
          ? "no_phone"
          : !marketingConsentGranted(consent)
          ? "no_consent"
          : !settings?.configured
          ? "settings_unavailable"
          : !withinMarketingHours(settings, this.clock.now())
          ? "outside_send_hours"
          : contact.accountId &&
            consent &&
            (await this.context.blockedByPreference(
              contact.accountId,
              consent.recordedAt,
              merchantId
            ))
          ? "preference_blocked"
          : null;
        if (
          !reason &&
          contact &&
          settings &&
          !(await tx.reserveCommercial(
            contact.identityKey,
            `campaign:${r.id}`,
            this.clock.now().toISOString(),
            settings.minIntervalHours,
            settings.maxMessagesPerDay
          ))
        )
          reason = "frequency_limit";
        if (reason || !c || !contact?.phone || !c.templateName) {
          await tx.saveRecipient({
            ...r,
            status: "suppressed",
            reason: reason ?? "template_missing",
            leaseToken: null,
            leaseUntil: null,
            costReservedCents: 0,
            updatedAt: this.clock.now().toISOString(),
          });
          if (c)
            await tx.saveCampaign({
              ...c,
              reservedCents: Math.max(0, c.reservedCents - r.costReservedCents),
            });
          this.observability.dispatchOutcome("suppressed");
          return;
        }
        let conversation = await tx.latestConversation(contact.id, "whatsapp");
        if (!conversation) {
          conversation = {
            id: randomUUID(),
            merchantId,
            contactId: contact.id,
            channel: "whatsapp",
            externalId: `campaign:${contact.id}`,
            mode: "ai",
            assignedUserId: null,
            version: 0,
            lastInboundAt: "1970-01-01T00:00:00.000Z",
            updatedAt: this.clock.now().toISOString(),
            deviceId: null,
            openingChoice: "granted",
            pendingQuestion: null,
          } satisfies MarketingConversation;
          await tx.saveConversation(conversation);
        }
        const message: MarketingMessage = {
          id: randomUUID(),
          merchantId,
          conversationId: conversation.id,
          dedupKey: `campaign:${r.id}`,
          role: "system",
          content: c.body,
          createdAt: this.clock.now().toISOString(),
          status: "sending",
          providerMessageId: null,
          authorId: c.approvedBy,
          campaignId: c.id,
        };
        await tx.appendMessage(message);
        let result: MerchantMarketingSendResult;
        try {
          result = await this.messaging.sendCampaign({
            merchantId,
            phone: contact.phone,
            templateName: c.templateName,
            body: c.body,
            language: c.language,
            wabaId: c.templateWabaId,
          });
        } catch {
          result = { status: "unknown", reason: "provider_acceptance_unknown" };
        }
        if (result.status === "accepted" && !result.messageId?.trim())
          result = { status: "unknown", reason: "provider_acceptance_unknown" };
        this.observability.dispatchOutcome(result.status);
        message.status = result.status;
        message.providerMessageId = result.messageId ?? null;
        await tx.saveMessage(message);
        await tx.saveRecipient({
          ...r,
          status: result.status,
          reason: result.reason ?? null,
          providerMessageId: result.messageId ?? null,
          leaseToken: null,
          leaseUntil: null,
          updatedAt: this.clock.now().toISOString(),
        });
        if (result.status === "failed" || result.status === "suppressed")
          await tx.saveCampaign({
            ...c,
            reservedCents: Math.max(0, c.reservedCents - r.costReservedCents),
          });
      },
      { timeoutMs: 60_000 }
    );
  }
}
