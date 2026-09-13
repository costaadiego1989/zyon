import { Injectable, Inject, Optional } from "@nestjs/common";
import {
  WHATSAPP_TEMPLATE_REPOSITORY,
  type WhatsAppTemplateRepositoryPort,
  type WhatsAppTemplateRecord,
} from "../../domain/ports/whatsapp-template-repository.port.js";
import {
  WHATSAPP_TEMPLATE_SENDER,
  type WhatsAppTemplateSenderPort,
} from "../../domain/ports/whatsapp-template-sender.port.js";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort } from "../../../notifications/domain/ports/whatsapp-sender.port.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../../notifications/domain/ports/email-sender.port.js";
import type { WhatsAppTemplateType } from "../../domain/catalog/template-types.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudRecoveryCredentials, isApprovedSalesTemplate } from "../../domain/services/recovery-whatsapp-policy.js";
import { renderRecoveryEmail } from "../../domain/recovery-email.js";

export type WhatsAppProvider = "email" | "bubblewhats" | "meta";

/**
 * Reads the WhatsApp provider from env. Prefers WHATSAPP_PROVIDER, falls back to
 * the legacy POST_SALE_WHATSAPP_PROVIDER. Recovery uses the merchant connection instead.
 */
export function resolveWhatsAppProvider(): WhatsAppProvider {
  const raw = (process.env.WHATSAPP_PROVIDER || process.env.POST_SALE_WHATSAPP_PROVIDER || "email")
    .trim()
    .toLowerCase();
  return raw === "meta" || raw === "meta_cloud" ? "meta" : raw === "bubblewhats" ? "bubblewhats" : "email";
}

export interface SendWhatsAppMessageInput {
  merchantId: string;
  type: WhatsAppTemplateType;
  toPhone?: string;
  /** Semantic variables: buyerName, productName, coupon, discountPercent, orderId, trackingCode, link. */
  variables?: Record<string, string | number | undefined>;
  /** Fallback email recipient when WhatsApp can't be used safely. */
  fallbackEmail?: string;
  /** Subject for the email fallback. */
  emailSubject?: string;
  /** Pre-rendered text for the email fallback body. */
  freeformText?: string;
}

export interface SendWhatsAppMessageResult {
  channel: "whatsapp_template" | "email" | "bubblewhats" | "none";
  status: "sent" | "skipped" | "failed" | "uncertain";
  messageId?: string;
  reason?: string;
}

/** Official Meta templates for sales automation; uncertain acceptance never switches channels. */
@Injectable()
export class SendWhatsAppMessageUseCase {

  constructor(
    @Inject(WHATSAPP_TEMPLATE_REPOSITORY)
    private readonly templates: WhatsAppTemplateRepositoryPort,
    @Optional()
    @Inject(WHATSAPP_TEMPLATE_SENDER)
    private readonly templateSender?: WhatsAppTemplateSenderPort,
    @Optional()
    @Inject(WHATSAPP_SENDER_PORT)
    private readonly bubbleSender?: WhatsAppSenderPort,
    @Optional()
    @Inject(EMAIL_SENDER_PORT)
    private readonly email?: EmailSenderPort,
    @Optional()
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo?: WhatsAppConfigRepository,
  ) {}

  async execute(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult> {
    return this.sendSalesMessage(input);
  }

  private async sendSalesMessage(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult> {
    if (input.toPhone?.trim() && this.templateSender && this.configRepo) {
      const config = await this.configRepo.findByMerchantId(input.merchantId).catch(() => null);
      const connection = connectedMetaCloudRecoveryCredentials(config, input.merchantId);
      if (connection) {
        const template = await this.templates
          .findByMerchantAndType(input.merchantId, input.type, "whatsapp")
          .catch(() => null);
        if (isApprovedSalesTemplate(template, input.merchantId, input.type, connection.wabaId)) {
          try {
            const result = await this.templateSender.sendTemplate({
              merchantId: input.merchantId,
              type: input.type,
              toNumber: input.toPhone,
              contentSid: template.twilioContentSid,
              language: template.metaLanguage ?? "pt_BR",
              contentVariables: this.resolveVariables(template, input.variables ?? {}),
            });
            if ((result.status === "sent" || result.status === "queued") && result.messageId?.trim()) {
              return { channel: "whatsapp_template", status: "sent", messageId: result.messageId };
            }
            if (result.status === "failed") {
              if (result.acceptance === "not_accepted" && !result.messageId?.trim()) {
                return this.sendEmail(input);
              }
              return { channel: "whatsapp_template", status: "failed", reason: result.reason ?? "provider_rejected" };
            }
            // Skipped also proves that dispatch never occurred. Every other
            // unconfirmed result must be reconciled on the original channel.
            if (result.status !== "skipped" || result.messageId?.trim()) {
              return { channel: "whatsapp_template", status: "uncertain", reason: result.reason ?? "provider_acceptance_unknown" };
            }
          } catch {
            return { channel: "whatsapp_template", status: "uncertain", reason: "provider_acceptance_unknown" };
          }
        }
      }
    }
    return this.sendEmail(input);
  }

  private async sendEmail(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult> {
    if (input.fallbackEmail && this.email) {
      let template;
      try { template = await this.templates.findByMerchantAndType(input.merchantId, input.type, "email"); }
      catch { return { channel: "none", status: "skipped", reason: "email_template_unavailable" }; }
      if (template?.merchantId === input.merchantId && template.type === input.type && template.channel === "email") {
        if (!template.isActive) return { channel: "none", status: "skipped", reason: "email_template_disabled" };
        input = { ...input, freeformText: this.renderText(template.body, input.variables ?? {}),
          emailSubject: this.renderText(template.subject ?? "Mensagem da loja", input.variables ?? {}).replace(/[\r\n]/g, " ") };
      }
    }
    if (input.fallbackEmail && this.email && input.freeformText) {
      const html = input.freeformText.replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\n/g, "<br>");
      let result;
      try {
        result = await this.email.send({
          to: input.fallbackEmail,
          subject: input.emailSubject || "Mensagem da loja",
          html: input.type === "cart_recovery"
            ? renderRecoveryEmail(input.freeformText, String(input.variables?.storeName ?? "Sua loja"), input.variables?.link == null ? undefined : String(input.variables.link))
            : `<p>${html}</p>`,
          requireDelivery: true,
        });
      } catch (error) {
        return { channel: "email", status: "uncertain", reason: "provider_acceptance_unknown" };
      }
      if (result.messageId?.trim() && (result.status === "sent" || result.status === "queued")) {
        return { channel: "email", status: "sent", messageId: result.messageId };
      }
      {
        if (result.status === "skipped" && !result.messageId) return { channel: "none", status: "skipped", reason: "email_not_configured" };
        return { channel: "email", status: "uncertain", reason: "provider_acceptance_unknown" };
      }
    }

    return { channel: "none", status: "skipped", reason: "no_reachable_channel" };
  }

  private renderText(body: string, vars: Record<string, string | number | undefined>) {
    return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? (key === "buyerName" ? "Cliente" : key === "storeName" ? "nossa loja" : "")));
  }

  /** Map the template's positional slots to runtime values from `variables`. */
  private resolveVariables(
    tpl: WhatsAppTemplateRecord,
    vars: Record<string, string | number | undefined>
  ): Record<string, string> {
    const map = tpl.metaVariableMap ?? {};
    const coupon = vars["coupon"] != null ? String(vars["coupon"]) : "";
    const discount = vars["discount"] != null ? String(vars["discount"]) : vars["discountPercent"] != null ? `${vars["discountPercent"]}%` : "";
    const values: Record<string, string> = {
      buyerName: vars["buyerName"] != null ? String(vars["buyerName"]) : "Cliente",
      storeName: vars["storeName"] != null ? String(vars["storeName"]) : "nossa loja",
      productName: vars["productName"] != null ? String(vars["productName"]) : "seu pedido",
      orderId: vars["orderId"] != null ? String(vars["orderId"]) : "",
      trackingCode: vars["trackingCode"] != null ? String(vars["trackingCode"]) : "",
      coupon,
      couponBlock: vars["couponBlock"] != null ? String(vars["couponBlock"]) : coupon ? `${coupon}${discount ? ` (${discount} OFF)` : ""}` : "Consulte as condições disponíveis na loja.",
      discount,
      link: vars["link"] != null ? String(vars["link"]) : "",
    };
    const out: Record<string, string> = {};
    for (const [pos, name] of Object.entries(map)) out[pos] = values[name] ?? "";
    return out;
  }
}
