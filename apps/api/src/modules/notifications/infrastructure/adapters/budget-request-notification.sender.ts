import { Inject, Injectable } from "@nestjs/common";
import { EmailProviderRejection } from "../../domain/ports/email-provider-rejection.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { MERCHANT_NOTIFICATION_INBOX_PORT, type MerchantNotificationInboxPort } from "../../domain/ports/merchant-notification-inbox.port.js";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import type { QuotaDeliveryResult } from "../../domain/ports/order-quota-notice.port.js";
import { renderMerchantBudgetEmail, renderMerchantBudgetWhatsApp, type MerchantBudgetNotification } from "../templates/budget-request-notification.template.js";

export type PreparedBudgetRequestDelivery = QuotaDeliveryResult | { send(): Promise<QuotaDeliveryResult> };

@Injectable()
export class BudgetRequestNotificationSender {
  constructor(
    @Inject(MERCHANT_NOTIFICATION_INBOX_PORT) private readonly inbox: MerchantNotificationInboxPort,
    @Inject(EMAIL_SENDER_PORT) private readonly email: EmailSenderPort,
    @Inject(WHATSAPP_SENDER_PORT) private readonly whatsapp: WhatsAppSenderPort,
  ) {}

  async prepare(request: MerchantBudgetNotification & { merchantId: string }, channel: string): Promise<PreparedBudgetRequestDelivery> {
    const contact = await this.inbox.getContact(request.merchantId);
    if (!contact) return { status: "skipped", reason: "merchant_removed" };
    const notification = { ...request, merchantName: contact.merchantName || request.merchantName };
    if (channel === "email") return this.prepareEmail(notification, contact.budgetEmail || contact.supportEmail || contact.ownerEmail);
    if (channel === "whatsapp") return this.prepareWhatsApp(notification, contact.budgetWhatsapp, contact.whatsappConnected);
    return { status: "skipped", reason: "unsupported_channel" };
  }

  private prepareEmail(request: MerchantBudgetNotification & { merchantId: string }, recipient?: string): PreparedBudgetRequestDelivery {
    if (!recipient?.trim()) return { status: "skipped", reason: "merchant_budget_email_unavailable" };
    const content = renderMerchantBudgetEmail(request);
    return {
      send: async () => {
        try {
          const sent = await this.email.send({
            to: recipient,
            ...content,
            merchantId: request.merchantId,
            requireDelivery: true,
            idempotencyKey: `${request.id}:budget-email`,
          });
          if (sent.status === "skipped" || !sent.messageId.trim()) return { status: "skipped", reason: "email_provider_unavailable" };
          return { status: "accepted", providerMessageId: sent.messageId };
        } catch (error) {
          if (error instanceof EmailProviderRejection) return { status: error.retryable ? "retryable_failed" : "failed", reason: error.code };
          return { status: "unknown", reason: "email_acceptance_unknown" };
        }
      },
    };
  }

  private prepareWhatsApp(request: MerchantBudgetNotification, recipient: string | undefined, connected: boolean): PreparedBudgetRequestDelivery {
    if (!recipient?.trim()) return { status: "skipped", reason: "merchant_budget_whatsapp_unavailable" };
    if (!connected) return { status: "skipped", reason: "merchant_whatsapp_not_connected" };
    const message = renderMerchantBudgetWhatsApp(request);
    return {
      send: async () => {
        try {
          const sent = await this.whatsapp.send({ phone: recipient, message });
          if (sent?.status === "accepted") return { status: "accepted" };
          if (sent?.status === "skipped") return { status: "skipped", reason: `whatsapp_${sent.reason}` };
          return { status: "unknown", reason: "whatsapp_acceptance_unknown" };
        } catch {
          return { status: "unknown", reason: "whatsapp_acceptance_unknown" };
        }
      },
    };
  }
}
