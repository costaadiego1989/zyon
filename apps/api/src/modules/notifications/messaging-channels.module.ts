import { Module } from "@nestjs/common";
import { EMAIL_SENDER_PORT } from "./domain/ports/email-sender.port.js";
import { WHATSAPP_SENDER_PORT } from "./domain/ports/whatsapp-sender.port.js";
import { ResendEmailAdapter } from "./infrastructure/adapters/resend-email.adapter.js";
import { BubbleWhatsAdapter } from "./infrastructure/adapters/bubblewhats.adapter.js";

/**
 * Base transport module: raw email (Resend) + legacy WhatsApp (BubbleWhats)
 * sender ports, with no dependencies of its own.
 *
 * Extracted so both NotificationsModule and WhatsAppTemplatesModule can import
 * the transport ports without depending on each other — this breaks the module
 * cycle without forwardRef. Dependency direction is one-way:
 *   NotificationsModule → WhatsAppTemplatesModule → MessagingChannelsModule
 */
@Module({
  providers: [
    { provide: EMAIL_SENDER_PORT, useClass: ResendEmailAdapter },
    { provide: WHATSAPP_SENDER_PORT, useClass: BubbleWhatsAdapter },
  ],
  exports: [EMAIL_SENDER_PORT, WHATSAPP_SENDER_PORT],
})
export class MessagingChannelsModule {}
