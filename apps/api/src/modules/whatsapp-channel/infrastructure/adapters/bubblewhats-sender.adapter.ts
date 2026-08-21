/**
 * BubbleWhats Sender Adapter — sends messages via BubbleWhats HTTP API.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { WhatsAppSenderPort, WhatsAppOutboundMessage, WhatsAppSendResult } from "../../domain/ports/whatsapp-sender.port.js";

@Injectable()
export class BubbleWhatsSenderAdapter implements WhatsAppSenderPort {
  private readonly logger = new Logger(BubbleWhatsSenderAdapter.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = process.env.BUBBLEWHATS_API_URL?.trim() || "https://api.bubblewhats.com";
    this.token = process.env.BUBBLEWHATS_TOKEN?.trim() || "";

    if (!this.token) {
      this.logger.warn("BUBBLEWHATS_TOKEN not configured — messages will fail");
    }
  }

  async sendText(msg: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    const url = `${this.baseUrl}/device/${msg.deviceId}/send-text`;

    const body = {
      number: msg.toNumber,
      message: msg.text,
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`BubbleWhats send failed: ${res.status} ${text}`);
        return { messageId: "", status: "failed" };
      }

      const data = await res.json() as { key?: string; id?: string };
      return {
        messageId: data.key ?? data.id ?? "",
        status: "sent",
      };
    } catch (error) {
      this.logger.error(`BubbleWhats network error: ${error instanceof Error ? error.message : String(error)}`);
      return { messageId: "", status: "failed" };
    }
  }

  async sendMedia(msg: WhatsAppOutboundMessage & { mediaUrl: string; mimetype: string }): Promise<WhatsAppSendResult> {
    const url = `${this.baseUrl}/device/${msg.deviceId}/send-media`;

    const body = {
      number: msg.toNumber,
      media_url: msg.mediaUrl,
      caption: msg.text || undefined,
      mimetype: msg.mimetype,
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return { messageId: "", status: "failed" };
      }

      const data = await res.json() as { key?: string; id?: string };
      return { messageId: data.key ?? data.id ?? "", status: "sent" };
    } catch {
      return { messageId: "", status: "failed" };
    }
  }
}
