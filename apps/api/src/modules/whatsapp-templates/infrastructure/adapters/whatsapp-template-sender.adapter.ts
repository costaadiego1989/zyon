import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import type {
  WhatsAppTemplateSenderPort,
  TemplateSendInput,
  TemplateSendResult,
} from "../../domain/ports/whatsapp-template-sender.port.js";
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsAppConfigRepository,
} from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";

interface TwilioCredentials {
  accountSid?: string;
  authToken?: string;
  senderId?: string; // "whatsapp:+5521..."
}

/**
 * Sends business-initiated WhatsApp via Twilio using a Meta-approved Content
 * Template (ContentSid + ContentVariables). Per-merchant WABA credentials, with
 * platform env fallback. Missing creds → `skipped` (never throws) so the caller
 * falls back to email instead of erroring the whole tick.
 */
@Injectable()
export class WhatsAppTemplateSenderAdapter implements WhatsAppTemplateSenderPort {
  private readonly logger = new Logger(WhatsAppTemplateSenderAdapter.name);
  private readonly baseUrl = "https://api.twilio.com/2010-04-01/Accounts";

  constructor(
    @Optional()
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo?: WhatsAppConfigRepository
  ) {}

  async sendTemplate(input: TemplateSendInput): Promise<TemplateSendResult> {
    const creds = await this.resolveCredentials(input.merchantId);
    if (!creds.accountSid || !creds.authToken || !creds.senderId) {
      this.logger.warn(
        `Twilio WhatsApp credentials missing for merchant ${input.merchantId} — skipping (fallback to email)`
      );
      return { messageId: "", status: "skipped", reason: "twilio_credentials_missing" };
    }
    if (!input.contentSid) {
      return { messageId: "", status: "skipped", reason: "no_content_sid" };
    }

    const cleanDigits = input.toNumber.replace(/\D/g, "");
    const number = cleanDigits.startsWith("55") ? cleanDigits : `55${cleanDigits}`;
    const toWhatsApp = `whatsapp:+${number}`;

    const authBase64 = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
    const params = new URLSearchParams({
      To: toWhatsApp,
      From: creds.senderId,
      ContentSid: input.contentSid,
    });
    if (input.contentVariables && Object.keys(input.contentVariables).length > 0) {
      params.set("ContentVariables", JSON.stringify(input.contentVariables));
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${creds.accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authBase64}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Twilio template transport error`, { merchantId: input.merchantId, reason });
      throw new Error(`whatsapp_template_transport_failed: ${reason}`);
    }

    if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const sid = String(data.sid ?? "");
      this.logger.log(`Twilio template sent to ${number} (SID ${sid})`);
      return { messageId: sid, status: "sent" };
    }

    const errText = await response.text().catch(() => "");
    if (response.status >= 400 && response.status < 500) {
      this.logger.error(`Twilio template rejected (${response.status}): ${errText}`);
      return { messageId: "", status: "failed", reason: `twilio_${response.status}` };
    }
    throw new Error(`whatsapp_template_send_failed: ${response.status} ${errText}`.trim());
  }

  private async resolveCredentials(merchantId: string): Promise<TwilioCredentials> {
    if (this.configRepo) {
      try {
        const cfg = await this.configRepo.findByMerchantId(merchantId);
        const c = (cfg?.credentials ?? {}) as Record<string, unknown>;
        const accountSid = c.accountSid ? String(c.accountSid) : undefined;
        const authToken = c.authToken ? String(c.authToken) : undefined;
        const senderId = c.senderId ? String(c.senderId) : undefined;
        if (accountSid && authToken && senderId) return { accountSid, authToken, senderId };
      } catch (err) {
        this.logger.debug(`merchant Twilio config lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const senderId = process.env.TWILIO_WHATSAPP_FROM;
    if (accountSid && authToken && senderId) return { accountSid, authToken, senderId };
    return {};
  }
}
