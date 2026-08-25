import { Injectable, Logger, Inject } from "@nestjs/common";
import {
  SCHEDULED_MESSAGE_REPOSITORY,
  type ScheduledMessageRepositoryPort,
} from "../../domain/ports/scheduled-message-repository.port.js";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort } from "../../../notifications/domain/ports/whatsapp-sender.port.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../../notifications/domain/ports/email-sender.port.js";
import { PostSaleAiCopywriterService } from "../services/post-sale-ai-copywriter.service.js";

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
    private readonly copywriter: PostSaleAiCopywriterService
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
              from: "noreply@aacp.local",
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
          await this.messages.update(msg.id, {
            status: "failed",
          });
          this.logger.error(
            `Failed to process message`,
            {
              messageId: msg.id,
              type: msg.type,
              error: err instanceof Error ? err.message : String(err),
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
