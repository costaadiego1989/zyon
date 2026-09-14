import { PlanNoticeJob } from "./application/services/plan-notice.job.js";
import { PlanNoticeSender } from "./infrastructure/adapters/plan-notice.sender.js";
import { PrismaPlanNoticeRepository } from "./infrastructure/repositories/prisma-plan-notice.repository.js";
import { Module } from "@nestjs/common";
import { EMAIL_SENDER_PORT } from "./domain/ports/email-sender.port.js";
import { WHATSAPP_SENDER_PORT } from "./domain/ports/whatsapp-sender.port.js";
import { ResendEmailAdapter } from "./infrastructure/adapters/resend-email.adapter.js";
import { BubbleWhatsAdapter } from "./infrastructure/adapters/bubblewhats.adapter.js";
import { SendOrderConfirmationUseCase } from "./application/use-cases/send-order-confirmation.use-case.js";
import { SendOrderShippedUseCase } from "./application/use-cases/send-order-shipped.use-case.js";
import { SendOrderDeliveredUseCase } from "./application/use-cases/send-order-delivered.use-case.js";
import { SendReturnApprovedUseCase } from "./application/use-cases/send-return-approved.use-case.js";
import { OrderTrackingNotificationListener } from "./presentation/listeners/order-tracking-notification.listener.js";
import { NotificationListener } from "./presentation/listeners/notification.listener.js";
import { MerchantNotificationController } from "./presentation/http/merchant-notification.controller.js";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { MERCHANT_NOTIFICATION_INBOX_PORT } from "./domain/ports/merchant-notification-inbox.port.js";
import { PrismaMerchantNotificationInboxRepository } from "./infrastructure/repositories/prisma-merchant-notification-inbox.repository.js";
import { ManageMerchantNotificationInboxUseCase } from "./application/use-cases/manage-merchant-notification-inbox.use-case.js";
import { SendMerchantOrderNotificationUseCase } from "./application/use-cases/send-merchant-order-notification.use-case.js";
import { PaymentModule } from "../payment/payment.module.js";
import { WhatsAppTemplatesModule } from "../whatsapp-templates/whatsapp-templates.module.js";
import {
  ORDER_QUOTA_NOTICE_REPOSITORY,
  ORDER_QUOTA_NOTICE_SENDER,
  ORDER_QUOTA_NOTICE_VALIDITY,
} from "./domain/ports/order-quota-notice.port.js";
import { PrismaOrderQuotaNoticeRepository } from "./infrastructure/repositories/prisma-order-quota-notice.repository.js";
import { OrderQuotaNoticeSenderAdapter } from "./infrastructure/adapters/order-quota-notice.sender.js";
import { OrderQuotaNoticeValidityService } from "./application/services/order-quota-notice-validity.service.js";
import { DeliverOrderQuotaNoticeUseCase } from "./application/use-cases/deliver-order-quota-notice.use-case.js";
import { OrderQuotaNoticeDeliveryJob } from "./application/services/order-quota-notice-delivery.job.js";

@Module({
  imports: [PersistenceModule, PaymentModule, WhatsAppTemplatesModule],
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
    OrderTrackingNotificationListener,
    ManageMerchantNotificationInboxUseCase,
    SendMerchantOrderNotificationUseCase,
    PrismaOrderQuotaNoticeRepository,
    { provide: ORDER_QUOTA_NOTICE_REPOSITORY, useExisting: PrismaOrderQuotaNoticeRepository },
    { provide: ORDER_QUOTA_NOTICE_SENDER, useClass: OrderQuotaNoticeSenderAdapter },
    { provide: ORDER_QUOTA_NOTICE_VALIDITY, useClass: OrderQuotaNoticeValidityService },
    DeliverOrderQuotaNoticeUseCase,
    OrderQuotaNoticeDeliveryJob,
    PlanNoticeJob, PlanNoticeSender, PrismaPlanNoticeRepository,
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
