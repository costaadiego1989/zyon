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

    try {
      const response = await fetch(`${baseUrl}/send-message`, {
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

      if (response.ok) {
        this.logger.log(`WhatsApp sent to ${number}`);
      } else {
        const errText = await response.text();
        this.logger.error(`BubbleWhats failed: ${response.status} — ${errText}`);
      }
    } catch (err) {
      this.logger.error(`BubbleWhats error`, { error: err });
    }
  }
}
