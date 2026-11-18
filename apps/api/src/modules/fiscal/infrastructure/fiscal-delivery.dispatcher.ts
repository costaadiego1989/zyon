import { FiscalDeliveryCallbackError, type FiscalDeliveryDispatchPort, type MetaDeliveryStatus } from "../../../shared/integrations/fiscal-delivery-dispatch.port.js";
import type { FiscalDeliveryService } from "../application/fiscal-delivery.service.js";
import { verifyFiscalSvix } from "../domain/fiscal-delivery-webhook-auth.js";
import { validateTwilioSignature } from "../../whatsapp-channel/domain/services/twilio-signature-validator.js";
import { fiscalTwilioCallback } from "./fiscal-whatsapp.sender.js";
export interface FiscalDeliveryWebhookConfigurationPort {
  resend(hookRef: string): Promise<{ accountId: string; secret: string } | null>;
  /** Resolve the ORIGINAL protected account credential; never follow a replacement account. */
  twilio(configId: string, accountSid: string, messageId?: string): Promise<{ accountSid: string; authToken: string } | null>;
}
export class FiscalDeliveryDispatcher implements FiscalDeliveryDispatchPort {
  constructor(private readonly deliveries: Pick<FiscalDeliveryService, "receipt">, private readonly config: FiscalDeliveryWebhookConfigurationPort, private readonly publicApiOrigin: string) {}
  async fromMeta(phoneNumberId: string, statuses: MetaDeliveryStatus[]) {
    if (!/^\d{5,40}$/.test(phoneNumberId) || statuses.length > 200) throw new FiscalDeliveryCallbackError(400, "fiscal_meta_status_invalid");
    for (const row of statuses) {
      if (!row.id?.trim() || !["sent", "delivered", "failed"].includes(row.status ?? "")) continue;
      const recipient = row.recipient_phone ?? (row.recipient_id && /^\d{8,15}$/.test(row.recipient_id) ? row.recipient_id : undefined);
      await this.deliveries.receipt({ provider: "meta", accountId: phoneNumberId, messageId: row.id, state: row.status === "delivered" ? "delivered" : row.status === "failed" ? "failed" : "accepted", ...(recipient ? { destination: recipient.startsWith("+") ? recipient : "+" + recipient } : {}) });
    }
  }
  async resend(hookRef: string, raw: Buffer | undefined, headers: Record<string, unknown>) {
    const config = await this.config.resend(hookRef);
    if (!config || !verifyFiscalSvix(raw, headers, config.secret)) throw new FiscalDeliveryCallbackError(401, "fiscal_email_signature_invalid");
    let body: { type?: string; data?: { email_id?: string; to?: string[] } };
    try { body = JSON.parse(raw!.toString("utf8")); } catch { throw new FiscalDeliveryCallbackError(400, "fiscal_email_event_invalid"); }
    if (!["email.delivered", "email.sent", "email.failed", "email.bounced"].includes(body.type ?? "")) return;
    if (!body.data?.email_id?.trim() || !Array.isArray(body.data.to) || body.data.to.length !== 1 || typeof body.data.to[0] !== "string") throw new FiscalDeliveryCallbackError(400, "fiscal_email_event_invalid");
    await this.deliveries.receipt({ provider: "resend", accountId: config.accountId, messageId: body.data.email_id, destination: body.data.to[0], state: body.type === "email.delivered" ? "delivered" : body.type === "email.sent" ? "accepted" : "failed" });
  }
  async twilio(configId: string, signature: unknown, value: unknown, originalUrl: string) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 100 || Object.values(value).some(v => typeof v !== "string" || v.length > 10000)) throw new FiscalDeliveryCallbackError(400, "fiscal_twilio_form_invalid");
    const body = value as Record<string, string>; const config = await this.config.twilio(configId, body.AccountSid ?? "", body.MessageSid);
    const url = fiscalTwilioCallback(this.publicApiOrigin, configId);
    if (!config || config.accountSid !== body.AccountSid || originalUrl !== new URL(url).pathname || typeof signature !== "string" || !validateTwilioSignature(signature, url, body, config.authToken)) throw new FiscalDeliveryCallbackError(401, "fiscal_twilio_signature_invalid");
    if (!body.MessageSid?.trim() || !["accepted", "queued", "sending", "sent", "delivered", "failed", "undelivered", "read"].includes(body.MessageStatus ?? "")) return;
    const state = body.MessageStatus === "delivered" ? "delivered" : ["failed", "undelivered"].includes(body.MessageStatus!) ? "failed" : "accepted";
    await this.deliveries.receipt({ provider: "twilio", accountId: config.accountSid, messageId: body.MessageSid, state, ...(body.To ? { destination: body.To.replace(/^whatsapp:/, "") } : {}) });
  }
}
