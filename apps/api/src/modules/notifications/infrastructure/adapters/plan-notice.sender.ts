import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { EmailProviderRejection } from "../../domain/ports/email-provider-rejection.js";
import { WHATSAPP_TEMPLATE_SENDER, type WhatsAppTemplateSenderPort } from "../../../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js";
import type { WhatsAppTemplateType } from "../../../whatsapp-templates/domain/catalog/template-types.js";
import { planName, planNoticeContent, type PlanNotice } from "../../domain/plan-notice.policy.js";
import type { QuotaDeliveryResult } from "../../domain/ports/order-quota-notice.port.js";

export type PreparedPlanDelivery = QuotaDeliveryResult | { send(): Promise<QuotaDeliveryResult> };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function planLink() {
  const url = new URL(process.env.DASHBOARD_PUBLIC_URL || "https://app.zyon-payments.com.br");
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_dashboard_url");
  url.hash = "billing-plans";
  return url.toString();
}
export function renderPlanNoticeEmail(notice: PlanNotice, merchantName: string) {
  const { title, body } = planNoticeContent(notice);
  return { subject: `Zyon | ${title}`.replace(/[\r\n]/g, " "),
    html: `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body style="margin:0;background:#f5f7f6;color:#22332d;font-family:Arial,sans-serif">
      <main style="max-width:580px;margin:24px auto;padding:32px;background:#fdfefd;border:1px solid #dce4df;border-radius:12px">
      <p style="font-size:13px;color:#50685b">ZYON · SUA ASSINATURA</p><h1 style="font-size:24px;line-height:1.3">${escape(title)}</h1>
      <p style="line-height:1.7">Olá, ${escape(merchantName)}.</p><p style="line-height:1.7">${escape(body)}</p>
      <p style="margin:28px 0"><a href="${escape(planLink())}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#246445;color:#f5faf7;text-decoration:none;font-weight:bold">Consultar meu plano</a></p>
      <p style="font-size:12px;line-height:1.6;color:#50685b">Este é um aviso sobre sua assinatura. Você pode conferir o estado atualizado no painel.</p></main></body></html>` };
}

@Injectable()
export class PlanNoticeSender {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EMAIL_SENDER_PORT) private readonly email: EmailSenderPort,
    @Inject(WHATSAPP_TEMPLATE_SENDER) private readonly whatsapp: WhatsAppTemplateSenderPort) {}
  async prepare(notice: PlanNotice, channel: string): Promise<PreparedPlanDelivery> {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: notice.merchantId },
      select: { name: true, budgetEmail: true, budgetWhatsapp: true, storeSettings: true } });
    if (!merchant) return { status: "skipped", reason: "merchant_removed" };
    if (channel === "email") {
      const owner = await this.prisma.merchantUser.findFirst({ where: { merchantId: notice.merchantId,
        disabledAt: null, role: { in: ["owner", "admin"] } }, orderBy: [{ role: "desc" }, { createdAt: "asc" }], select: { email: true } });
      const recipient = owner?.email?.trim() || merchant.budgetEmail?.trim();
      if (!recipient) return { status: "retryable_failed", reason: "merchant_email_unavailable" };
      const content = renderPlanNoticeEmail(notice, merchant.name);
      return { send: async () => {
        try {
          const result = await this.email.send({ to: recipient, ...content, requireDelivery: true, idempotencyKey: notice.id + ":email" });
          if (result.status === "skipped") return { status: "retryable_failed", reason: "email_provider_unavailable" };
          if (!result.messageId?.trim()) return { status: "unknown", reason: "email_acceptance_unknown" };
          return { status: "accepted", providerMessageId: result.messageId };
        } catch (error) {
          if (error instanceof EmailProviderRejection) return { status: error.retryable ? "retryable_failed" : "failed", reason: error.code };
          return { status: "unknown", reason: "email_acceptance_unknown" };
        }
      } };
    }
    if (channel !== "whatsapp") return { status: "skipped", reason: "unsupported_channel" };
    const connection = await this.prisma.whatsAppChannelConfig.findUnique({ where: { merchantId: notice.merchantId } });
    const settings = merchant.storeSettings as { company?: { phone?: unknown } } | null;
    const phone = merchant.budgetWhatsapp?.trim() || (typeof settings?.company?.phone === "string" ? settings.company.phone.trim() : "");
    if (!phone) return { status: "skipped", reason: "merchant_phone_unavailable" };
    if (!connection?.enabled || connection.status !== "ACTIVE" || connection.provider !== "META_CLOUD") {
      return { status: "skipped", reason: "meta_not_connected" };
    }
    const type = `plan_expiry_${notice.milestone}` as WhatsAppTemplateType;
    const template = await this.prisma.postSaleMessageTemplate.findUnique({
      where: { merchantId_type_channel: { merchantId: notice.merchantId, type, channel: "whatsapp" } },
    });
    if (!template?.isActive || template.metaStatus !== "approved" || !template.twilioContentSid?.trim()) {
      return { status: "skipped", reason: "approved_template_unavailable" };
    }
    const values: Record<string, string> = { merchantName: merchant.name, planName: planName(notice.planKey),
      expiresAt: notice.endsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }),
      dashboardLink: planLink() };
    const map = template.metaVariableMap as Record<string,string> | null;
    if (!map || Object.values(map).some(key => !values[key])) return { status: "skipped", reason: "template_variables_unavailable" };
    const contentVariables = Object.fromEntries(Object.entries(map).map(([position,key]) => [position,values[key]]));
    return { send: async () => {
      const result = await this.whatsapp.sendTemplate({ merchantId: notice.merchantId, type, toNumber: phone,
        contentSid: template.twilioContentSid!, language: template.metaLanguage ?? "pt_BR", contentVariables });
      if ((result.status === "sent" || result.status === "queued") && result.messageId?.trim()) return { status: "accepted", providerMessageId: result.messageId };
      if (result.status === "failed" && result.acceptance === "not_accepted") return { status: result.reason === "meta_http_429" ? "retryable_failed" : "failed", reason: result.reason };
      if (result.status === "skipped") return { status: "skipped", reason: result.reason };
      return { status: "unknown", reason: result.reason ?? "whatsapp_acceptance_unknown" };
    } };
  }
}
