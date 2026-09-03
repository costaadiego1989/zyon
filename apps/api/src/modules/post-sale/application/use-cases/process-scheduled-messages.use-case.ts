import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import {
  SCHEDULED_MESSAGE_REPOSITORY,
  type ScheduledMessageRepositoryPort,
} from "../../domain/ports/scheduled-message-repository.port.js";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort } from "../../../notifications/domain/ports/whatsapp-sender.port.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../../notifications/domain/ports/email-sender.port.js";
import { PostSaleAiCopywriterService } from "../services/post-sale-ai-copywriter.service.js";
import {
  WHATSAPP_POST_SALE_CONTEXT_PORT,
  type WhatsAppPostSaleContextPort,
} from "../../../whatsapp-channel/domain/ports/whatsapp-post-sale-context.port.js";
import {
  POST_SALE_WHATSAPP_SENDER,
  type PostSaleWhatsAppSenderPort,
} from "../../domain/ports/post-sale-whatsapp-sender.port.js";
import {
  POST_SALE_TEMPLATE_REPOSITORY,
  type PostSaleTemplateRepositoryPort,
  type PostSaleTemplate,
} from "../../domain/ports/post-sale-template-repository.port.js";

/**
 * Transport for business-initiated WhatsApp. Default `email` is the safe choice
 * (no Meta ban risk). `twilio` uses Meta-approved templates; `bubblewhats` is
 * the legacy informal path (risky, kept only for explicit opt-in).
 */
type PostSaleWhatsAppProvider = "email" | "bubblewhats" | "twilio";

function resolveProvider(): PostSaleWhatsAppProvider {
  const raw = (process.env.POST_SALE_WHATSAPP_PROVIDER || "email").trim().toLowerCase();
  return raw === "twilio" || raw === "bubblewhats" ? raw : "email";
}

@Injectable()
export class ProcessScheduledMessagesUseCase {
  private readonly logger = new Logger(ProcessScheduledMessagesUseCase.name);

  constructor(
    @Inject(SCHEDULED_MESSAGE_REPOSITORY)
    private readonly messages: ScheduledMessageRepositoryPort,
    @Inject(WHATSAPP_SENDER_PORT)
    private readonly whatsapp: WhatsAppSenderPort,
    @Inject(EMAIL_SENDER_PORT)
    private readonly email: EmailSenderPort,
    private readonly copywriter: PostSaleAiCopywriterService,
    @Optional() @Inject(WHATSAPP_POST_SALE_CONTEXT_PORT)
    private readonly contextPort?: WhatsAppPostSaleContextPort,
    @Optional() @Inject(POST_SALE_WHATSAPP_SENDER)
    private readonly templateSender?: PostSaleWhatsAppSenderPort,
    @Optional() @Inject(POST_SALE_TEMPLATE_REPOSITORY)
    private readonly templates?: PostSaleTemplateRepositoryPort,
  ) {}

  async execute(): Promise<{ processed: number; sent: number; failed: number }> {
    const stats = { processed: 0, sent: 0, failed: 0 };

    try {
      // Fetch up to 20 pending messages due for sending
      const pending = await this.messages.findPendingDue(20);
      stats.processed = pending.length;

      for (const msg of pending) {
        try {
          // Surface coupon/link data carried in metadata so loyalty, win-back,
          // cross-sell and reorder messages actually contain the coupon the
          // system already created (was dropped before — dead "#" link).
          const meta = (msg.metadata ?? {}) as Record<string, unknown>;
          const couponCode = typeof meta["couponCode"] === "string" ? (meta["couponCode"] as string) : undefined;
          const discountPercent =
            typeof meta["discountPercent"] === "number" ? (meta["discountPercent"] as number) : undefined;
          const freeShipping = meta["freeShipping"] === true;
          const expiresAt = typeof meta["expiresAt"] === "string" ? (meta["expiresAt"] as string) : undefined;
          const metaLink =
            typeof meta["reorderLink"] === "string"
              ? (meta["reorderLink"] as string)
              : typeof meta["link"] === "string"
                ? (meta["link"] as string)
                : undefined;

          // Generate personalized message content
          const content = await this.copywriter.generate({
            type: msg.type,
            buyerName: msg.buyerName || "Comprador",
            productName: msg.productName || "seu pedido",
            merchantId: msg.merchantId,
            buyerId: msg.buyerId,
            couponCode,
            discountPercent,
            freeShipping,
            expiresAt,
            link: metaLink,
          });

          // Route the send. WhatsApp business-initiated must use a Meta-approved
          // template (Twilio) — never informal freeform (ban risk). When no
          // approved template exists, fall back to email so the buyer is still
          // reached and nothing risks the number.
          const outcome = await this.route({
            msg,
            content,
            couponCode,
            discountPercent,
          });

          if (outcome === "skipped") {
            this.logger.warn(`No valid channel/contact for message`, {
              messageId: msg.id,
              channel: msg.channel,
              merchantId: msg.merchantId,
            });
            continue;
          }

          // Mark as sent
          await this.messages.update(msg.id, {
            status: "sent",
            sentAt: new Date(),
            messageContent: content,
          });
          stats.sent++;

          // Set WhatsApp post-sale context so the reply handler can capture responses
          if (msg.channel === "whatsapp" && msg.buyerPhone && this.contextPort) {
            const stage = msg.type === "nps" ? "awaiting_nps" : msg.type === "review_request" ? "awaiting_review" : null;
            if (stage) {
              try {
                const productId = (msg.metadata as Record<string, unknown> | null)?.["productId"] as string | undefined;
                await this.contextPort.setPostSaleContext(msg.merchantId, msg.buyerPhone, {
                  stage,
                  orderId: msg.orderId,
                  productId,
                  buyerId: msg.buyerId,
                  askedAt: new Date().toISOString(),
                });
              } catch (err) {
                this.logger.warn("Failed to set post-sale context on WA session", {
                  messageId: msg.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }

          this.logger.log(
            `Message sent`,
            {
              messageId: msg.id,
              type: msg.type,
              channel: msg.channel,
              merchantId: msg.merchantId,
            }
          );
        } catch (err) {
          stats.failed++;
          const errMsg = err instanceof Error ? err.message : String(err);

          // Transport/temporary failures → requeue as pending for retry on next tick.
          // Permanent failures (e.g. invalid phone format) → mark failed.
          const isTransient = errMsg.includes("transport_failed") ||
            errMsg.includes("ECONNREFUSED") ||
            errMsg.includes("ETIMEDOUT") ||
            errMsg.includes("429") ||
            errMsg.includes("503");

          await this.messages.update(msg.id, {
            status: isTransient ? "pending" : "failed",
          });

          this.logger.error(
            `Failed to process message (${isTransient ? "will retry" : "permanent"})`,
            {
              messageId: msg.id,
              type: msg.type,
              error: errMsg,
              merchantId: msg.merchantId,
            }
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Error in scheduled message processor`,
        { error: err instanceof Error ? err.message : String(err) }
      );
    }

    return stats;
  }

  /**
   * Deliver one message on the safest available channel.
   * Returns "sent" or "skipped" (no reachable channel). Throws on transient
   * transport errors so the outer catch requeues for retry.
   */
  private async route(args: {
    msg: {
      id: string;
      merchantId: string;
      type: string;
      channel: string;
      buyerPhone: string | null;
      buyerEmail: string | null;
      buyerName: string | null;
      productName: string | null;
    };
    content: string;
    couponCode?: string;
    discountPercent?: number;
  }): Promise<"sent" | "skipped"> {
    const { msg, content } = args;
    const provider = resolveProvider();
    const wantsWhatsApp = msg.channel === "whatsapp" && !!msg.buyerPhone;

    if (wantsWhatsApp && provider === "twilio" && this.templateSender && this.templates) {
      const tpl = await this.templates
        .findByMerchantAndType(msg.merchantId, msg.type, "whatsapp")
        .catch(() => null);
      if (tpl && tpl.metaStatus === "approved" && tpl.twilioContentSid) {
        const result = await this.templateSender.sendTemplate({
          merchantId: msg.merchantId,
          toNumber: msg.buyerPhone!,
          contentSid: tpl.twilioContentSid,
          contentVariables: this.resolveContentVariables(tpl, args),
        });
        if (result.status === "sent" || result.status === "queued") {
          return "sent";
        }
        // Template send skipped (missing creds) or permanently failed → fall
        // through to email so the buyer is still reached.
        this.logger.warn(
          `WhatsApp template send ${result.status} (${result.reason ?? "n/a"}) — falling back to email`,
          { messageId: msg.id, merchantId: msg.merchantId }
        );
      } else {
        this.logger.debug(
          `No approved WhatsApp template for ${msg.type} — falling back to email`,
          { messageId: msg.id, merchantId: msg.merchantId }
        );
      }
    } else if (wantsWhatsApp && provider === "bubblewhats") {
      // Explicit legacy opt-in only. Ban risk acknowledged by config.
      await this.whatsapp.send({ phone: msg.buyerPhone!, message: content });
      return "sent";
    }

    // Email fallback (also the default channel when no phone).
    if (msg.buyerEmail) {
      await this.email.send({
        to: msg.buyerEmail,
        subject: this.subjectForType(msg.type),
        html: `<p>${content.replace(/\n/g, "<br>")}</p>`,
        // Omit `from` so ResendEmailAdapter uses its verified RESEND_FROM_EMAIL.
      });
      return "sent";
    }

    return "skipped";
  }

  /**
   * Map the template's positional variable slots to runtime values.
   * variableMap is {"1":"buyerName","2":"couponCode",...}; we look each name up
   * against the message + coupon data.
   */
  private resolveContentVariables(
    tpl: PostSaleTemplate,
    args: {
      msg: { buyerName: string | null; productName: string | null };
      content: string;
      couponCode?: string;
      discountPercent?: number;
    }
  ): Record<string, string> {
    const map = tpl.metaVariableMap ?? {};
    const values: Record<string, string> = {
      buyerName: args.msg.buyerName || "Cliente",
      productName: args.msg.productName || "seu pedido",
      coupon: args.couponCode || "",
      couponBlock: args.couponCode
        ? `${args.couponCode}${args.discountPercent ? ` (${args.discountPercent}% OFF)` : ""}`
        : "",
      discount: args.discountPercent ? `${args.discountPercent}%` : "",
      link: "",
    };
    const out: Record<string, string> = {};
    for (const [pos, name] of Object.entries(map)) {
      out[pos] = values[name] ?? "";
    }
    return out;
  }

  private subjectForType(type: string): string {
    const subjects: Record<string, string> = {
      follow_up: "Como você está?",
      review_request: "Deixe sua avaliação",
      cross_sell: "Confira nossos produtos",
      nps: "Sua opinião importa",
      win_back: "Que saudade!",
      loyalty: "Parabéns!",
      reorder: "Hora de repor",
    };
    return subjects[type] || "Novidade para você";
  }
}
