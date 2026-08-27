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
  ) {}

  async execute(): Promise<{ processed: number; sent: number; failed: number }> {
    const stats = { processed: 0, sent: 0, failed: 0 };

    try {
      // Fetch up to 20 pending messages due for sending
      const pending = await this.messages.findPendingDue(20);
      stats.processed = pending.length;

      for (const msg of pending) {
        try {
          // Generate personalized message content
          const content = await this.copywriter.generate({
            type: msg.type,
            buyerName: msg.buyerName || "Comprador",
            productName: msg.productName || "seu pedido",
            merchantId: msg.merchantId,
            buyerId: msg.buyerId,
          });

          // Send based on channel
          if (msg.channel === "whatsapp" && msg.buyerPhone) {
            await this.whatsapp.send({
              phone: msg.buyerPhone,
              message: content,
            });
          } else if (msg.channel === "email" && msg.buyerEmail) {
            await this.email.send({
              to: msg.buyerEmail,
              subject: this.subjectForType(msg.type),
              html: `<p>${content.replace(/\n/g, "<br>")}</p>`,
              // Omit `from` so ResendEmailAdapter uses its verified RESEND_FROM_EMAIL.
              // The old hardcoded "noreply@aacp.local" is an unverified domain that
              // Resend rejects (400), silently dropping every post-sale email.
            });
          } else {
            this.logger.warn(
              `No valid channel/contact for message`,
              {
                messageId: msg.id,
                channel: msg.channel,
                merchantId: msg.merchantId,
              }
            );
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
