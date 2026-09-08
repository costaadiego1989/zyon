import { Inject, Injectable, Logger } from "@nestjs/common";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import { MERCHANT_NOTIFICATION_INBOX_PORT, type MerchantNotificationInboxPort } from "../../domain/ports/merchant-notification-inbox.port.js";
import type { OrderConfirmationEvent } from "../../domain/events/notification.events.js";
import { renderMerchantOrderEmail, renderMerchantOrderWhatsApp } from "../../infrastructure/templates/merchant-order-notification.template.js";

@Injectable()
export class SendMerchantOrderNotificationUseCase {
  private readonly logger = new Logger(SendMerchantOrderNotificationUseCase.name);

  constructor(
    @Inject(MERCHANT_NOTIFICATION_INBOX_PORT) private readonly inbox: MerchantNotificationInboxPort,
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    @Inject(WHATSAPP_SENDER_PORT) private readonly whatsappSender: WhatsAppSenderPort,
  ) {}

  async execute(event: OrderConfirmationEvent): Promise<void> {
    const contact = await this.inbox.getContact(event.merchantId);
    const merchantName = event.merchantName || contact?.merchantName || "sua loja";
    const buyerName = event.buyerName?.trim() || event.buyerEmail || event.buyerPhone || "Cliente";
    const title = `Novo pedido #${event.orderNumber}`;
    const body = `${buyerName} concluiu uma compra de ${formatCurrency(event.total, event.currency)} em ${merchantName}.`;

    const deliveries: Array<{ channel: string; send: () => Promise<unknown> }> = [
      {
        channel: "dashboard",
        send: () => this.inbox.create({
          merchantId: event.merchantId,
          type: "order_paid",
          title,
          body,
          metadata: {
            orderId: event.orderId,
            orderNumber: event.orderNumber,
            buyerName: event.buyerName ?? null,
            buyerEmail: event.buyerEmail || null,
            buyerPhone: event.buyerPhone ?? null,
            total: event.total,
            currency: event.currency ?? "BRL",
            items: event.items,
          },
        }),
      },
    ];

    const toEmail = contact?.supportEmail || contact?.ownerEmail;
    if (toEmail) {
      deliveries.push({
        channel: "email",
        send: () => this.emailSender.send({
          to: toEmail,
          subject: `${merchantName} - novo pedido #${event.orderNumber}`,
          html: renderMerchantOrderEmail({ ...event, merchantName }),
          requireDelivery: true,
        }),
      });
    } else {
      this.logger.warn(`Skipping merchant order email for ${event.orderNumber}: no merchant email`);
    }

    const merchantWhatsApp = contact?.whatsappConnected ? contact.whatsappPhone : undefined;
    if (merchantWhatsApp) {
      deliveries.push({
        channel: "whatsapp",
        send: () => this.whatsappSender.send({
          phone: merchantWhatsApp,
          message: renderMerchantOrderWhatsApp({ ...event, merchantName }),
        }),
      });
    }

    const results = await Promise.allSettled(deliveries.map(({ send }) => send()));
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.logger.error(`Merchant order notification ${deliveries[index].channel} failed for ${event.orderNumber}: ${reason}`);
      }
    }
  }
}

function formatCurrency(total: string, currency = "BRL") {
  const amount = Number(total);
  if (!Number.isFinite(amount)) return total;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(amount);
}
