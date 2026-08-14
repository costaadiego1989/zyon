import { Injectable, Inject } from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { ReturnApprovedEvent } from "../../domain/events/notification.events.js";
import { renderReturnApprovedTemplate } from "../../infrastructure/templates/return-approved.template.js";

@Injectable()
export class SendReturnApprovedUseCase {
  constructor(@Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort) {}

  async execute(event: ReturnApprovedEvent): Promise<void> {
    const html = renderReturnApprovedTemplate(event);

    await this.emailSender.send({
      to: event.buyerEmail,
      subject: `Sua Devolução Foi Aprovada`,
      html,
    });
  }
}
