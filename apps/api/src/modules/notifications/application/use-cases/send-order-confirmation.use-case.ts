import { Injectable, Inject } from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { OrderConfirmationEvent } from "../../domain/events/notification.events.js";
import { renderOrderConfirmationTemplate } from "../../infrastructure/templates/order-confirmation.template.js";

@Injectable()
export class SendOrderConfirmationUseCase {
  constructor(@Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort) {}

  async execute(event: OrderConfirmationEvent): Promise<void> {
    const html = renderOrderConfirmationTemplate(event);
    const buyerName = event.buyerName || "Cliente";

    await this.emailSender.send({
      to: event.buyerEmail,
      subject: `Pedido #${event.orderNumber} Confirmado`,
      html,
    });
  }
}
