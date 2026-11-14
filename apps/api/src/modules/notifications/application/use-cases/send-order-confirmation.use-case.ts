import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { WHATSAPP_SENDER_PORT, WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import { OrderConfirmationEvent } from "../../domain/events/notification.events.js";
import { renderOrderConfirmationTemplate, renderOrderConfirmationWhatsApp } from "../../infrastructure/templates/order-confirmation.template.js";
import { NOTIFICATION_WHATSAPP_SENDER, type NotificationWhatsAppSender } from "../ports/notification-whatsapp-sender.port.js";
import { PAID_ORDER_RECEIPT_READER, type PaidOrderReceiptReader, type OrderReceiptDeliveryOptions } from "../ports/paid-order-receipt-reader.port.js";
import { formatReceiptMoney, receiptSummaryLines } from "../../domain/paid-order-receipt.js";

@Injectable()
export class SendOrderConfirmationUseCase {
  private readonly logger = new Logger(SendOrderConfirmationUseCase.name);

  constructor(
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    @Inject(WHATSAPP_SENDER_PORT) private readonly whatsappSender: WhatsAppSenderPort,
    @Optional() @Inject(NOTIFICATION_WHATSAPP_SENDER)
    private readonly sendWhatsApp?: NotificationWhatsAppSender,
    @Optional() @Inject(PAID_ORDER_RECEIPT_READER) private readonly receipts?: PaidOrderReceiptReader,
  ) {}

  async execute(event: OrderConfirmationEvent, options: OrderReceiptDeliveryOptions = {}): Promise<void> {
    if (this.receipts) {
      const canonical = await this.receipts.read({ merchantId: event.merchantId, externalOrderId: event.orderId });
      if (!canonical || canonical.merchantId !== event.merchantId || canonical.orderId !== event.orderId) throw new Error("order_receipt_scope_unavailable");
      event = canonical;
    }
    const deliveries: Promise<unknown>[] = [];
    // Independent channels: an email rejection must not suppress WhatsApp.
    if (event.buyerEmail) {
      const html = renderOrderConfirmationTemplate(event);
      deliveries.push(Promise.resolve().then(() => this.emailSender.send({
        to: event.buyerEmail,
        merchantId: event.merchantId,
        subject: event.merchantName
          ? `${event.merchantName} | Pedido #${event.orderNumber} confirmado`.replace(/[\r\n]/g, " ")
          : `Zyon | Pedido #${event.orderNumber} confirmado`.replace(/[\r\n]/g, " "),
        html,
        requireDelivery: true,
        idempotencyKey: `${options.idempotencyPurpose ?? "order-confirmation"}:${event.merchantId}:${event.orderId}:buyer-email`,
      })));
    } else {
      this.logger.warn(`Skipping confirmation email for order ${event.orderNumber}: no buyer email`);
    }

    if (event.buyerPhone) {
      const buyerPhone = event.buyerPhone;
      const freeformText = renderOrderConfirmationWhatsApp(event);
      deliveries.push(Promise.resolve().then(async () => {
        if (this.sendWhatsApp) {
          if (event.paidReceipt) {
            // The canonical paid event authorizes the animation. Optional
            // media is first, and a media failure never suppresses the receipt.
            try {
              const animation = await this.sendWhatsApp.execute({ merchantId: event.merchantId, orderId: event.orderId,
                idempotencyKey: event.orderId, type: "order_paid_animation", toPhone: buyerPhone });
              if (animation.status !== "accepted") this.logger.warn(`order_paid_animation_${animation.status} reason=${animation.reason ?? "unconfirmed"}`);
            } catch { this.logger.warn("order_paid_animation_failed"); }
          }
          const result = await this.sendWhatsApp.execute({
            merchantId: event.merchantId,
            orderId: event.orderId,
            idempotencyKey: options.idempotencyPurpose ?? event.orderId,
            type: event.items.length && event.items.every(item => item.productType === "digital" || item.productType === "service") ? "order_nonphysical_confirmation" : "order_confirmation",
            toPhone: buyerPhone,
            variables: { buyerName: event.buyerName, orderId: event.orderNumber, storeName: event.merchantName,
              ...(event.paidReceipt ? { total: formatReceiptMoney(event.paidReceipt.totalPaidCents, event.paidReceipt.currency),
                amount: formatReceiptMoney(event.paidReceipt.totalPaidCents, event.paidReceipt.currency),
                totalPaid: formatReceiptMoney(event.paidReceipt.totalPaidCents, event.paidReceipt.currency),
                receiptSummary: receiptSummaryLines(event.paidReceipt).join("\n") } : {}) },
            freeformText,
          });
          if (result.status !== "accepted") this.logger.warn(`order_confirmation_whatsapp_${result.status} reason=${result.reason ?? "unconfirmed"}`);
        } else {
          await this.whatsappSender.send({ phone: buyerPhone, message: freeformText });
        }
      }));
    }
    const results = await Promise.allSettled(deliveries);
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}
