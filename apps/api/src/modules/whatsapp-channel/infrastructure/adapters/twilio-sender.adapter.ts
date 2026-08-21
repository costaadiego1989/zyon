/**
 * Twilio WhatsApp Sender — per-merchant credentials.
 *
 * Twilio API pattern:
 * POST https://api.twilio.com/2010-04-01/Accounts/{accountSid}/Messages.json
 * Auth: Basic (accountSid:authToken)
 * Content-Type: application/x-www-form-urlencoded
 */

import { Injectable, Logger, Inject } from "@nestjs/common";
import type { WhatsAppSenderPort, WhatsAppOutboundMessage, WhatsAppSendResult } from "../../domain/ports/whatsapp-sender.port.js";
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsAppConfigRepository,
} from "../../domain/ports/whatsapp-config-repository.port.js";

interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  senderId: string; // whatsapp:+5521989825798
}

@Injectable()
export class TwilioSenderAdapter implements WhatsAppSenderPort {
  private readonly logger = new Logger(TwilioSenderAdapter.name);
  private readonly baseUrl = "https://api.twilio.com/2010-04-01/Accounts";

  constructor(
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo: WhatsAppConfigRepository,
  ) {}

  async sendText(msg: WhatsAppOutboundMessage): Promise<WhatsAppSendResult> {
    try {
      // Lookup merchant config by deviceId (for backward compat during transition)
      // Future: lookup by whatsappNumber when fully migrated
      const config = await this.configRepo.findByDeviceId(msg.deviceId);
      if (!config) {
        this.logger.error(`Twilio config not found for deviceId ${msg.deviceId}`);
        return { messageId: "", status: "failed" };
      }

      // Extract Twilio credentials
      const creds = config.credentials as Record<string, unknown>;
      const accountSid = String(creds.accountSid ?? "");
      const authToken = String(creds.authToken ?? "");
      const senderId = String(creds.senderId ?? "");

      if (!accountSid || !authToken || !senderId) {
        this.logger.error(`Twilio credentials incomplete for merchantId ${config.merchantId}`);
        return { messageId: "", status: "failed" };
      }

      // Format recipient: E.164 format
      const cleanDigits = msg.toNumber.replace(/\D/g, "");
      const toNumber = cleanDigits.startsWith("55") ? cleanDigits : `55${cleanDigits}`;
      const toWhatsApp = `whatsapp:+${toNumber}`;

      // Build auth header
      const authString = `${accountSid}:${authToken}`;
      const authBase64 = Buffer.from(authString).toString("base64");

      // Build request body
      const params = new URLSearchParams({
        To: toWhatsApp,
        From: senderId,
        Body: msg.text,
      });

      const response = await fetch(
        `${this.baseUrl}/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${authBase64}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        },
      );

      if (response.ok) {
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const messageSid = String(data.sid ?? data.messageId ?? "");
        this.logger.log(`Twilio sent to ${toNumber} (SID: ${messageSid})`);
        return {
          messageId: messageSid,
          status: "sent",
        };
      }

      const errText = await response.text();
      this.logger.error(`Twilio send failed: ${response.status} — ${errText}`);
      return { messageId: "", status: "failed" };
    } catch (error) {
      this.logger.error(`Twilio network error: ${error instanceof Error ? error.message : String(error)}`);
      return { messageId: "", status: "failed" };
    }
  }

  async sendMedia(msg: WhatsAppOutboundMessage & { mediaUrl: string; mimetype: string }): Promise<WhatsAppSendResult> {
    // Phase 2: media support
    this.logger.warn("sendMedia not implemented yet — falling back to text");
    return this.sendText(msg);
  }
}
