import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import {
  type PostSaleWhatsAppSenderPort,
  type PostSaleTemplateSendInput,
  type PostSaleTemplateSendResult,
} from "../../domain/ports/post-sale-whatsapp-sender.port.js";
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
 * Sends business-initiated WhatsApp messages via Twilio using a Meta-approved
 * Content Template (ContentSid + ContentVariables). Twilio bridges to the Meta
 * Cloud API, so an approved ContentSid == an approved Meta template.
 *
 * Credentials are per-merchant (WABA registered via Embedded Signup), read from
 * the shared WhatsApp channel config. Falls back to platform-level Twilio env
 * when the merchant has none but the platform account is shared.
 *
 * Fail-safe: if credentials are missing, returns `skipped` (never throws) so the
 * caller can fall back to email instead of erroring the whole tick.
 */
@Injectable()
export class WhatsAppTemplateSenderAdapter implements PostSaleWhatsAppSenderPort {
  private readonly logger = new Logger(WhatsAppTemplateSenderAdapter.name);
  private readonly baseUrl = "https://api.twilio.com/2010-04-01/Accounts";

  constructor(
    @Optional()
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo?: WhatsAppConfigRepository
  ) {}

  async sendTemplate(input: PostSaleTemplateSendInput): Promise<PostSaleTemplateSendResult> {
    const creds = await this.resolveCredentials(input.merchantId);
    if (!creds.accountSid || !creds.authToken || !creds.senderId) {
      this.logger.warn(
        `Twilio WhatsApp credentials missing for merchant ${input.merchantId} — skipping (caller should fall back to email)`
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
      // Transport failure → throw so the queue worker retries with backoff.
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
    // 4xx from Twilio (bad template, unapproved) is permanent → don't retry.
    if (response.status >= 400 && response.status < 500) {
      this.logger.error(`Twilio template rejected (${response.status}): ${errText}`);
      return { messageId: "", status: "failed", reason: `twilio_${response.status}` };
    }
    // 5xx → transient, throw for retry.
    throw new Error(`whatsapp_template_send_failed: ${response.status} ${errText}`.trim());
  }

  private async resolveCredentials(merchantId: string): Promise<TwilioCredentials> {
    // 1) Per-merchant WABA credentials (Embedded Signup).
    if (this.configRepo) {
      try {
        const cfg = await this.configRepo.findByMerchantId(merchantId);
        const c = (cfg?.credentials ?? {}) as Record<string, unknown>;
        const accountSid = c.accountSid ? String(c.accountSid) : undefined;
        const authToken = c.authToken ? String(c.authToken) : undefined;
        const senderId = c.senderId ? String(c.senderId) : undefined;
        if (accountSid && authToken && senderId) {
          return { accountSid, authToken, senderId };
        }
      } catch (err) {
        this.logger.debug(
          `merchant Twilio config lookup failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 2) Platform-shared Twilio account (env), if configured.
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const senderId = process.env.TWILIO_WHATSAPP_FROM; // "whatsapp:+..."
    if (accountSid && authToken && senderId) {
      return { accountSid, authToken, senderId };
    }
    return {};
  }
}
