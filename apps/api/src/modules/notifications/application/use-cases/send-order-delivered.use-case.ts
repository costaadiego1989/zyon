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
    // Email notification
    if (event.buyerEmail) {
      const html = renderOrderDeliveredTemplate(event);
      await this.emailSender.send({
        to: event.buyerEmail,
        subject: `✅ Seu pedido foi entregue!`,
        html,
        requireDelivery: true,
      });
    } else {
      this.logger.warn(`Skipping delivered email for order ${event.orderId}: no buyer email`);
    }

    // WhatsApp notification — safe template path when available.
    if (event.buyerPhone) {
      const freeformText = renderOrderDeliveredWhatsApp(event);
      if (this.sendWhatsApp) {
        await this.sendWhatsApp.execute({
          merchantId: event.merchantId,
          type: "order_delivered",
          toPhone: event.buyerPhone,
          variables: { buyerName: event.buyerName, orderId: event.orderId },
          freeformText,
        });
      } else {
        await this.whatsappSender.send({ phone: event.buyerPhone, message: freeformText });
      }
    }
  }
}
