import { Injectable, Inject } from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { OrderShippedEvent } from "../../domain/events/notification.events.js";
import { renderOrderShippedTemplate } from "../../infrastructure/templates/order-shipped.template.js";

@Injectable()
export class SendOrderShippedUseCase {
  constructor(@Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort) {}

  async execute(event: OrderShippedEvent): Promise<void> {
    const html = renderOrderShippedTemplate(event);

    await this.emailSender.send({
      to: event.buyerEmail,
      subject: `Seu Pedido Foi Enviado - Rastreie Aqui`,
      html,
    });
  }
}
