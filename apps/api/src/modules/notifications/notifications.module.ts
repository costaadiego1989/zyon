import { Module } from "@nestjs/common";
import { EMAIL_SENDER_PORT } from "./domain/ports/email-sender.port.js";
import { WHATSAPP_SENDER_PORT } from "./domain/ports/whatsapp-sender.port.js";
import { ResendEmailAdapter } from "./infrastructure/adapters/resend-email.adapter.js";
import { BubbleWhatsAdapter } from "./infrastructure/adapters/bubblewhats.adapter.js";
import { SendOrderConfirmationUseCase } from "./application/use-cases/send-order-confirmation.use-case.js";
import { SendOrderShippedUseCase } from "./application/use-cases/send-order-shipped.use-case.js";
import { SendOrderDeliveredUseCase } from "./application/use-cases/send-order-delivered.use-case.js";
import { SendReturnApprovedUseCase } from "./application/use-cases/send-return-approved.use-case.js";
import { NotificationListener } from "./presentation/listeners/notification.listener.js";

@Module({
  providers: [
    {
      provide: EMAIL_SENDER_PORT,
      useClass: ResendEmailAdapter,
    },
    {
      provide: WHATSAPP_SENDER_PORT,
      useClass: BubbleWhatsAdapter,
    },
    SendOrderConfirmationUseCase,
    SendOrderShippedUseCase,
    SendOrderDeliveredUseCase,
    SendReturnApprovedUseCase,
    NotificationListener,
  ],
  exports: [
    EMAIL_SENDER_PORT,
    WHATSAPP_SENDER_PORT,
    SendOrderConfirmationUseCase,
    SendOrderShippedUseCase,
    SendOrderDeliveredUseCase,
    SendReturnApprovedUseCase,
  ],
})
export class NotificationsModule {}
