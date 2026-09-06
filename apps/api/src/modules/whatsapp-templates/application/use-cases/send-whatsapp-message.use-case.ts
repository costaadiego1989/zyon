import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
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
import { connectedTwilioCredentials, isApprovedRecoveryTemplate } from "../../domain/services/recovery-whatsapp-policy.js";
import { renderRecoveryText } from "../../domain/recovery-template-content.js";
import { renderRecoveryEmail } from "../../domain/recovery-email.js";

export type WhatsAppProvider = "email" | "bubblewhats" | "twilio";

/**
 * Reads the WhatsApp provider from env. Prefers WHATSAPP_PROVIDER, falls back to
 * the legacy POST_SALE_WHATSAPP_PROVIDER. Recovery uses the merchant connection instead.
 */
export function resolveWhatsAppProvider(): WhatsAppProvider {
  const raw = (process.env.WHATSAPP_PROVIDER || process.env.POST_SALE_WHATSAPP_PROVIDER || "email")
    .trim()
    .toLowerCase();
  return raw === "twilio" || raw === "bubblewhats" ? raw : "email";
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
  /** Pre-rendered freeform text (used for email fallback body + legacy bubblewhats). */
  freeformText?: string;
}

export interface SendWhatsAppMessageResult {
  channel: "whatsapp_template" | "email" | "bubblewhats" | "none";
  status: "sent" | "skipped" | "failed" | "uncertain";
  messageId?: string;
  reason?: string;
}

/**
 * Single entry point for business-initiated WhatsApp across the platform.
 *
 * Routing:
 *  - cart_recovery: active merchant connection + approved active template only;
 *    otherwise email before dispatch. Unknown acceptance never switches channels.
 *  - other types: provider=twilio + approved template → send via ContentSid
 *  - no approved template / creds missing → email fallback
 *  - provider=bubblewhats                 → legacy freeform (opt-in, ban risk)
 *  - provider=email (default)             → email fallback
 *  - no reachable channel                 → none/skipped
 */
@Injectable()
export class SendWhatsAppMessageUseCase {
  private readonly logger = new Logger(SendWhatsAppMessageUseCase.name);

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
    if (input.type === "cart_recovery") return this.sendRecovery(input);
    const provider = resolveWhatsAppProvider();
    const wantsWhatsApp = !!input.toPhone;

    if (wantsWhatsApp && provider === "twilio" && this.templateSender) {
      const tpl = await this.templates
        .findByMerchantAndType(input.merchantId, input.type, "whatsapp")
        .catch(() => null);
      if (tpl && tpl.metaStatus === "approved" && tpl.twilioContentSid) {
        try {
          const result = await this.templateSender.sendTemplate({
            merchantId: input.merchantId,
            toNumber: input.toPhone!,
            contentSid: tpl.twilioContentSid,
            contentVariables: this.resolveVariables(tpl, input.variables ?? {}),
          });
          if (result.status === "sent" || result.status === "queued") {
            return { channel: "whatsapp_template", status: "sent" };
          }
          if (result.status === "uncertain") {
            return { channel: "whatsapp_template", status: "uncertain", reason: result.reason };
          }
          this.logger.warn(
            `Template send ${result.status} (${result.reason ?? "n/a"}) — falling back to email`,
            { merchantId: input.merchantId, type: input.type }
          );
        } catch (err) {
          // transient transport error → rethrow so the caller/queue can retry
          throw err;
        }
      } else {
        this.logger.debug(`No approved template for ${input.type} — falling back to email`, {
          merchantId: input.merchantId,
        });
      }
    } else if (wantsWhatsApp && provider === "bubblewhats" && this.bubbleSender && input.freeformText) {
      const result = await this.bubbleSender.send({ phone: input.toPhone!, message: input.freeformText });
      if (result?.status === "accepted") return { channel: "bubblewhats", status: "sent" };
    }

    return this.sendEmail(input);
  }

  private async sendRecovery(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult> {
    if (input.toPhone?.trim() && this.templateSender && this.configRepo) {
      const config = await this.configRepo.findByMerchantId(input.merchantId).catch(() => null);
      if (connectedTwilioCredentials(config, input.merchantId)) {
        const template = await this.templates
          .findByMerchantAndType(input.merchantId, "cart_recovery", "whatsapp")
          .catch(() => null);
        if (isApprovedRecoveryTemplate(template, input.merchantId)) {
          try {
            const result = await this.templateSender.sendTemplate({
              merchantId: input.merchantId,
              type: "cart_recovery",
              toNumber: input.toPhone,
              contentSid: template.twilioContentSid,
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
    if (input.type === "cart_recovery" && input.fallbackEmail && this.email) {
      let template;
      try { template = await this.templates.findByMerchantAndType(input.merchantId, "cart_recovery", "email"); }
      catch { return { channel: "none", status: "skipped", reason: "email_template_unavailable" }; }
      if (template?.merchantId === input.merchantId && template.type === "cart_recovery" && template.channel === "email") {
        if (!template.isActive) return { channel: "none", status: "skipped", reason: "email_template_disabled" };
        input = { ...input, freeformText: renderRecoveryText(template.body, input.variables ?? {}),
          emailSubject: renderRecoveryText(template.subject ?? "Seu carrinho", input.variables ?? {}).replace(/[\r\n]/g, " ") };
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
          ...(input.type === "cart_recovery" ? { requireDelivery: true } : {}),
        });
      } catch (error) {
        if (input.type !== "cart_recovery") throw error;
        return { channel: "email", status: "uncertain", reason: "provider_acceptance_unknown" };
      }
      if (result.messageId?.trim() && (result.status === "sent" || result.status === "queued")) {
        return input.type === "cart_recovery"
          ? { channel: "email", status: "sent", messageId: result.messageId }
          : { channel: "email", status: "sent" };
      }
      if (input.type === "cart_recovery") {
        if (result.status === "skipped" && !result.messageId) return { channel: "none", status: "skipped", reason: "email_not_configured" };
        return { channel: "email", status: "uncertain", reason: "provider_acceptance_unknown" };
      }
    }

    return { channel: "none", status: "skipped", reason: "no_reachable_channel" };
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
      couponBlock: coupon ? `${coupon}${discount ? ` (${discount} OFF)` : ""}` : "",
      discount,
      link: vars["link"] != null ? String(vars["link"]) : "",
    };
    const out: Record<string, string> = {};
    for (const [pos, name] of Object.entries(map)) out[pos] = values[name] ?? "";
    return out;
  }
}
