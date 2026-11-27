/**
 * Send WhatsApp Response — outbound message via BubbleWhats.
 */

import { WhatsAppDeliveryService } from "../services/whatsapp-delivery.service.js";
import { Injectable, Inject, Logger } from "@nestjs/common";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import { currentWhatsAppExecution, startWhatsAppRequest } from "../../../../shared/whatsapp/whatsapp-automation-context.js";

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
    private readonly delivery?: WhatsAppDeliveryService,
  ) {}

  async sendUi(input: SendResponseInput & { uiMessage: import("../../domain/ui/meta-ui.types.js").MetaUiMessage; correlationId?: string }) {
    return this.sendCurrent(input, () => this.sender.sendText({ ...input, uiMessage: input.uiMessage }));
  }

  async execute(input: SendResponseInput): Promise<{status:"accepted"|"unknown"; messageId?:string}> {
    if (await this.delivery?.capture(input)) return {status:"unknown"};
    try {
      const result = await this.sendCurrent(input, () => this.sender.sendText({
        provider: input.provider,
        toNumber: input.toNumber,
        deviceId: input.deviceId,
        text: input.text,
        mediaUrl: input.mediaUrl,
        mimetype: input.mimetype,
      }));

      if (result.status !== "sent" && result.status !== "queued") {
        throw new Error("whatsapp_send_failed");
      }

      this.logger.debug(
        `whatsapp_send_status status=${result.status}`,
      );
      return { status: "accepted", messageId: result.messageId };
    } catch (error) {
      this.logger.error(
        "whatsapp_send_failed",
      );
      throw error;
    }
  }

  private sendCurrent<T>(input: SendResponseInput, start: () => Promise<T>): Promise<T> {
    const frame = currentWhatsAppExecution();
    if (!frame) return start();
    return startWhatsAppRequest({ kind: "whatsapp", merchantId: input.merchantId, configId: frame.authority.configId,
      deviceId: input.deviceId, provider: input.provider ?? frame.authority.provider,
      accountId: frame.authority.accountId, recipient: input.toNumber }, start);
  }
}
