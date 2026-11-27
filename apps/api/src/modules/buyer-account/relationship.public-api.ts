import { Inject, Injectable, Module } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";

/** Read-only relationship projection owned by buyer-account. No profile phone is proof. */
@Injectable()
export class BuyerRelationshipReader {
  constructor(@Inject(PRISMA_CLIENT) private readonly db: PrismaClient) {}
  async account(id: string) {
    const account = await this.db.buyerAccount.findUnique({
      where: { globalUserId: id },
      select: { globalUserId: true, displayName: true, email: true },
    });
    if (!account) return null;
    const phone = await this.db.buyerVerifiedPhone.findFirst({
      where: { buyerId: id },
      select: { phone: true },
      orderBy: { verifiedAt: "desc" },
    });
    return {
      id: account.globalUserId,
      name: account.displayName || null,
      email: account.email || null,
      verifiedPhone: phone?.phone ?? null,
    };
  }
  async verifiedAccount(phone: string) {
    const link = await this.db.buyerVerifiedPhone.findUnique({
      where: { phone },
      select: { buyerId: true },
    });
    if (!link) return null;
    const buyer = await this.account(link.buyerId);
    return buyer ? { ...buyer, verifiedPhone: phone } : null;
  }
  historyPage(
    merchantId: string,
    snapshotAt: string,
    after: string | null,
    limit: number
  ) {
    return this.db.buyerConversation.findMany({
      where: {
        merchantId,
        startedAt: { lte: new Date(snapshotAt) },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit,
      select: {
        id: true,
        globalUserId: true,
        sessionId: true,
        messages: true,
        startedAt: true,
        lastMessageAt: true,
      },
    });
  }
  async blockedAccounts(
    items: Array<{ accountId: string; consentAt: string }>
  ) {
    if (!items.length) return new Set<string>();
    const rows = await this.db.$queryRaw<
      Array<{ global_user_id: string }>
    >(Prisma.sql`SELECT p.global_user_id FROM buyer_preferences p
    JOIN jsonb_to_recordset(${JSON.stringify(
      items.map((i) => ({ account_id: i.accountId, consent_at: i.consentAt }))
    )}::jsonb)
    AS choice(account_id text,consent_at timestamptz) ON p.global_user_id=choice.account_id
    WHERE p.whatsapp_opt_in=false AND p.updated_at>=choice.consent_at`);
    return new Set(rows.map((row) => row.global_user_id));
  }
}
@Module({
  providers: [BuyerRelationshipReader],
  exports: [BuyerRelationshipReader],
})
export class BuyerRelationshipModule {}
