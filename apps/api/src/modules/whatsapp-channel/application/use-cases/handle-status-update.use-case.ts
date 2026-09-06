/**
 * Handle WhatsApp status updates (delivery/read receipts).
 * Used for analytics — no user-facing action.
 */

import { Injectable, Logger } from "@nestjs/common";

export interface StatusUpdateInput {
  merchantId: string;
  deviceId: string;
  messages: Array<{
    key: { remoteJid: string; id: string; fromMe: boolean };
    update: { status: number };
  }>;
}

const STATUS_LABELS: Record<number, string> = {
  0: "ERROR",
  1: "PENDING",
  2: "SERVER-ACK",
  3: "DELIVERY-ACK",
  4: "READ",
  5: "PLAYED",
};

@Injectable()
export class HandleStatusUpdateUseCase {
  private readonly logger = new Logger(HandleStatusUpdateUseCase.name);

  async execute(input: StatusUpdateInput): Promise<void> {
    for (const msg of input.messages) {
      const statusLabel = STATUS_LABELS[msg.update.status] ?? `UNKNOWN(${msg.update.status})`;
      this.logger.debug(
        `whatsapp_status_update merchant=${input.merchantId} status=${statusLabel}`,
      );

      // TODO: persist for analytics (message delivery rate, read rate, response time)
      // await this.analyticsRepo.trackMessageStatus(input.merchantId, msg.key.id, msg.update.status);
    }
  }
}
