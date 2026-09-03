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
    // Email notification
    if (event.buyerEmail) {
      const html = renderOrderShippedTemplate(event);
      await this.emailSender.send({
        to: event.buyerEmail,
        subject: `📦 Seu pedido está a caminho!`,
        html,
      });
    } else {
      this.logger.warn(`Skipping shipped email for order ${event.orderId}: no buyer email`);
    }

    // WhatsApp notification — safe template path when available.
    if (event.buyerPhone) {
      const freeformText = renderOrderShippedWhatsApp(event);
      if (this.sendWhatsApp) {
        await this.sendWhatsApp.execute({
          merchantId: event.merchantId,
          type: "order_shipped",
          toPhone: event.buyerPhone,
          variables: { buyerName: event.buyerName, orderId: event.orderId, trackingCode: event.trackingNumber },
          freeformText,
        });
      } else {
        await this.whatsappSender.send({ phone: event.buyerPhone, message: freeformText });
      }
    }
  }
}
