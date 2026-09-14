import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { WHATSAPP_TEMPLATE_SENDER, type WhatsAppTemplateSenderPort } from "../../../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import type {
  OrderQuotaNotice,
  OrderQuotaNoticeSender,
  PreparedQuotaDelivery,
  QuotaDeliveryResult,
} from "../../domain/ports/order-quota-notice.port.js";
import { renderOrderQuotaNoticeEmail, quotaNoticeTemplateVariables } from "../templates/order-quota-notice.template.js";

/** Prepares only channels that have a merchant-owned recipient and configuration. */
@Injectable()
export class OrderQuotaNoticeSenderAdapter implements OrderQuotaNoticeSender {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EMAIL_SENDER_PORT) private readonly email: EmailSenderPort,
    @Inject(WHATSAPP_TEMPLATE_SENDER) private readonly whatsapp: WhatsAppTemplateSenderPort,
  ) {}

  async prepare(notice: OrderQuotaNotice, channel: string): Promise<PreparedQuotaDelivery> {
    if (channel === "email") return this.prepareEmail(notice);
    if (channel === "whatsapp") return this.prepareWhatsApp(notice);
    return { status: "skipped", reason: "unsupported_channel" };
  }

  private async prepareEmail(notice: OrderQuotaNotice): Promise<PreparedQuotaDelivery> {
    const [merchant, recipient] = await Promise.all([
      this.prisma.merchant.findUnique({ where: { id: notice.merchantId }, select: { name: true } }),
      this.prisma.merchantUser.findFirst({
        where: { merchantId: notice.merchantId, disabledAt: null, role: { in: ["owner", "admin"] } },
        orderBy: { createdAt: "asc" }, select: { email: true },
      }),
    ]);
    if (!merchant || !recipient?.email.trim()) return skipped("merchant_email_unavailable");
    const template = renderOrderQuotaNoticeEmail(notice, merchant.name);
    return {
      send: async () => {
        const sent = await this.email.send({ to: recipient.email, ...template, requireDelivery: true });
        return sent.status === "skipped"
          ? skipped("email_provider_unavailable")
          : { status: "accepted", providerMessageId: sent.messageId };
      },
    };
  }

  private async prepareWhatsApp(notice: OrderQuotaNotice): Promise<PreparedQuotaDelivery> {
    const [merchant, connection, template] = await Promise.all([
      this.prisma.merchant.findUnique({
        where: { id: notice.merchantId }, select: { name: true, budgetWhatsapp: true, storeSettings: true },
      }),
      this.prisma.whatsAppChannelConfig.findUnique({ where: { merchantId: notice.merchantId } }),
      this.prisma.postSaleMessageTemplate.findUnique({
        where: { merchantId_type_channel: { merchantId: notice.merchantId, type: "order_quota", channel: "whatsapp" } },
      }),
    ]);
    const phone = merchant ? merchantPhone(merchant.budgetWhatsapp, merchant.storeSettings) : undefined;
    if (!merchant || !phone) return skipped("merchant_whatsapp_recipient_unavailable");
    if (!connection || !connection.enabled || connection.status !== "ACTIVE" || connection.provider !== "META_CLOUD") {
      return skipped("merchant_whatsapp_not_integrated");
    }
    if (!template?.isActive || template.metaStatus !== "approved" || !template.twilioContentSid?.trim()) {
      return skipped("merchant_whatsapp_template_unavailable");
    }
    return {
      send: async () => {
        const result = await this.whatsapp.sendTemplate({
          merchantId: notice.merchantId,
          type: "order_quota",
          toNumber: phone,
          contentSid: template.twilioContentSid!,
          language: template.metaLanguage ?? "pt_BR",
          contentVariables: quotaNoticeTemplateVariables(notice, merchant.name),
        });
        if (result.status === "sent" || result.status === "queued") {
          return { status: "accepted", providerMessageId: result.messageId };
        }
        if (result.status === "uncertain") return { status: "unknown", reason: result.reason };
        if (result.status === "failed") return { status: "failed", reason: result.reason };
        return skipped(result.reason ?? "merchant_whatsapp_template_unavailable");
      },
    };
  }
}

function skipped(reason: string): QuotaDeliveryResult {
  return { status: "skipped", reason };
}

function merchantPhone(budgetWhatsapp: string | null, settings: unknown): string | undefined {
  if (budgetWhatsapp?.trim()) return budgetWhatsapp.trim();
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return undefined;
  const company = (settings as { company?: unknown }).company;
  if (!company || typeof company !== "object" || Array.isArray(company)) return undefined;
  const phone = (company as { phone?: unknown }).phone;
  return typeof phone === "string" && phone.trim() ? phone.trim() : undefined;
}
