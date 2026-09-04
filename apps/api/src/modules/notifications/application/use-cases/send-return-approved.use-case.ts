import { Injectable, Inject , Logger} from "@nestjs/common";
import { EMAIL_SENDER_PORT, EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { ReturnApprovedEvent } from "../../domain/events/notification.events.js";
import { renderReturnApprovedTemplate } from "../../infrastructure/templates/return-approved.template.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class SendReturnApprovedUseCase {
  private readonly logger = new Logger(SendReturnApprovedUseCase.name);

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
