import { Injectable, Inject } from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { OrderDeliveredEvent } from "../../domain/events/notification.events.js";
import { renderOrderDeliveredTemplate } from "../../infrastructure/templates/order-delivered.template.js";

@Injectable()
export class SendOrderDeliveredUseCase {
  constructor(@Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort) {}

  async execute(event: OrderDeliveredEvent): Promise<void> {
    const html = renderOrderDeliveredTemplate(event);

    await this.emailSender.send({
      to: event.buyerEmail,
      subject: `Seu Pedido Foi Entregue!`,
      html,
    });
  }
}
