/**
 * Send WhatsApp Response — outbound message via BubbleWhats.
 */

import { Injectable, Inject, Logger } from "@nestjs/common";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";

export interface SendResponseInput {
  provider?: string;
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
        provider: input.provider,
        toNumber: input.toNumber,
        deviceId: input.deviceId,
        text: input.text,
        mediaUrl: input.mediaUrl,
        mimetype: input.mimetype,
      });

      if (result.status !== "sent" && result.status !== "queued") {
        throw new Error("whatsapp_send_failed");
      }

      this.logger.debug(
        `whatsapp_send_status status=${result.status}`,
      );
    } catch (error) {
      this.logger.error(
        "whatsapp_send_failed",
      );
      throw error;
    }
  }
}
