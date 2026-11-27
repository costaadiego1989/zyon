import { Inject, Injectable, Module } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";

/** Read-only consent boundary. Reading permission never reserves or sends a communication. */
@Injectable()
export class CampaignConsentReader {
  constructor(@Inject(PRISMA_CLIENT) private readonly db: PrismaClient) {}
  async blockedAccounts(
    merchantId: string,
    items: Array<{ accountId: string; consentAt: string }>
  ) {
    if (!items.length) return new Set<string>();
    const rows = await this.db.$queryRaw<
      Array<{ global_user_id: string }>
    >(Prisma.sql`SELECT c.global_user_id FROM campaign_contact_consents c
   JOIN jsonb_to_recordset(${JSON.stringify(
     items.map((i) => ({ account_id: i.accountId, consent_at: i.consentAt }))
   )}::jsonb)
   AS choice(account_id text,consent_at timestamptz) ON c.global_user_id=choice.account_id
   WHERE c.merchant_id=${merchantId} AND c.channel='whatsapp' AND c.purpose='marketing' AND c.status='revoked' AND c.revoked_at>=choice.consent_at`);
    return new Set(rows.map((row) => row.global_user_id));
  }
  async permission(merchantId: string, accountId: string) {
    return this.db.campaignContactConsent.findUnique({
      where: {
        merchantId_globalUserId_channel_purpose: {
          merchantId,
          globalUserId: accountId,
          channel: "whatsapp",
          purpose: "marketing",
        },
      },
    });
  }
}
@Module({
  providers: [CampaignConsentReader],
  exports: [CampaignConsentReader],
})
export class CampaignConsentReadModule {}
