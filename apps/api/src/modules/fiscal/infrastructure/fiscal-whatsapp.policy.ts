import type { PrismaClient } from "@prisma/client";
import type { FiscalDeliveryContext } from "../domain/fiscal-delivery.port.js";
import type { WhatsAppChannelConfigEntity } from "../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { whatsappE164 } from "../../whatsapp-channel/domain/services/whatsapp-phone.js";
import { connectedTwilioCredentials } from "../../whatsapp-channel/domain/services/connected-twilio-credentials.js";
export interface FiscalWhatsAppPermission { permitted: boolean; evidenceReference?: string; lastInboundAt?: Date }
export interface FiscalWhatsAppPolicyPort { read(context: FiscalDeliveryContext, config: WhatsAppChannelConfigEntity): Promise<FiscalWhatsAppPermission> }
/** A request for this invoice in the original authenticated conversation is scoped permission.
 * Contacts, global preferences, marketing consent and outbound activity grant nothing. */
export class FiscalWhatsAppPolicy implements FiscalWhatsAppPolicyPort {
  constructor(private readonly prisma: PrismaClient, private readonly transport: typeof fetch = fetch) {}
  async read(context: FiscalDeliveryContext, config: WhatsAppChannelConfigEntity): Promise<FiscalWhatsAppPermission> {
    const snapshot = context.issuance.snapshot; const destination = context.delivery.destination;
    if (snapshot.orderMerchantId !== config.merchantId || !destination) return { permitted: false };
    const original = await this.prisma.completedOrder.findFirst({ where: { id: snapshot.completedOrderId, merchantId: snapshot.orderMerchantId }, select: { sessionId: true, completedAt: true, session: { select: { globalUserId: true, createdAt: true } } } });
    if (!original?.session.globalUserId || snapshot.buyerGlobalUserId && snapshot.buyerGlobalUserId !== original.session.globalUserId) return { permitted: false };
    const session = await this.prisma.whatsAppSession.findFirst({ where: { merchantId: config.merchantId, checkoutSessionId: original.sessionId, buyerPhone: { in: [destination, destination.slice(1)] } }, select: { deviceId: true } });
    if (!session) return { permitted: false };
    const records = await this.prisma.whatsAppWebhookInbox.findMany({ where: { merchantId: config.merchantId, configId: config.id, deviceId: session.deviceId, kind: "message", payload: { path: ["fromNumber"], equals: destination } }, orderBy: { createdAt: "desc" }, take: 100 });
    const valid = records.filter(row => { const p = row.payload as Record<string, unknown>; return p.provider === config.provider && p.merchantId === config.merchantId && whatsappE164(String(p.fromNumber)) === destination && !p.ignored; });
    const request = valid.find(row => {
      const match = /^(?:por favor[, ]*)?(?:envie|enviar|mande|mandar|quero receber|pode enviar) (?:a |minha |o )?(?:nota fiscal|nf-e|nfe|danfe|xml)(?: (?:do |de )?pedido ([\w-]+))?[.!? ]*$/i.exec(String((row.payload as Record<string, unknown>).body ?? "").trim());
      return match && (!match[1] || match[1] === snapshot.orderId);
    });
    if (!request || valid.slice(0, valid.indexOf(request)).some(row => /^(?:pare|parar|stop|sair|n[a\u00e3]o envi(?:e|ar))(?: a)?(?: nota fiscal| nf-e| nfe| danfe| xml)?[.! ]*$/i.test(String((row.payload as Record<string, unknown>).body ?? "").trim()))) return { permitted: false };
    let lastInboundAt: Date | undefined; let requestTimestamp = Number.NaN;
    for (const row of [...new Map([request, valid[0]!].map(row => [row.id, row])).values()]) {
      const payload = row.payload as Record<string, unknown>; let timestamp = Number.NaN;
      if (config.provider === "META_CLOUD" && payload.providerTimestampVerified === true) timestamp = Number(payload.timestamp);
      else if (config.provider === "TWILIO") {
        const credentials = connectedTwilioCredentials(config, config.merchantId);
        if (credentials && /^SM[a-zA-Z0-9]+$/.test(row.eventId)) try {
          const response = await this.transport(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}/Messages/${encodeURIComponent(row.eventId)}.json`, { redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Basic ${Buffer.from(credentials.accountSid + ":" + credentials.authToken).toString("base64")}` } });
          const result = response.ok ? await response.json() as Record<string, unknown> : null;
          if (result?.sid === row.eventId && result.account_sid === credentials.accountSid && result.direction === "inbound" && whatsappE164(String(result.from).replace(/^whatsapp:/, "")) === destination && result.to === credentials.senderId) timestamp = Date.parse(String(result.date_created));
        } catch { /* No authenticated provider time means no session window. */ }
      }
      if (row.id === request.id) requestTimestamp = timestamp;
      if (Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now() && Date.now() - timestamp < 24 * 60 * 60_000 && (!lastInboundAt || timestamp > lastInboundAt.getTime())) lastInboundAt = new Date(timestamp);
    }
    if (!Number.isFinite(requestTimestamp) || requestTimestamp < original.session.createdAt.getTime() || requestTimestamp > Date.now()) return { permitted: false };
    return { permitted: true, evidenceReference: "whatsapp-inbound:" + request.id, ...(lastInboundAt ? { lastInboundAt } : {}) };
  }
}
