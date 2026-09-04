/**
 * BubbleWhats Sender Adapter — sends messages via BubbleWhats HTTP API.
 * Matches existing pattern from notifications/infrastructure/adapters/bubblewhats.adapter.ts
 */

import { Injectable, Logger } from "@nestjs/common";
import type { WhatsAppSenderPort, WhatsAppOutboundMessage, WhatsAppSendResult } from "../../domain/ports/whatsapp-sender.port.js";

@Injectable()
export class BubbleWhatsSenderAdapter implements WhatsAppSenderPort {
  private readonly logger = new Logger(BubbleWhatsSenderAdapter.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = process.env.BUBBLEWHATS_API_URL?.trim() || "";
    this.token = process.env.BUBBLEWHATS_TOKEN?.trim() || "";

    if (!this.token || !this.baseUrl) {
      this.logger.warn("BUBBLEWHATS_API_URL / BUBBLEWHATS_TOKEN not configured — messages will fail");
    }
  }

  async sendText(msg: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    if (!this.baseUrl || !this.token) {
      return { messageId: "", status: "failed" };
    }

    const cleanDigits = msg.toNumber.replace(/\D/g, "");
    const number = cleanDigits.startsWith("55") ? cleanDigits : `55${cleanDigits}`;
    const jid = `${number}@s.whatsapp.net`;

    try {
      const response = await fetch(`${this.baseUrl}/send-message`, {
        method: "POST",
        headers: {
          Authorization: this.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jid,
          message: msg.text,
        }),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({})) as Record<string, unknown>;
        this.logger.log(`WhatsApp sent to ${number}`);
        return {
          messageId: String(data.key ?? data.id ?? ""),
          status: "sent",
        };
      }

      const errText = await response.text();
      this.logger.error(`BubbleWhats send failed: ${response.status} — ${errText}`);
      return { messageId: "", status: "failed" };
    } catch (error) {
      this.logger.error(`BubbleWhats network error: ${error instanceof Error ? error.message : String(error)}`);
      return { messageId: "", status: "failed" };
    }
  }

  async sendMedia(msg: WhatsAppOutboundMessage & { mediaUrl: string; mimetype: string }): Promise<WhatsAppSendResult> {
    // Phase 2: media support
    this.logger.warn("sendMedia not implemented yet — falling back to text");
    return this.sendText(msg);
  }
}
