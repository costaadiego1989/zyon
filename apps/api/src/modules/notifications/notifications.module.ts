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
import { MerchantNotificationController } from "./presentation/http/merchant-notification.controller.js";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { MERCHANT_NOTIFICATION_INBOX_PORT } from "./domain/ports/merchant-notification-inbox.port.js";
import { PrismaMerchantNotificationInboxRepository } from "./infrastructure/repositories/prisma-merchant-notification-inbox.repository.js";
import { ManageMerchantNotificationInboxUseCase } from "./application/use-cases/manage-merchant-notification-inbox.use-case.js";
import { SendMerchantOrderNotificationUseCase } from "./application/use-cases/send-merchant-order-notification.use-case.js";

@Module({
  imports: [PersistenceModule],
  controllers: [MerchantNotificationController],
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
    ManageMerchantNotificationInboxUseCase,
    SendMerchantOrderNotificationUseCase,
    { provide: MERCHANT_NOTIFICATION_INBOX_PORT, useClass: PrismaMerchantNotificationInboxRepository },
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
