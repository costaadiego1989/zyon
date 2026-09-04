import { Injectable, Logger } from "@nestjs/common";
import type { WhatsAppSenderPort, WhatsAppMessage } from "../../domain/ports/whatsapp-sender.port.js";

@Injectable()
export class BubbleWhatsAdapter implements WhatsAppSenderPort {
  private readonly logger = new Logger(BubbleWhatsAdapter.name);

  async send(msg: WhatsAppMessage): Promise<void> {
    const baseUrl = process.env.BUBBLEWHATS_API_URL;
    const token = process.env.BUBBLEWHATS_TOKEN;

    if (!baseUrl || !token) {
      this.logger.warn("BubbleWhats not configured (BUBBLEWHATS_API_URL / BUBBLEWHATS_TOKEN missing)");
      return;
    }

    if (!msg.phone) {
      this.logger.warn("Skipping WhatsApp: no phone number");
      return;
    }

    const cleanDigits = msg.phone.replace(/\D/g, "");
    const number = cleanDigits.startsWith("55") ? cleanDigits : `55${cleanDigits}`;
    const jid = `${number}@s.whatsapp.net`;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/send-message`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jid,
          message: msg.message,
        }),
      });
    } catch (err) {
      // Network/transport failure — throw so the queue worker retries with backoff.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`BubbleWhats transport error`, { error: reason });
      throw new Error(`whatsapp_send_transport_failed: ${reason}`);
    }

    if (response.ok) {
      this.logger.log(`WhatsApp sent to ${number}`);
      return;
    }

    // Delivery rejected by gateway — throw so retry/backoff fires instead of
    // silently marking the message as sent.
    const errText = await response.text().catch(() => "");
    this.logger.error(`BubbleWhats failed: ${response.status} — ${errText}`);
    throw new Error(`whatsapp_send_failed: ${response.status} ${errText}`.trim());
  }
}
