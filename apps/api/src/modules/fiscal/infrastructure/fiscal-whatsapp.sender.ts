import type { FiscalCredentialCipherPort } from "../domain/fiscal-configuration.port.js";
import { createHash } from "node:crypto";
import type { FiscalDeliveryContext, FiscalDeliveryOutcome, FiscalDeliveryPlan, FiscalDeliverySenderPort } from "../domain/fiscal-delivery.port.js";
import type { WhatsAppConfigRepository } from "../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import type { StrictWhatsAppSenderPort } from "../../whatsapp-channel/domain/ports/whatsapp-sender.port.js";
import { connectedMetaCloudCredentials } from "../../whatsapp-channel/domain/services/connected-meta-cloud-credentials.js";
import { connectedTwilioCredentials } from "../../whatsapp-channel/domain/services/connected-twilio-credentials.js";
import type { WhatsAppTemplateRepositoryPort } from "../../whatsapp-templates/domain/ports/whatsapp-template-repository.port.js";
import type { WhatsAppTemplateSenderPort } from "../../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js";
import { isApprovedSalesTemplate } from "../../whatsapp-templates/domain/services/recovery-whatsapp-policy.js";
import type { FiscalBuyerPortalPort } from "./fiscal-buyer-portal.js";
import type { FiscalWhatsAppPolicyPort } from "./fiscal-whatsapp.policy.js";
export function fiscalTwilioCallback(base: string, configId: string) {
  const url = new URL(base); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("fiscal_callback_origin_invalid");
  return url.origin + "/v1/webhooks/fiscal-delivery/twilio/" + encodeURIComponent(configId);
}
export class FiscalWhatsAppSender implements FiscalDeliverySenderPort {
  constructor(private readonly configs: WhatsAppConfigRepository, private readonly policy: FiscalWhatsAppPolicyPort, private readonly meta: StrictWhatsAppSenderPort, private readonly twilio: StrictWhatsAppSenderPort, private readonly templates: WhatsAppTemplateRepositoryPort, private readonly templateSender: WhatsAppTemplateSenderPort, private readonly portal: FiscalBuyerPortalPort, private readonly callbackOrigin: string, private readonly cipher?: FiscalCredentialCipherPort) {}
  async prepare(context: FiscalDeliveryContext): Promise<FiscalDeliveryPlan> {
    const { delivery, document } = context; const merchantId = document.merchantId;
    if (delivery.channel !== "whatsapp" || delivery.responsibleSender !== "zyon" || !delivery.destination || !document.authorizationProtocol) return { ready: false, reasonCode: "fiscal_whatsapp_destination_or_owner_invalid" };
    const config = await this.configs.findByMerchantId(merchantId); const meta = connectedMetaCloudCredentials(config, merchantId), twilio = connectedTwilioCredentials(config, merchantId);
    if (!config || !meta && !twilio) return { ready: false, reasonCode: "fiscal_whatsapp_connection_unavailable" };
    const permission = await this.policy.read(context, config);
    if (!permission.permitted || !permission.evidenceReference) return { ready: false, reasonCode: "fiscal_whatsapp_permission_missing" };
    const window = permission.lastInboundAt && permission.lastInboundAt.getTime() <= Date.now() && Date.now() - permission.lastInboundAt.getTime() < 24 * 60 * 60_000;
    const template = !window && meta ? await this.templates.findByMerchantAndType(merchantId, "fiscal_invoice", "whatsapp") : null;
    if (!window && (!meta || !isApprovedSalesTemplate(template, merchantId, "fiscal_invoice", meta.wabaId) || template.metaCategory !== "UTILITY" || !/nota fiscal/i.test(template.metaTemplateBody ?? "") || Object.values(template.metaVariableMap ?? {}).sort().join(",") !== "link,orderId")) return { ready: false, reasonCode: "fiscal_whatsapp_template_unavailable" };
    const link = await this.portal.link(context); if (!link) return { ready: false, reasonCode: "fiscal_portal_context_unavailable" };
    const provider = meta ? "meta" as const : "twilio" as const, accountId = meta?.phoneNumberId ?? twilio!.accountSid;
    let statusCallbackUrl: string | undefined; try { if (twilio) statusCallbackUrl = fiscalTwilioCallback(this.callbackOrigin, config.id); } catch { return { ready: false, reasonCode: "fiscal_whatsapp_callback_unconfigured" }; }
    return { ready: true, provider, accountId, connectionId: config.id, ...(twilio && this.cipher ? { callbackCredentialCipher: this.cipher.encrypt(JSON.stringify({ accountSid: twilio.accountSid, authToken: twilio.authToken })) } : {}), send: async (): Promise<FiscalDeliveryOutcome> => {
      const current = await this.configs.findById(config.id);
      if (!current || current.merchantId !== merchantId || (meta ? connectedMetaCloudCredentials(current, merchantId)?.phoneNumberId !== accountId : (connectedTwilioCredentials(current, merchantId)?.accountSid !== accountId || connectedTwilioCredentials(current, merchantId)?.authToken !== twilio!.authToken))) return { state: "blocked", reasonCode: "fiscal_whatsapp_connection_changed" };
      const recheck = await this.policy.read(context, current); if (!recheck.permitted || !recheck.evidenceReference) return { state: "blocked", reasonCode: "fiscal_whatsapp_permission_missing" };
      const stillWindow = recheck.lastInboundAt && recheck.lastInboundAt.getTime() <= Date.now() && Date.now() - recheck.lastInboundAt.getTime() < 24 * 60 * 60_000;
      if (window && !stillWindow) return { state: "blocked", reasonCode: "fiscal_whatsapp_window_closed" };
      const msg = { deviceId: config.id, toNumber: delivery.destination!, text: `${document.environment === "homologation" ? "Nota fiscal de homologação" : "Nota fiscal"} do pedido ${context.issuance.snapshot.orderId}: ${link}` };
      const result = window ? await (meta ? this.meta : this.twilio).sendTextStrict(msg, { merchantId, configId: config.id, accountId, statusCallbackUrl, ...(twilio ? { credentialFingerprint: createHash("sha256").update(twilio.authToken).digest("hex") } : {}) }) : await this.templateSender.sendTemplate({ merchantId, type: "fiscal_invoice", toNumber: delivery.destination!, contentSid: template!.twilioContentSid!, language: template!.metaLanguage ?? "pt_BR", expectedConnection: { configId: config.id, phoneNumberId: meta!.phoneNumberId, wabaId: meta!.wabaId }, contentVariables: Object.fromEntries(Object.entries(template!.metaVariableMap ?? {}).map(([key, value]) => [key, value === "orderId" ? context.issuance.snapshot.orderId : value === "link" ? link : ""])) });
      if (result.status === "sent" && result.messageId.trim()) return { state: "accepted", messageId: result.messageId };
      if (result.status === "skipped") return { state: "blocked", reasonCode: "fiscal_whatsapp_dispatch_blocked" };
      if (result.status === "failed" && result.acceptance === "not_accepted") return { state: "failed", reasonCode: "fiscal_whatsapp_provider_rejected" };
      return { state: "delivery_unknown", reasonCode: "fiscal_whatsapp_acceptance_unknown" };
    } };
  }
}
