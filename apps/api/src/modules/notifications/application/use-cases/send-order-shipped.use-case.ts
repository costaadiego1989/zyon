import { Injectable, Inject, Logger } from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { WHATSAPP_SENDER_PORT, WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import { OrderShippedEvent } from "../../domain/events/notification.events.js";
import { renderOrderShippedTemplate, renderOrderShippedWhatsApp } from "../../infrastructure/templates/order-shipped.template.js";

@Injectable()
export class SendOrderShippedUseCase {
  private readonly logger = new Logger(SendOrderShippedUseCase.name);

  constructor(
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    @Inject(WHATSAPP_SENDER_PORT) private readonly whatsappSender: WhatsAppSenderPort,
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

    // WhatsApp notification
    if (event.buyerPhone) {
      await this.whatsappSender.send({
        phone: event.buyerPhone,
        message: renderOrderShippedWhatsApp(event),
      });
    }
  }
}
