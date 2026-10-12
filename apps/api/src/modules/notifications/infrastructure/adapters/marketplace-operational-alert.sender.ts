import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { EmailProviderRejection } from "../../domain/ports/email-provider-rejection.js";
import { WHATSAPP_TEMPLATE_SENDER, type WhatsAppTemplateSenderPort } from "../../../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js";
import { getTemplateDefinition } from "../../../whatsapp-templates/domain/catalog/template-catalog.js";
import { operationalAlertContent, type MarketplaceOperationalAlert, type OperationalAlertChannel, type PreparedOperationalAlertDelivery } from "../../domain/marketplace-operational-alert.js";

const escape = (s: string) => s.replace(/[&<>"']/g,c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);
export function operationalDashboardLink() {
  const url = new URL(process.env.DASHBOARD_PUBLIC_URL || "https://app.zyon-payments.com.br");
  if (url.protocol !== "https:" || url.username || url.password || url.search) throw new Error("operational_dashboard_url_invalid");
  // The existing inbox is the dashboard bell, not a separate hash route.
  url.hash = "overview";
  return url.toString();
}

/** Presentation only: uses the incident's persisted time, never the send clock. */
export function renderOperationalAlertEmail(alert: MarketplaceOperationalAlert, link: string): string {
  const content = operationalAlertContent(alert);
  const resolved = alert.state === "resolved";
  const state = resolved ? "Resolvido" : "Ativo";
  const severity = alert.severity === "critical" ? "Crítica" : "Atenção";
  const statusColor = resolved ? "#24523b" : alert.severity === "critical" ? "#8d2c24" : "#805017";
  const statusBackground = resolved ? "#eef6f1" : alert.severity === "critical" ? "#fff1ef" : "#fbf4e8";
  const startedAt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "shortOffset",
  }).format(alert.startsAt);
  const safeLink = escape(link);

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(content.title)}</title></head>
<body style="margin:0;padding:0;background-color:#f2f5f3;color:#17231d;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escape(content.title)}. Consulte os detalhes no dashboard Zyon.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f2f5f3;border-collapse:collapse;">
    <tr><td align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#fbfdfb;border:1px solid #dce5de;border-radius:14px;font-family:Arial,Helvetica,sans-serif;">
        <tr><td bgcolor="#0f2f25" style="padding:26px 24px;background-color:#0f2f25;border-radius:14px 14px 0 0;">
          <p style="margin:0;color:#f7fbf8;font-size:30px;line-height:36px;font-weight:700;letter-spacing:-1px;">Zyon</p>
          <p style="margin:6px 0 0;color:#d9efe5;font-size:13px;line-height:20px;">Operações do marketplace</p>
        </td></tr>
        <tr><td style="padding:28px 24px 0;">
          <p style="margin:0 0 10px;color:#52675a;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Aviso operacional</p>
          <h1 style="margin:0;color:#17231d;font-size:26px;line-height:34px;font-weight:700;letter-spacing:-0.5px;word-break:break-word;overflow-wrap:anywhere;">${escape(content.title)}</h1>
        </td></tr>
        <tr><td style="padding:20px 24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
            <tr>
              <td width="50%" valign="top" style="width:50%;padding:0 12px 0 0;">
                <p style="margin:0 0 7px;color:#5c6a61;font-size:12px;line-height:18px;">Estado</p>
                <span style="display:inline-block;padding:6px 12px;background-color:${statusBackground};color:${statusColor};border-radius:6px;font-size:13px;line-height:20px;font-weight:700;">${escape(state)}</span>
              </td>
              <td width="50%" valign="top" style="width:50%;padding:0;">
                <p style="margin:0 0 7px;color:#5c6a61;font-size:12px;line-height:18px;">Severidade</p>
                <p style="margin:0;padding:6px 0;color:#36493d;font-size:13px;line-height:20px;font-weight:700;">${escape(severity)}</p>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:22px 24px 0;">
          <p style="margin:0;color:#4c5b52;font-size:16px;line-height:26px;word-break:break-word;overflow-wrap:anywhere;">${escape(content.body)}</p>
        </td></tr>
        <tr><td style="padding:22px 24px 0;">
          <p style="margin:0 0 5px;color:#5c6a61;font-size:12px;line-height:18px;">Início do alerta</p>
          <p style="margin:0;color:#36493d;font-size:14px;line-height:22px;">${escape(startedAt)}</p>
          <p style="margin:3px 0 0;color:#5c6a61;font-size:12px;line-height:18px;">Horário de São Paulo (America/Sao_Paulo)</p>
        </td></tr>
        <tr><td style="padding:28px 24px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
            <tr><td align="center" bgcolor="#174b30" style="background-color:#174b30;border-radius:8px;mso-padding-alt:14px 20px;">
              <a href="${safeLink}" style="display:inline-block;padding:14px 20px;color:#f7fbf8;font-size:14px;line-height:20px;font-weight:700;text-decoration:none;mso-padding-alt:0;">Abrir dashboard</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 24px 28px;">
          <p style="margin:0 0 5px;color:#5c6a61;font-size:12px;line-height:20px;">Se o botão não abrir, use este endereço:</p>
          <a href="${safeLink}" style="color:#24523b;font-size:12px;line-height:20px;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${safeLink}</a>
        </td></tr>
        <tr><td style="padding:20px 24px;background-color:#f4f7f5;border-top:1px solid #dce5de;border-radius:0 0 14px 14px;">
          <p style="margin:0;color:#36493d;font-size:12px;line-height:20px;font-weight:700;">Zyon · Notificação operacional</p>
          <p style="margin:4px 0 0;color:#5c6a61;font-size:12px;line-height:20px;">Mensagem automática para acompanhamento da operação.</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}

@Injectable()
export class MarketplaceOperationalAlertSender {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EMAIL_SENDER_PORT) private readonly email: EmailSenderPort,
    @Inject(WHATSAPP_TEMPLATE_SENDER) private readonly whatsapp: WhatsAppTemplateSenderPort) {}
  async prepare(alert: MarketplaceOperationalAlert, channel: OperationalAlertChannel): Promise<PreparedOperationalAlertDelivery> {
    if (process.env.MARKETPLACE_ALERT_MERCHANT_ID?.trim() !== alert.merchantId) return { status:"retryable_failed",reason:"operational_destination_changed" };
    const merchant = await this.prisma.merchant.findUnique({ where:{ id:alert.merchantId },select:{ id:true } });
    if (!merchant) return { status:"retryable_failed",reason:"operational_destination_unavailable" };
    const content = operationalAlertContent(alert);
    if (channel === "dashboard") return { send:async () => {
      // A durable deterministic inbox ID makes a lost local response retry safe.
      try {
        await this.prisma.merchantNotification.upsert({ where:{ id:alert.id },update:{},create:{ id:alert.id,merchantId:alert.merchantId,
          type:"marketplace_operational_alert",...content,metadata:{ alertName:alert.alertName,state:alert.state,severity:alert.severity,startsAt:alert.startsAt.toISOString() } } });
        return { status:"accepted",providerMessageId:alert.id };
      } catch { return { status:"retryable_failed",reason:"dashboard_persistence_unavailable" }; }
    } };
    const link = operationalDashboardLink();
    if (channel === "email") {
      const recipient = process.env.MARKETPLACE_ALERT_EMAIL?.trim();
      if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return { status:"retryable_failed",reason:"operational_email_unavailable" };
      return { send:async () => {
        try {
          const result = await this.email.send({ to:recipient,subject:content.title,
            html:renderOperationalAlertEmail(alert,link),
            requireDelivery:true,idempotencyKey:alert.id+":email" });
          if (result.status === "skipped") return { status:"retryable_failed",reason:"email_provider_unavailable" };
          if (!result.messageId?.trim()) return { status:"unknown",reason:"email_acceptance_unknown" };
          return { status:"accepted",providerMessageId:result.messageId };
        } catch (error) {
          if (error instanceof EmailProviderRejection) return { status:error.retryable?"retryable_failed":"failed",reason:error.retryable?"email_rejected_retryable":"email_rejected" };
          return { status:"unknown",reason:"email_acceptance_unknown" };
        }
      } };
    }
    const phone = process.env.MARKETPLACE_ALERT_WHATSAPP_NUMBER?.trim();
    if (!phone || !/^\+[1-9]\d{9,14}$/.test(phone)) return { status:"retryable_failed",reason:"operational_whatsapp_unavailable" };
    const connection = await this.prisma.whatsAppChannelConfig.findUnique({ where:{ merchantId:alert.merchantId } });
    if (!connection?.enabled || connection.status !== "ACTIVE" || connection.provider !== "META_CLOUD") return { status:"retryable_failed",reason:"operational_meta_unavailable" };
    const type = "marketplace_operational_alert" as const;
    const template = await this.prisma.postSaleMessageTemplate.findUnique({ where:{ merchantId_type_channel:{ merchantId:alert.merchantId,type,channel:"whatsapp" } } });
    if (!template?.isActive || template.metaStatus !== "approved" || !template.twilioContentSid?.trim()) return { status:"retryable_failed",reason:"operational_template_unavailable" };
    const expectedMap = getTemplateDefinition(type).variableMap;
    const map = template.metaVariableMap as Record<string,string> | null;
    if (!map || Object.keys(map).length !== Object.keys(expectedMap).length || Object.entries(expectedMap).some(([key,value]) => map[key] !== value)) return { status:"retryable_failed",reason:"operational_template_variables_invalid" };
    const values:Record<string,string> = { alertName:alert.alertName,alertStatus:alert.state==="resolved"?"resolvido":"ativo",
      alertSeverity:alert.severity==="critical"?"crítica":"atenção",observedAt:alert.startsAt.toISOString(),dashboardLink:link };
    const variables = Object.fromEntries(Object.entries(expectedMap).map(([position,key]) => [position,values[key]]));
    return { send:async () => {
      const result = await this.whatsapp.sendTemplate({ merchantId:alert.merchantId,type,toNumber:phone,contentSid:template.twilioContentSid!,
        language:template.metaLanguage??"pt_BR",contentVariables:variables });
      if (["sent","queued"].includes(result.status) && result.messageId?.trim()) return { status:"accepted",providerMessageId:result.messageId };
      if (result.messageId?.trim()) return { status:"unknown",reason:"whatsapp_acceptance_unknown" };
      if (result.status === "skipped") return { status:"retryable_failed",reason:"operational_template_unavailable" };
      if (result.status === "failed" && result.acceptance === "not_accepted") return {
        status:["meta_http_401","meta_http_403","meta_http_429"].includes(result.reason??"")?"retryable_failed":"failed",reason:"whatsapp_rejected" };
      return { status:"unknown",reason:"whatsapp_acceptance_unknown" };
    } };
  }
}
