/**
 * Send WhatsApp Response — outbound message via BubbleWhats.
 */

import { Injectable, Inject, Logger } from "@nestjs/common";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";

export interface SendResponseInput {
  merchantId: string;
  deviceId: string;
  toNumber: string;
  text: string;
  mediaUrl?: string;
  mimetype?: string;
}

@Injectable()
export class SendWhatsAppResponseUseCase {
  private readonly logger = new Logger(SendWhatsAppResponseUseCase.name);

  constructor(
    @Inject(WHATSAPP_SENDER_PORT)
    private readonly sender: WhatsAppSenderPort,
  ) {}

  async execute(input: SendResponseInput): Promise<void> {
    try {
      const result = await this.sender.sendText({
        toNumber: input.toNumber,
        deviceId: input.deviceId,
        text: input.text,
        mediaUrl: input.mediaUrl,
        mimetype: input.mimetype,
      });

      this.logger.debug(
        `WA sent to ${input.toNumber}: status=${result.status}, id=${result.messageId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send WA message to ${input.toNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
