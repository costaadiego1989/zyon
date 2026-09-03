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

export type WhatsAppProvider = "email" | "bubblewhats" | "twilio";

/**
 * Reads the WhatsApp provider from env. Prefers WHATSAPP_PROVIDER, falls back to
 * the legacy POST_SALE_WHATSAPP_PROVIDER. Default `email` = safe (no ban risk).
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
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

/**
 * Single entry point for business-initiated WhatsApp across the platform.
 *
 * Routing:
 *  - provider=twilio + approved template  → send via ContentSid (safe, no ban)
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
    private readonly email?: EmailSenderPort
  ) {}

  async execute(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult> {
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
      await this.bubbleSender.send({ phone: input.toPhone!, message: input.freeformText });
      return { channel: "bubblewhats", status: "sent" };
    }

    // Email fallback.
    if (input.fallbackEmail && this.email && input.freeformText) {
      await this.email.send({
        to: input.fallbackEmail,
        subject: input.emailSubject || "Mensagem da loja",
        html: `<p>${input.freeformText.replace(/\n/g, "<br>")}</p>`,
      });
      return { channel: "email", status: "sent" };
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
