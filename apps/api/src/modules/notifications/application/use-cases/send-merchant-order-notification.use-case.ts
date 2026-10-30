import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { NOTIFICATION_WHATSAPP_SENDER, type NotificationWhatsAppSender } from "../ports/notification-whatsapp-sender.port.js";
import { MERCHANT_NOTIFICATION_INBOX_PORT, type MerchantNotificationInboxPort } from "../../domain/ports/merchant-notification-inbox.port.js";
import type { OrderConfirmationEvent } from "../../domain/events/notification.events.js";
import { renderMerchantOrderEmail, renderMerchantOrderWhatsApp } from "../../infrastructure/templates/merchant-order-notification.template.js";
import { PAID_ORDER_RECEIPT_READER, type PaidOrderReceiptReader, type OrderReceiptDeliveryOptions } from "../ports/paid-order-receipt-reader.port.js";
import { receiptTotalFormatted } from "../../infrastructure/templates/paid-order-receipt.template.js";

@Injectable()
export class SendMerchantOrderNotificationUseCase {
  private readonly logger = new Logger(SendMerchantOrderNotificationUseCase.name);

  constructor(
    @Inject(MERCHANT_NOTIFICATION_INBOX_PORT) private readonly inbox: MerchantNotificationInboxPort,
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    @Inject(NOTIFICATION_WHATSAPP_SENDER) private readonly whatsappSender: NotificationWhatsAppSender,
    @Optional() @Inject(PAID_ORDER_RECEIPT_READER) private readonly receipts?: PaidOrderReceiptReader,
  ) {}

  async execute(event: OrderConfirmationEvent, options: OrderReceiptDeliveryOptions = {}): Promise<void> {
    if (this.receipts) {
      const canonical = await this.receipts.read({ merchantId: event.merchantId, externalOrderId: event.orderId });
      if (!canonical || canonical.merchantId !== event.merchantId || canonical.orderId !== event.orderId) throw new Error("order_receipt_scope_unavailable");
      event = canonical;
    }
    const contact = await this.inbox.getContact(event.merchantId);
    const merchantName = event.merchantName || contact?.merchantName || "sua loja";
    const buyerName = event.buyerName?.trim() || event.buyerEmail || event.buyerPhone || "Cliente";
    const title = `Novo pedido #${event.orderNumber}`;
    const body = `${buyerName} concluiu uma compra de ${receiptTotalFormatted(event)} em ${merchantName}.`;

    const deliveries: Array<{ channel: string; send: () => Promise<unknown> }> = options.skipDashboard ? [] : [
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
            ...(event.paidReceipt ? { paidReceipt: event.paidReceipt } : {}),
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
          merchantId: event.merchantId,
          subject: `${merchantName} | Novo pedido #${event.orderNumber}`,
          html: renderMerchantOrderEmail({ ...event, merchantName }),
          requireDelivery: true,
          idempotencyKey: `${options.idempotencyPurpose ?? "order-confirmation"}:${event.merchantId}:${event.orderId}:merchant-email`,
        }),
      });
    } else {
      this.logger.warn(`Skipping merchant order email for ${event.orderNumber}: no merchant email`);
    }

    const merchantWhatsApp = contact?.whatsappConnected ? contact.whatsappPhone : undefined;
    if (merchantWhatsApp) {
      deliveries.push({
        channel: "whatsapp",
        send: async () => {
          const result = await this.whatsappSender.execute({
            merchantId: event.merchantId, orderId: event.orderId, idempotencyKey: options.idempotencyPurpose ?? event.orderId,
            type: "merchant_order_paid", toPhone: merchantWhatsApp,
            freeformText: renderMerchantOrderWhatsApp({ ...event, merchantName }),
          });
          if (result.status !== "accepted") this.logger.warn(`merchant_order_whatsapp_${result.status} reason=${result.reason ?? "unconfirmed"}`);
          return result;
        },
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
