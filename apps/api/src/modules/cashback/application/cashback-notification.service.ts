import { Inject, Injectable } from "@nestjs/common";
import { CashbackService } from "./cashback.service.js";
import { CampaignContactConsentService } from "../../campaign-consent/campaign-contact-consent.service.js";
import { WHATSAPP_TEMPLATE_REPOSITORY, type WhatsAppTemplateRepositoryPort } from "../../whatsapp-templates/domain/ports/whatsapp-template-repository.port.js";
import { SendWhatsAppMessageUseCase } from "../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";

export type CashbackNotice = { merchantId: string; buyerId: string; type: "cashback_available" | "cashback_expiring"; sourceId: string };

@Injectable()
export class CashbackNotificationService {
  constructor(private readonly cashback: CashbackService, private readonly consent: CampaignContactConsentService,
    @Inject(WHATSAPP_TEMPLATE_REPOSITORY) private readonly templates: WhatsAppTemplateRepositoryPort,
    private readonly sender: SendWhatsAppMessageUseCase) {}

  async dispatch(notice: CashbackNotice) {
    const wallet = await this.cashback.wallet(notice.merchantId, notice.buyerId);
    const buyerId = wallet.buyerId;
    const prisma = this.cashback.repository.prisma;
    const [waConsent, emailConsent, waTemplate, emailTemplate] = await Promise.all([
      this.consent.canContact({ merchantId: notice.merchantId, globalUserId: buyerId, channel: "whatsapp" }),
      this.consent.canContact({ merchantId: notice.merchantId, globalUserId: buyerId, channel: "email" }),
      this.templates.findByMerchantAndType(notice.merchantId, notice.type, "whatsapp"),
      this.templates.findByMerchantAndType(notice.merchantId, notice.type, "email"),
    ]);
    const account = await prisma.buyerAccount.findUnique({ where: { globalUserId: buyerId }, select: { email: true, displayName: true } });
    const phones = waConsent && waTemplate?.isActive && waTemplate.merchantId === notice.merchantId
      ? await prisma.$queryRaw<Array<{ phone: string }>>`SELECT phone FROM buyer_verified_phones WHERE buyer_id=${buyerId} ORDER BY verified_at DESC LIMIT 1`
      : [];
    const toPhone = phones[0]?.phone;
    const email = emailConsent && emailTemplate?.isActive && emailTemplate.merchantId === notice.merchantId
      && account?.email && !account.email.endsWith("@buyer.aacp") ? account.email : undefined;
    if (!toPhone && !email) {
      await prisma.$executeRaw`INSERT INTO cashback_notifications(merchant_id,buyer_id,type,source_id,state,reason)
        VALUES(${notice.merchantId},${buyerId},${notice.type},${notice.sourceId},'skipped','cashback_contact_not_authorized')
        ON CONFLICT(merchant_id,type,source_id) DO NOTHING`;
      return { status: "skipped", reason: "cashback_contact_not_authorized" };
    }
    const amount = notice.type === "cashback_expiring" ? wallet.balance.nextExpiryCents : wallet.balance.availableCents;
    if (amount <= 0 || (notice.type === "cashback_expiring" && !wallet.balance.nextExpiryAt)) return { status: "skipped", reason: "cashback_notice_no_longer_relevant" };
    // A durable claim precedes the provider call. Unknown acceptance is never
    // automatically sent again or moved to a second channel.
    const claim = await prisma.$queryRaw<Array<{ id: string }>>`INSERT INTO cashback_notifications(merchant_id,buyer_id,type,source_id,state)
      VALUES(${notice.merchantId},${buyerId},${notice.type},${notice.sourceId},'dispatching')
      ON CONFLICT(merchant_id,type,source_id) DO NOTHING RETURNING id`;
    if (!claim[0]) return { status: "skipped", reason: "cashback_notice_already_claimed" };
    try {
      // Consent is checked again immediately before dispatch, including email
      // fallback. Linking WhatsApp never creates marketing consent.
      const useWa = toPhone && await this.consent.canContact({ merchantId: notice.merchantId, globalUserId: buyerId, channel: "whatsapp" });
      const useEmail = email && await this.consent.canContact({ merchantId: notice.merchantId, globalUserId: buyerId, channel: "email" });
      if (!useWa && !useEmail) {
        await this.finish(claim[0].id, "cancelled", "contact_consent_revoked");
        return { status: "skipped", reason: "contact_consent_revoked" };
      }
      const result = await this.sender.execute({ merchantId: notice.merchantId, type: notice.type,
        toPhone: useWa ? toPhone : undefined, fallbackEmail: useEmail ? email : undefined,
        variables: { buyerName: account?.displayName ?? "Cliente", cashbackAmount: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount / 100),
          cashbackExpiresAt: wallet.balance.nextExpiryAt ? new Date(wallet.balance.nextExpiryAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "" } });
      const state = result.status === "sent" && result.messageId ? "sent" : result.status === "skipped" ? "skipped" : "unknown";
      await this.finish(claim[0].id, state, result.reason ?? null, result.messageId ?? null);
      return result;
    } catch {
      await this.finish(claim[0].id, "unknown", "provider_acceptance_unknown").catch(() => undefined);
      return { status: "uncertain", reason: "provider_acceptance_unknown" };
    }
  }

  private async finish(id: string, state: string, reason: string | null, messageId: string | null = null) {
    await this.cashback.repository.prisma.$executeRaw`UPDATE cashback_notifications SET state=${state},reason=${reason},provider_message_id=${messageId},updated_at=now() WHERE id=${id}::uuid`;
  }

  async run() {
    const rows = await this.cashback.repository.prisma.$queryRaw<Array<{ merchant_id: string; buyer_id: string; type: CashbackNotice["type"]; source_id: string }>>`
      SELECT e.merchant_id,e.buyer_id,'cashback_available' AS type,e.id AS source_id FROM cashback_ledger_entries e
      WHERE e.type='release' AND e.occurred_at>now()-interval '1 day'
        AND NOT EXISTS(SELECT 1 FROM cashback_notifications n WHERE n.merchant_id=e.merchant_id AND n.type='cashback_available' AND n.source_id=e.id)
      UNION ALL
      SELECT g.merchant_id,g.buyer_id,'cashback_expiring' AS type,g.id AS source_id FROM cashback_grants g
      WHERE (g.data->>'availableCents')::bigint>0 AND (g.data->>'expiresAt')::timestamptz>now()
        AND (g.data->>'expiresAt')::timestamptz<=now()+interval '3 days'
        AND NOT EXISTS(SELECT 1 FROM cashback_notifications n WHERE n.merchant_id=g.merchant_id AND n.type='cashback_expiring' AND n.source_id=g.id)
      LIMIT 200`;
    for (const row of rows) await this.dispatch({ merchantId: row.merchant_id, buyerId: row.buyer_id, type: row.type, sourceId: row.source_id });
    return { considered: rows.length };
  }
}
