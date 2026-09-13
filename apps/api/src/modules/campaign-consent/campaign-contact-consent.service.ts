import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";

export const CAMPAIGN_CONTACT_PURPOSE = "marketing" as const;
export type CampaignContactChannel = "email" | "whatsapp";

export interface RecordCampaignConsentInput {
  merchantId: string;
  globalUserId: string;
  channels: CampaignContactChannel[];
  policyVersion: string;
  source: string;
  evidence: Record<string, unknown>;
}

/** A tenant-scoped permission boundary for commercial contact. */
@Injectable()
export class CampaignContactConsentService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async grant(input: RecordCampaignConsentInput): Promise<void> {
    const now = new Date();
    await Promise.all(input.channels.map((channel) => (this.prisma as any).campaignContactConsent.upsert({
      where: { merchantId_globalUserId_channel_purpose: { merchantId: input.merchantId, globalUserId: input.globalUserId, channel, purpose: CAMPAIGN_CONTACT_PURPOSE } },
      create: { merchantId: input.merchantId, globalUserId: input.globalUserId, channel, purpose: CAMPAIGN_CONTACT_PURPOSE,
        status: "granted", policyVersion: input.policyVersion, source: input.source, evidence: input.evidence, grantedAt: now, revokedAt: null },
      update: { status: "granted", policyVersion: input.policyVersion, source: input.source, evidence: input.evidence, grantedAt: now, revokedAt: null },
    })));
  }

  async revoke(input: RecordCampaignConsentInput): Promise<void> {
    const now = new Date();
    await (this.prisma as any).$transaction(async (tx: any) => {
      await Promise.all(input.channels.map((channel) => tx.campaignContactConsent.upsert({
        where: { merchantId_globalUserId_channel_purpose: { merchantId: input.merchantId, globalUserId: input.globalUserId, channel, purpose: CAMPAIGN_CONTACT_PURPOSE } },
        create: { merchantId: input.merchantId, globalUserId: input.globalUserId, channel, purpose: CAMPAIGN_CONTACT_PURPOSE,
          status: "revoked", policyVersion: input.policyVersion, source: input.source, evidence: input.evidence, grantedAt: null, revokedAt: now },
        update: { status: "revoked", policyVersion: input.policyVersion, source: input.source, evidence: input.evidence, revokedAt: now },
      })));
      await tx.postSaleScheduledMessage.updateMany({
        where: { merchantId: input.merchantId, buyerId: input.globalUserId, channel: { in: input.channels }, status: "pending" },
        data: { status: "cancelled", failureReason: "contact_consent_revoked" },
      });
    });
  }

  async replace(input: RecordCampaignConsentInput): Promise<void> {
    const granted = new Set(input.channels);
    const revoked = (["email", "whatsapp"] as const).filter((channel) => !granted.has(channel));
    const now = new Date();
    await (this.prisma as any).$transaction(async (tx: any) => {
      await Promise.all((["email", "whatsapp"] as const).map((channel) => {
        const isGranted = granted.has(channel);
        return tx.campaignContactConsent.upsert({
          where: { merchantId_globalUserId_channel_purpose: { merchantId: input.merchantId, globalUserId: input.globalUserId, channel, purpose: CAMPAIGN_CONTACT_PURPOSE } },
          create: { merchantId: input.merchantId, globalUserId: input.globalUserId, channel, purpose: CAMPAIGN_CONTACT_PURPOSE,
            status: isGranted ? "granted" : "revoked", policyVersion: input.policyVersion, source: input.source, evidence: input.evidence,
            grantedAt: isGranted ? now : null, revokedAt: isGranted ? null : now },
          update: { status: isGranted ? "granted" : "revoked", policyVersion: input.policyVersion, source: input.source, evidence: input.evidence,
            grantedAt: isGranted ? now : undefined, revokedAt: isGranted ? null : now },
        });
      }));
      if (revoked.length) {
        await tx.postSaleScheduledMessage.updateMany({
          where: { merchantId: input.merchantId, buyerId: input.globalUserId, channel: { in: revoked }, status: "pending" },
          data: { status: "cancelled", failureReason: "contact_consent_revoked" },
        });
      }
    });
  }

  async canContact(input: { merchantId: string; globalUserId: string; channel: CampaignContactChannel }): Promise<boolean> {
    const row = await (this.prisma as any).campaignContactConsent.findUnique({
      where: { merchantId_globalUserId_channel_purpose: { merchantId: input.merchantId, globalUserId: input.globalUserId,
        channel: input.channel, purpose: CAMPAIGN_CONTACT_PURPOSE } },
      select: { status: true, grantedAt: true, revokedAt: true },
    });
    if (!row || row.status !== "granted" || !row.grantedAt || row.revokedAt) return false;
    const preferences = await (this.prisma as any).buyerPreference.findUnique({
      where: { globalUserId: input.globalUserId }, select: { emailOptIn: true, whatsappOptIn: true },
    });
    return input.channel === "email" ? preferences?.emailOptIn !== false : preferences?.whatsappOptIn !== false;
  }

  async getGrantedChannels(input: { merchantId: string; globalUserId: string }): Promise<CampaignContactChannel[]> {
    const channels: CampaignContactChannel[] = [];
    for (const channel of ["email", "whatsapp"] as const) {
      if (await this.canContact({ ...input, channel })) channels.push(channel);
    }
    return channels;
  }
}
