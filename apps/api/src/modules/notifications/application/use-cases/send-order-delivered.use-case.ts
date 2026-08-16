import { Injectable, Inject, Logger } from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { WHATSAPP_SENDER_PORT, WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import { OrderDeliveredEvent } from "../../domain/events/notification.events.js";
import { renderOrderDeliveredTemplate, renderOrderDeliveredWhatsApp } from "../../infrastructure/templates/order-delivered.template.js";

@Injectable()
export class SendOrderDeliveredUseCase {
  private readonly logger = new Logger(SendOrderDeliveredUseCase.name);

  constructor(
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    @Inject(WHATSAPP_SENDER_PORT) private readonly whatsappSender: WhatsAppSenderPort,
  ) {}

  async execute(event: OrderDeliveredEvent): Promise<void> {
    // Email notification
    if (event.buyerEmail) {
      const html = renderOrderDeliveredTemplate(event);
      await this.emailSender.send({
        to: event.buyerEmail,
        subject: `✅ Seu pedido foi entregue!`,
        html,
      });
    } else {
      this.logger.warn(`Skipping delivered email for order ${event.orderId}: no buyer email`);
    }

    // WhatsApp notification
    if (event.buyerPhone) {
      await this.whatsappSender.send({
        phone: event.buyerPhone,
        message: renderOrderDeliveredWhatsApp(event),
      });
    }
  }
}
