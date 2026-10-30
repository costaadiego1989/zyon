import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { WHATSAPP_SENDER_PORT, WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import { OrderShippedEvent } from "../../domain/events/notification.events.js";
import { renderOrderShippedTemplate, renderOrderShippedWhatsApp } from "../../infrastructure/templates/order-shipped.template.js";
import { NOTIFICATION_WHATSAPP_SENDER, type NotificationWhatsAppSender } from "../ports/notification-whatsapp-sender.port.js";

@Injectable()
export class SendOrderShippedUseCase {
  private readonly logger = new Logger(SendOrderShippedUseCase.name);

  constructor(
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    @Inject(WHATSAPP_SENDER_PORT) private readonly whatsappSender: WhatsAppSenderPort,
    @Optional() @Inject(NOTIFICATION_WHATSAPP_SENDER)
    private readonly sendWhatsApp?: NotificationWhatsAppSender,
  ) {}

  async execute(event: OrderShippedEvent): Promise<void> {
    const deliveries: Promise<unknown>[] = [];
    if (event.buyerEmail) {
      const html = renderOrderShippedTemplate(event);
      deliveries.push(Promise.resolve().then(() => this.emailSender.send({
        to: event.buyerEmail,
        merchantId: event.merchantId,
        subject: `Zyon | Pedido #${event.orderId} enviado`,
        html,
        requireDelivery: true,
        idempotencyKey: `order-shipped:${event.merchantId}:${event.orderId}:${event.trackingNumber ?? ""}:buyer-email`,
      })));
    } else {
      this.logger.warn(`Skipping shipped email for order ${event.orderId}: no buyer email`);
    }

    if (event.buyerPhone) {
      const buyerPhone = event.buyerPhone;
      const freeformText = renderOrderShippedWhatsApp(event);
      deliveries.push(Promise.resolve().then(async () => {
        if (this.sendWhatsApp) {
          const result = await this.sendWhatsApp.execute({
            merchantId: event.merchantId,
            orderId: event.orderId,
            idempotencyKey: `${event.orderId}:${event.trackingNumber ?? ""}`,
            type: "order_shipped",
            toPhone: buyerPhone,
            variables: { buyerName: event.buyerName, orderId: event.orderId, trackingCode: event.trackingNumber },
            freeformText,
          });
          if (result.status !== "accepted") this.logger.warn(`order_shipped_whatsapp_${result.status} reason=${result.reason ?? "unconfirmed"}`);
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
