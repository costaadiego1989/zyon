import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  MERCHANT_MARKETING_MESSAGING,
  type MerchantMarketingMessaging,
} from "../../../shared/contracts/marketing.js";
import {
  MARKETING_REPOSITORY,
  type MarketingRepository,
  type MarketingTransaction,
} from "../domain/marketing.repository.js";
import {
  MARKETING_CLOCK,
  MARKETING_CONTEXT,
  type MarketingClock,
  type MarketingContext,
} from "../domain/marketing-context.port.js";
import {
  MarketingError,
  requireMarketingApprover,
  requireMarketingPlan,
  marketingConsentGranted,
  validateMarketingCampaign,
  validateMarketingSettings,
  type MarketingCampaign,
  type MarketingSettings,
  type MarketingSegment,
  type MarketingRecipient,
} from "../domain/marketing.js";

export interface MarketingCampaignDraft {
  name: string;
  body: string;
  segment: MarketingSegment;
  budgetCents: number;
  maxUnitCostCents: number;
  language?: string;
}
@Injectable()
export class MarketingCampaignsService {
  constructor(
    @Inject(MARKETING_REPOSITORY)
    private readonly repository: MarketingRepository,
    @Inject(MARKETING_CONTEXT) private readonly context: MarketingContext,
    @Inject(MERCHANT_MARKETING_MESSAGING)
    private readonly messaging: MerchantMarketingMessaging,
    @Inject(MARKETING_CLOCK) private readonly clock: MarketingClock
  ) {}
  private async access(merchantId: string, role?: string) {
    requireMarketingPlan(await this.context.plan(merchantId));
    if (role !== undefined) requireMarketingApprover(role);
  }
  async create(
    merchantId: string,
    role: string,
    draft: MarketingCampaignDraft
  ) {
    await this.access(merchantId, role);
    const now = this.clock.now().toISOString();
    const campaign: MarketingCampaign = {
      ...draft,
      language: draft.language ?? "pt_BR",
      id: randomUUID(),
      merchantId,
      status: "draft",
      version: 1,
      approvedVersion: null,
      approvedBy: null,
      approvedAt: null,
      templateName: null,
      templateStatus: "not_submitted",
      templateWabaId: null,
      reservedCents: 0,
      scheduledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    validateMarketingCampaign(campaign);
    await this.repository.transaction(
      merchantId,
      `campaign:${campaign.id}`,
      (tx) => tx.saveCampaign(campaign)
    );
    return campaign;
  }
  async update(
    merchantId: string,
    role: string,
    id: string,
    version: number,
    draft: MarketingCampaignDraft
  ) {
    await this.access(merchantId, role);
    return this.repository.transaction(
      merchantId,
      `campaign:${id}`,
      async (tx) => {
        const c = await this.required(tx, id);
        if (c.version !== version)
          throw new MarketingError("marketing_campaign_changed", 409);
        if ((await tx.recipients(id)).some((r) => r.attemptedAt))
          throw new MarketingError(
            "marketing_campaign_already_dispatched",
            409
          );
        const updated: MarketingCampaign = {
          ...c,
          ...draft,
          language: draft.language ?? c.language,
          status: "draft",
          version: c.version + 1,
          approvedVersion: null,
          approvedBy: null,
          approvedAt: null,
          scheduledAt: null,
          templateName: null,
          templateStatus: "not_submitted",
          templateWabaId: null,
          audience: undefined,
          reservedCents: 0,
          updatedAt: this.clock.now().toISOString(),
        };
        validateMarketingCampaign(updated);
        await tx.clearUnsentRecipients(id);
        await tx.saveCampaign(updated);
        return updated;
      }
    );
  }
  async submitTemplate(merchantId: string, role: string, id: string) {
    await this.access(merchantId, role);
    const before = await this.repository.transaction(
      merchantId,
      `campaign:${id}`,
      async (tx) => {
        const c = await this.required(tx, id);
        if (
          c.templateName ||
          ["submitting", "submission_unknown"].includes(c.templateStatus)
        )
          throw new MarketingError(
            "marketing_template_reconciliation_required",
            409
          );
        const updated = {
          ...c,
          templateName: `campaign_${id.replace(/-/g, "")}_v${c.version}`,
          templateStatus: "submitting",
          updatedAt: this.clock.now().toISOString(),
        };
        await tx.saveCampaign(updated);
        return updated;
      }
    );
    const templateName = `campaign_${id.replace(/-/g, "")}_v${before.version}`;
    let result: Awaited<
      ReturnType<MerchantMarketingMessaging["submitTemplate"]>
    >;
    try {
      result = await this.messaging.submitTemplate({
        merchantId,
        name: templateName,
        body: before.body,
        language: before.language,
      });
    } catch {
      result = {
        name: templateName,
        status: "submission_unknown",
        wabaId: null,
      };
    }
    return this.repository.transaction(
      merchantId,
      `campaign:${id}`,
      async (tx) => {
        const c = await this.required(tx, id);
        if (c.version !== before.version)
          throw new MarketingError("marketing_campaign_changed", 409);
        const updated = {
          ...c,
          templateName: result.name || null,
          templateStatus: result.status,
          templateWabaId: result.wabaId,
          updatedAt: this.clock.now().toISOString(),
        };
        await tx.saveCampaign(updated);
        return updated;
      }
    );
  }
  async syncTemplate(merchantId: string, role: string, id: string) {
    await this.access(merchantId, role);
    const c = await this.get(merchantId, id);
    if (!c.templateName)
      throw new MarketingError("marketing_template_missing", 409);
    const input = {
      merchantId,
      name: c.templateName,
      body: c.body,
      language: c.language,
      wabaId: c.templateWabaId,
    };
    const inspected = this.messaging.inspectTemplate
      ? await this.messaging.inspectTemplate(input)
      : null;
    const approved = inspected
      ? inspected.status === "approved"
      : await this.messaging.checkTemplate(input);
    return this.repository.transaction(
      merchantId,
      `campaign:${id}`,
      async (tx) => {
        const current = await this.required(tx, id);
        if (current.version !== c.version)
          throw new MarketingError("marketing_campaign_changed", 409);
        const updated = {
          ...current,
          templateStatus: approved
            ? "approved"
            : inspected?.status ?? "unavailable",
          templateWabaId: inspected?.wabaId ?? current.templateWabaId,
          updatedAt: this.clock.now().toISOString(),
        };
        await tx.saveCampaign(updated);
        return updated;
      }
    );
  }
  async get(merchantId: string, id: string) {
    await this.access(merchantId);
    return this.repository.transaction(merchantId, `campaign:${id}`, (tx) =>
      this.required(tx, id)
    );
  }
  async list(merchantId: string) {
    await this.access(merchantId);
    return this.repository.transaction(merchantId, "campaign-list", (tx) =>
      tx.campaigns()
    );
  }
  async review(merchantId: string, id: string) {
    await this.access(merchantId);
    return this.repository.transaction(
      merchantId,
      `campaign:${id}`,
      async (tx) => {
        const c = await this.required(tx, id);
        const audience = await this.audience(tx, c);
        return {
          ...audience.summary,
          estimatedReservationCents: audience.ids.length * c.maxUnitCostCents,
          budgetSufficient:
            audience.ids.length * c.maxUnitCostCents <= c.budgetCents,
          templateStatus: c.templateStatus,
          settingsConfigured: (await tx.settings())?.configured === true,
        };
      }
    );
  }
  async approve(
    merchantId: string,
    role: string,
    id: string,
    version: number,
    actor: string
  ) {
    await this.access(merchantId, role);
    const before = await this.get(merchantId, id);
    if (before.version !== version)
      throw new MarketingError("marketing_campaign_changed", 409);
    if (
      !before.templateName ||
      !before.templateWabaId ||
      !(await this.messaging.checkTemplate({
        merchantId,
        name: before.templateName,
        body: before.body,
        language: before.language,
        wabaId: before.templateWabaId,
      }))
    )
      throw new MarketingError("marketing_approved_template_required", 409);
    return this.repository.transaction(
      merchantId,
      `campaign:${id}`,
      async (tx) => {
        const c = await this.required(tx, id);
        if (c.version !== version)
          throw new MarketingError("marketing_campaign_changed", 409);
        if ((await tx.recipients(id)).some((r) => r.attemptedAt))
          throw new MarketingError(
            "marketing_campaign_already_dispatched",
            409
          );
        const settings = await tx.settings();
        if (!settings?.configured)
          throw new MarketingError("marketing_settings_required", 409);
        validateMarketingSettings(settings);
        const audience = await this.audience(tx, c);
        if (!audience.ids.length)
          throw new MarketingError("marketing_eligible_audience_empty", 409);
        if (audience.ids.length * c.maxUnitCostCents > c.budgetCents)
          throw new MarketingError(
            "marketing_campaign_budget_insufficient",
            409
          );
        const now = this.clock.now().toISOString();
        const recipients: MarketingRecipient[] = audience.ids.map(
          (contactId) => ({
            id: randomUUID(),
            merchantId,
            campaignId: id,
            contactId,
            campaignVersion: version,
            status: "queued",
            reason: null,
            providerMessageId: null,
            leaseToken: null,
            leaseUntil: null,
            attemptedAt: null,
            costReservedCents: 0,
            updatedAt: now,
          })
        );
        await tx.clearUnsentRecipients(id);
        await tx.saveRecipients(recipients);
        const updated: MarketingCampaign = {
          ...c,
          status: "approved",
          approvedVersion: version,
          approvedBy: actor,
          approvedAt: now,
          templateStatus: "approved",
          audience: audience.summary,
          updatedAt: now,
        };
        await tx.saveCampaign(updated);
        return updated;
      }
    );
  }
  async schedule(
    merchantId: string,
    role: string,
    id: string,
    scheduledAt: string | null
  ) {
    await this.access(merchantId, role);
    if (
      scheduledAt &&
      (!Number.isFinite(Date.parse(scheduledAt)) ||
        Date.parse(scheduledAt) < this.clock.now().getTime())
    )
      throw new MarketingError("marketing_schedule_invalid");
    return this.repository.transaction(
      merchantId,
      `campaign:${id}`,
      async (tx) => {
        const c = await this.required(tx, id);
        if (
          !["approved", "paused"].includes(c.status) ||
          c.approvedVersion !== c.version
        )
          throw new MarketingError("marketing_campaign_approval_required", 409);
        const updated = {
          ...c,
          status: scheduledAt ? ("scheduled" as const) : ("running" as const),
          scheduledAt,
          updatedAt: this.clock.now().toISOString(),
        };
        await tx.saveCampaign(updated);
        return updated;
      }
    );
  }
  async pause(merchantId: string, role: string, id: string) {
    await this.access(merchantId, role);
    return this.repository.transaction(
      merchantId,
      `campaign:${id}`,
      async (tx) => {
        const c = await this.required(tx, id);
        if (!["approved", "scheduled", "running", "paused"].includes(c.status))
          throw new MarketingError("marketing_campaign_not_active", 409);
        const updated = {
          ...c,
          status: "paused" as const,
          updatedAt: this.clock.now().toISOString(),
        };
        await tx.saveCampaign(updated);
        return updated;
      }
    );
  }
  async settings(merchantId: string) {
    await this.access(merchantId);
    return this.repository.transaction(merchantId, "settings", (tx) =>
      tx.settings()
    );
  }
  async configure(
    merchantId: string,
    role: string,
    input: Omit<
      MarketingSettings,
      "id" | "merchantId" | "updatedAt" | "configured"
    >
  ) {
    await this.access(merchantId, role);
    const settings: MarketingSettings = {
      ...input,
      id: merchantId,
      merchantId,
      configured: true,
      updatedAt: this.clock.now().toISOString(),
    };
    validateMarketingSettings(settings);
    await this.repository.transaction(merchantId, "settings", (tx) =>
      tx.saveSettings(settings)
    );
    return settings;
  }
  async report(merchantId: string, id: string) {
    await this.access(merchantId);
    return this.repository.transaction(
      merchantId,
      `campaign:${id}`,
      async (tx) => {
        const campaign = await this.required(tx, id);
        const recipients = await tx.recipients(id);
        const counts: Record<string, number> = {
          queued: 0,
          sending: 0,
          accepted: 0,
          delivered: 0,
          read: 0,
          failed: 0,
          suppressed: 0,
          unknown: 0,
        };
        for (const r of recipients) counts[r.status]++;
        return {
          campaign,
          counts,
          selected: campaign.audience?.selected ?? 0,
          eligible: campaign.audience?.eligible ?? 0,
          excluded: campaign.audience?.excluded ?? {},
          reservedCents: campaign.reservedCents,
          attributedRevenueCents: null,
        };
      }
    );
  }
  private async required(tx: MarketingTransaction, id: string) {
    const c = await tx.campaign(id);
    if (!c) throw new MarketingError("marketing_campaign_not_found", 404);
    return c;
  }
  private async audience(tx: MarketingTransaction, c: MarketingCampaign) {
    const contacts = await tx.contacts({
      ...c.segment,
      limit: 10001,
      offset: 0,
    });
    if (contacts.total > 10000)
      throw new MarketingError("marketing_campaign_audience_too_large", 409);
    const consents = new Map(
      (await tx.consents(contacts.items.map((c) => c.id))).map((consent) => [
        consent.contactId,
        consent,
      ])
    );
    const accountChoices = contacts.items.flatMap((c) =>
      c.accountId && consents.get(c.id)
        ? [
            {
              accountId: c.accountId,
              consentAt: consents.get(c.id)!.recordedAt,
            },
          ]
        : []
    );
    const blocked = this.context.blockedAccounts
      ? await this.context.blockedAccounts(accountChoices, c.merchantId)
      : new Set(
          (
            await Promise.all(
              accountChoices.map(async (item) =>
                (await this.context.blockedByPreference(
                  item.accountId,
                  item.consentAt,
                  c.merchantId
                ))
                  ? item.accountId
                  : null
              )
            )
          ).filter((x): x is string => x !== null)
        );
    const ids: string[] = [];
    const excluded: Record<string, number> = {};
    for (const contact of contacts.items) {
      const reason = !contact.phone
        ? "no_phone"
        : !marketingConsentGranted(consents.get(contact.id) ?? null)
        ? "no_consent"
        : contact.accountId && blocked.has(contact.accountId)
        ? "preference_blocked"
        : null;
      if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
      else ids.push(contact.id);
    }
    return {
      ids,
      summary: { selected: contacts.total, eligible: ids.length, excluded },
    };
  }
}
