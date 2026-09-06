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
import { WHATSAPP_TEMPLATE_REPOSITORY, type WhatsAppTemplateRepositoryPort } from "../../domain/ports/whatsapp-template-repository.port.js";
import { connectedTwilioCredentials, isApprovedRecoveryTemplate, normalizeRecoveryRecipient } from "../../domain/services/recovery-whatsapp-policy.js";

interface TwilioCredentials {
  accountSid?: string;
  authToken?: string;
  senderId?: string; // "whatsapp:+5521..."
}

/**
 * Twilio REST exceptions use status/message/code; 400 rejects the create request:
 * https://www.twilio.com/docs/usage/twilios-response#exceptions
 * Allow only documented Content validation and unavailable template failures:
 * https://www.twilio.com/docs/api/errors/21654 (missing ContentSid)
 * https://www.twilio.com/docs/api/errors/21655 (invalid ContentSid)
 * https://www.twilio.com/docs/api/errors/21656 (invalid ContentVariables)
 * https://www.twilio.com/docs/api/errors/63040 (rejected template)
 * https://www.twilio.com/docs/api/errors/63041 (paused template)
 * https://www.twilio.com/docs/api/errors/63042 (disabled template)
 * This is deliberately restricted to the synchronous POST exception, without
 * a Message SID. The same error in a created Message or callback is NOT proof
 * of non-acceptance. For example, 63005 can follow Twilio acceptance:
 * https://www.twilio.com/docs/api/errors/63005
 */
const PRE_ACCEPTANCE_TEMPLATE_ERRORS = new Set([21654, 21655, 21656, 63040, 63041, 63042]);

function rejectedBeforeMessageCreation(status: number, data: Record<string, unknown>): number | null {
  if (status !== 400 || data.status !== 400 || typeof data.code !== "number"
    || !PRE_ACCEPTANCE_TEMPLATE_ERRORS.has(data.code)
    || typeof data.message !== "string" || !data.message.trim()
    || Object.hasOwn(data, "sid")) return null;
  return data.code;
}

/**
 * Sends business-initiated WhatsApp via Twilio using a Meta-approved Content
 * Template (ContentSid + ContentVariables). Recovery requires a current active
 * merchant connection and approved template, re-read immediately before sending.
 * A skipped result guarantees that no provider dispatch occurred.
 */
@Injectable()
export class WhatsAppTemplateSenderAdapter implements WhatsAppTemplateSenderPort {
  private readonly logger = new Logger(WhatsAppTemplateSenderAdapter.name);
  private readonly baseUrl = "https://api.twilio.com/2010-04-01/Accounts";

  constructor(
    @Optional()
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo?: WhatsAppConfigRepository,
    @Optional()
    @Inject(WHATSAPP_TEMPLATE_REPOSITORY)
    private readonly templates?: WhatsAppTemplateRepositoryPort,
  ) {}

  async sendTemplate(input: TemplateSendInput): Promise<TemplateSendResult> {
    const strictRecovery = input.type === "cart_recovery";
    const creds = await this.resolveCredentials(input.merchantId, strictRecovery);
    if (!creds.accountSid || !creds.authToken || !creds.senderId) {
      this.logger.warn(
        `Twilio WhatsApp credentials missing for merchant ${input.merchantId} — skipping (fallback to email)`
      );
      return { messageId: "", status: "skipped", reason: "twilio_credentials_missing" };
    }
    if (!input.contentSid) {
      return { messageId: "", status: "skipped", reason: "no_content_sid" };
    }
    if (strictRecovery) {
      const template = await this.templates?.findByMerchantAndType(input.merchantId, "cart_recovery", "whatsapp")
        .catch(() => null);
      if (!isApprovedRecoveryTemplate(template, input.merchantId, input.contentSid)) {
        return { messageId: "", status: "skipped", reason: "approved_template_unavailable" };
      }
    }

    const cleanDigits = input.toNumber.replace(/\D/g, "");
    const recoveryRecipient = strictRecovery ? normalizeRecoveryRecipient(input.toNumber) : null;
    if (strictRecovery && !recoveryRecipient) {
      return { messageId: "", status: "skipped", reason: "invalid_recipient" };
    }
    const number = strictRecovery ? recoveryRecipient!.slice(1) : cleanDigits.startsWith("55") ? cleanDigits : `55${cleanDigits}`;
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
        ...(strictRecovery ? { signal: AbortSignal.timeout(15_000) } : {}),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Twilio template transport error`, { merchantId: input.merchantId, reason });
      if (strictRecovery) return { messageId: "", status: "uncertain", reason: "provider_acceptance_unknown" };
      throw new Error(`whatsapp_template_transport_failed: ${reason}`);
    }

    if (response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const sid = typeof data.sid === "string" ? data.sid : "";
      if (strictRecovery && !sid.trim()) {
        return { messageId: "", status: "uncertain", reason: "provider_acceptance_unknown" };
      }
      if (strictRecovery && ["failed", "undelivered", "canceled"].includes(String(data.status))) {
        return { messageId: sid, status: "failed", reason: `twilio_message_${String(data.status)}` };
      }
      this.logger.log(`Twilio template sent to ${number} (SID ${sid})`);
      return { messageId: sid, status: "sent" };
    }

    const errText = await response.text().catch(() => "");
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      if (strictRecovery) {
        let payload: unknown;
        try { payload = JSON.parse(errText); } catch { payload = null; }
        const data = payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload as Record<string, unknown> : {};
        const rejectionCode = rejectedBeforeMessageCreation(response.status, data);
        if (rejectionCode !== null) {
          this.logger.warn(`Twilio template rejected before message creation (${rejectionCode})`, { merchantId: input.merchantId });
          return { messageId: "", status: "failed", acceptance: "not_accepted", reason: `twilio_${rejectionCode}` };
        }
        this.logger.error(`Twilio template request failed (${response.status}); non-acceptance unproven`, { merchantId: input.merchantId });
        return {
          messageId: typeof data.sid === "string" ? data.sid : "",
          status: "failed", reason: `twilio_${response.status}`,
        };
      }
      this.logger.error(`Twilio template rejected (${response.status}): ${errText}`);
      return { messageId: "", status: "failed", reason: `twilio_${response.status}` };
    }
    if (strictRecovery) return { messageId: "", status: "uncertain", reason: "provider_acceptance_unknown" };
    throw new Error(`whatsapp_template_send_failed: ${response.status} ${errText}`.trim());
  }

  private async resolveCredentials(merchantId: string, strictRecovery: boolean): Promise<TwilioCredentials> {
    if (this.configRepo) {
      try {
        const cfg = await this.configRepo.findByMerchantId(merchantId);
        if (strictRecovery) return connectedTwilioCredentials(cfg, merchantId) ?? {};
        // Preserve the established credential resolution for other message types.
        const credentials = cfg?.credentials ?? {};
        const accountSid = credentials.accountSid ? String(credentials.accountSid) : undefined;
        const authToken = credentials.authToken ? String(credentials.authToken) : undefined;
        const senderId = credentials.senderId ? String(credentials.senderId) : undefined;
        if (accountSid && authToken && senderId) return { accountSid, authToken, senderId };
      } catch (err) {
        this.logger.debug(`merchant Twilio config lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        if (strictRecovery) return {};
      }
    }
    if (strictRecovery) return {};
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const senderId = process.env.TWILIO_WHATSAPP_FROM;
    if (accountSid && authToken && senderId) return { accountSid, authToken, senderId };
    return {};
  }
}
