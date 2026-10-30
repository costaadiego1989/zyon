import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { WHATSAPP_SENDER_PORT, WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import { OrderDeliveredEvent } from "../../domain/events/notification.events.js";
import { renderOrderDeliveredTemplate, renderOrderDeliveredWhatsApp } from "../../infrastructure/templates/order-delivered.template.js";
import { NOTIFICATION_WHATSAPP_SENDER, type NotificationWhatsAppSender } from "../ports/notification-whatsapp-sender.port.js";

@Injectable()
export class SendOrderDeliveredUseCase {
  private readonly logger = new Logger(SendOrderDeliveredUseCase.name);

  constructor(
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    @Inject(WHATSAPP_SENDER_PORT) private readonly whatsappSender: WhatsAppSenderPort,
    @Optional() @Inject(NOTIFICATION_WHATSAPP_SENDER)
    private readonly sendWhatsApp?: NotificationWhatsAppSender,
  ) {}

  async execute(event: OrderDeliveredEvent): Promise<void> {
    const deliveries: Promise<unknown>[] = [];
    if (event.buyerEmail) {
      const html = renderOrderDeliveredTemplate(event);
      deliveries.push(Promise.resolve().then(() => this.emailSender.send({
        to: event.buyerEmail,
        merchantId: event.merchantId,
        subject: `Zyon | Pedido #${event.orderId} entregue`,
        html,
        requireDelivery: true,
        idempotencyKey: `order-delivered:${event.merchantId}:${event.orderId}:buyer-email`,
      })));
    } else {
      this.logger.warn(`Skipping delivered email for order ${event.orderId}: no buyer email`);
    }

    if (event.buyerPhone) {
      const buyerPhone = event.buyerPhone;
      const freeformText = renderOrderDeliveredWhatsApp(event);
      deliveries.push(Promise.resolve().then(async () => {
        if (this.sendWhatsApp) {
          const result = await this.sendWhatsApp.execute({
            merchantId: event.merchantId,
            orderId: event.orderId,
            idempotencyKey: event.orderId,
            type: "order_delivered",
            toPhone: buyerPhone,
            variables: { buyerName: event.buyerName, orderId: event.orderId },
            freeformText,
          });
          if (result.status !== "accepted") this.logger.warn(`order_delivered_whatsapp_${result.status} reason=${result.reason ?? "unconfirmed"}`);
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
