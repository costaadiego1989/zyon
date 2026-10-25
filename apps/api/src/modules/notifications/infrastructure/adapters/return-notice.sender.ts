import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { EmailProviderRejection } from "../../domain/ports/email-provider-rejection.js";
import type { ReturnNoticeClaim, ReturnNoticeResult } from "../../domain/return-notice.js";
import { renderReturnDecisionEmail } from "../templates/return-decision.template.js";
import { WHATSAPP_TEMPLATE_REPOSITORY, type WhatsAppTemplateRepositoryPort } from "../../../whatsapp-templates/domain/ports/whatsapp-template-repository.port.js";
import { WHATSAPP_TEMPLATE_SENDER, type WhatsAppTemplateSenderPort } from "../../../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudRecoveryCredentials, isApprovedSalesTemplate, normalizeRecoveryRecipient } from "../../../whatsapp-templates/domain/services/recovery-whatsapp-policy.js";
import { RecoveryTemplateLifecycleUseCase } from "../../../whatsapp-templates/application/use-cases/recovery-template-lifecycle.use-case.js";
import { salesDefaults } from "../../../whatsapp-templates/domain/sales-template-content.js";

export type PreparedReturnNotice = ReturnNoticeResult | { send(): Promise<ReturnNoticeResult> };
@Injectable()
export class ReturnNoticeSender {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EMAIL_SENDER_PORT) private readonly email: EmailSenderPort,
    @Inject(WHATSAPP_TEMPLATE_REPOSITORY) private readonly templates: WhatsAppTemplateRepositoryPort,
    @Inject(WHATSAPP_TEMPLATE_SENDER) private readonly whatsapp: WhatsAppTemplateSenderPort,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly config: WhatsAppConfigRepository,
    private readonly lifecycle: RecoveryTemplateLifecycleUseCase) {}

  async prepare(claim: ReturnNoticeClaim): Promise<PreparedReturnNotice> {
    const ret = await this.prisma.return.findFirst({ where: { id: claim.returnId, merchantId: claim.merchantId }, select: { buyerId: true, status: true } });
    if (!ret) return { status: "skipped", reason: "return_removed" };
    if ((["return_authorized", "return_approved", "return_posting_code", "return_declaration_ready"].includes(claim.type)) &&
        ["REJECTED", "CANCELLED", "REFUND_COMPLETED", "EXCHANGE_COMPLETED"].includes(ret.status))
      return { status: "skipped", reason: "decision_superseded" };
    if ((claim.type === "return_refunded" && ret.status !== "REFUND_COMPLETED") ||
        (claim.type === "return_rejected" && ret.status !== "REJECTED") ||
        (claim.type === "exchange_completed" && ret.status !== "EXCHANGE_COMPLETED"))
      return { status: "skipped", reason: "decision_superseded" };
    const [buyer, merchant, preferences] = await Promise.all([
      this.prisma.buyerAccount.findUnique({ where: { globalUserId: ret.buyerId }, select: { email: true, phone: true, displayName: true } }),
      this.prisma.merchant.findUnique({ where: { id: claim.merchantId }, select: { name: true, storeSlug: true } }),
      this.prisma.buyerPreference.findUnique({ where: { globalUserId: ret.buyerId }, select: { emailOptIn: true, whatsappOptIn: true } }),
    ]);
    if (!buyer || !merchant) return { status: "skipped", reason: "recipient_removed" };
    // Fixtures must never send to a real provider, even on an environment with credentials.
    if (/@(?:example\.test|example\.invalid)$/i.test(buyer.email)) return { status: "skipped", reason: "test_recipient" };
    if (claim.channel === "email" && preferences?.emailOptIn === false) return { status: "skipped", reason: "email_opted_out" };
    if (claim.channel === "whatsapp" && preferences?.whatsappOptIn !== true) return { status: "skipped", reason: "whatsapp_permission_missing" };
    if (!merchant.storeSlug) return { status: "waiting_configuration", reason: "storefront_slug_unavailable" };
    const base = new URL(process.env.PUBLIC_STOREFRONT_URL || "https://storefront.zyon-payments.com.br");
    if (base.protocol !== "https:" || base.username || base.password) return { status: "waiting_configuration", reason: "storefront_url_invalid" };
    const link = new URL(`/store/${encodeURIComponent(merchant.storeSlug)}`, base);
    link.searchParams.set("supportTicket", claim.ticketId);
    await this.lifecycle.ensure(claim.merchantId, claim.type);
    const template = await this.templates.findByMerchantAndType(claim.merchantId, claim.type, claim.channel);
    if (!template || template.merchantId !== claim.merchantId || template.type !== claim.type || template.channel !== claim.channel)
      return { status: "waiting_configuration", reason: "notification_template_unavailable" };
    if (!template.isActive) return { status: "skipped", reason: "notification_template_disabled" };
    const variables: Record<string, string> = { buyerName: buyer.displayName || "Cliente", storeName: merchant.name,
      orderId: claim.payload.orderId, productName: claim.payload.items.map(item => `${item.quantity} × ${item.name}`).join(", "),
      decisionReason: claim.payload.explanation, link: link.href };
    const renderText = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => variables[name] ?? "");
    if (claim.channel === "email") {
      const content = renderReturnDecisionEmail({ ...claim.payload, type: claim.type, buyerName: variables.buyerName,
        storeName: merchant.name, link: link.href, customSubject: template.subject ? renderText(template.subject) : undefined,
        customBody: template.body === salesDefaults(claim.type).email.body ? undefined : renderText(template.body) });
      return { send: async () => {
        try {
          const sent = await this.email.send({ ...content, to: buyer.email, merchantId: claim.merchantId,
            requireDelivery: true, idempotencyKey: `${claim.id}:return-email` });
          if (sent.status === "skipped" && !sent.messageId) return { status: "waiting_configuration", reason: "email_provider_unavailable" };
          if ((sent.status === "sent" || sent.status === "queued") && sent.messageId?.trim()) return { status: "accepted", providerMessageId: sent.messageId };
          return { status: "unknown", reason: "email_acceptance_unknown" };
        } catch (error) {
          if (error instanceof EmailProviderRejection) return { status: error.retryable ? "retryable_failed" : "failed", reason: error.code };
          return { status: "unknown", reason: "email_acceptance_unknown" };
        }
      } };
    }
    if (claim.channel !== "whatsapp") return { status: "skipped", reason: "unsupported_channel" };
    const recipient = buyer.phone ? normalizeRecoveryRecipient(buyer.phone) : null;
    if (!recipient) return { status: "skipped", reason: "buyer_phone_unavailable" };
    const connection = connectedMetaCloudRecoveryCredentials(await this.config.findByMerchantId(claim.merchantId), claim.merchantId);
    if (!connection) return { status: "waiting_configuration", reason: "merchant_whatsapp_not_connected" };
    if (!isApprovedSalesTemplate(template, claim.merchantId, claim.type, connection.wabaId)) {
      if (template.metaStatus === "rejected") return { status: "failed", reason: "whatsapp_template_rejected" };
      return { status: "waiting_template", reason: "whatsapp_template_approval_pending" };
    }
    const slots = Object.values(template.metaVariableMap ?? {});
    if (!["orderId", "productName", "decisionReason", "link"].every(name => slots.includes(name))) return { status: "failed", reason: "notification_template_variable_missing" };
    const contentVariables: Record<string, string> = {};
    for (const [position, name] of Object.entries(template.metaVariableMap ?? {})) {
      const value = variables[name];
      if (!value?.trim()) return { status: "failed", reason: "notification_template_variable_missing" };
      // Meta BODY parameters must be single-line. Full details remain in the email and conversation.
      contentVariables[position] = value.replace(/\s+/g, " ").trim().slice(0, name === "decisionReason" ? 400 : 900);
    }
    return { send: async () => {
      try {
        const sent = await this.whatsapp.sendTemplate({ merchantId: claim.merchantId, type: claim.type,
          toNumber: recipient, contentSid: template.twilioContentSid, language: template.metaLanguage ?? "pt_BR", contentVariables });
        if ((sent.status === "sent" || sent.status === "queued") && sent.messageId?.trim()) return { status: "accepted", providerMessageId: sent.messageId };
        if (sent.status === "skipped" && !sent.messageId) return { status: "waiting_template", reason: "whatsapp_dispatch_not_authorized" };
        if (sent.status === "failed" && sent.acceptance === "not_accepted" && !sent.messageId) return { status: "failed", reason: "whatsapp_provider_rejected" };
        return { status: "unknown", reason: "whatsapp_acceptance_unknown" };
      } catch { return { status: "unknown", reason: "whatsapp_acceptance_unknown" }; }
    } };
  }
}
