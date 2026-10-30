import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { WHATSAPP_SENDER_PORT, WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import { OrderConfirmationEvent } from "../../domain/events/notification.events.js";
import { renderOrderConfirmationTemplate, renderOrderConfirmationWhatsApp } from "../../infrastructure/templates/order-confirmation.template.js";
import { NOTIFICATION_WHATSAPP_SENDER, type NotificationWhatsAppSender } from "../ports/notification-whatsapp-sender.port.js";

@Injectable()
export class SendOrderConfirmationUseCase {
  private readonly logger = new Logger(SendOrderConfirmationUseCase.name);

  constructor(
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    @Inject(WHATSAPP_SENDER_PORT) private readonly whatsappSender: WhatsAppSenderPort,
    @Optional() @Inject(NOTIFICATION_WHATSAPP_SENDER)
    private readonly sendWhatsApp?: NotificationWhatsAppSender,
  ) {}

  async execute(event: OrderConfirmationEvent): Promise<void> {
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
        idempotencyKey: `order-confirmation:${event.merchantId}:${event.orderId}:buyer-email`,
      })));
    } else {
      this.logger.warn(`Skipping confirmation email for order ${event.orderNumber}: no buyer email`);
    }

    if (event.buyerPhone) {
      const buyerPhone = event.buyerPhone;
      const freeformText = renderOrderConfirmationWhatsApp(event);
      deliveries.push(Promise.resolve().then(async () => {
        if (this.sendWhatsApp) {
          const result = await this.sendWhatsApp.execute({
            merchantId: event.merchantId,
            orderId: event.orderId,
            idempotencyKey: event.orderId,
            type: event.items.length && event.items.every(item => item.productType === "digital" || item.productType === "service") ? "order_nonphysical_confirmation" : "order_confirmation",
            toPhone: buyerPhone,
            variables: { buyerName: event.buyerName, orderId: event.orderNumber, storeName: event.merchantName },
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
