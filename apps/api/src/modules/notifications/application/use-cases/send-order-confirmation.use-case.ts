import { Injectable, Inject, Logger } from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { WHATSAPP_SENDER_PORT, WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import { OrderConfirmationEvent } from "../../domain/events/notification.events.js";
import { renderOrderConfirmationTemplate, renderOrderConfirmationWhatsApp } from "../../infrastructure/templates/order-confirmation.template.js";

@Injectable()
export class SendOrderConfirmationUseCase {
  private readonly logger = new Logger(SendOrderConfirmationUseCase.name);

  constructor(
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    @Inject(WHATSAPP_SENDER_PORT) private readonly whatsappSender: WhatsAppSenderPort,
  ) {}

  async execute(event: OrderConfirmationEvent): Promise<void> {
    // Email notification
    if (event.buyerEmail) {
      const html = renderOrderConfirmationTemplate(event);
      await this.emailSender.send({
        to: event.buyerEmail,
        subject: `✅ Pedido #${event.orderNumber} confirmado — estamos preparando!`,
        html,
      });
    } else {
      this.logger.warn(`Skipping confirmation email for order ${event.orderNumber}: no buyer email`);
    }

    // WhatsApp notification
    if (event.buyerPhone) {
      await this.whatsappSender.send({
        phone: event.buyerPhone,
        message: renderOrderConfirmationWhatsApp(event),
      });
    }
  }
}
