import { Global, Module, forwardRef } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import {
  PRISMA_CLIENT,
  PersistenceModule,
} from "../../shared/persistence/persistence.module.js";
import { TenantContextService } from "../../shared/tenant/tenant-context.service.js";
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from "../../shared/events/domain-event-bus.port.js";
import { OUTBOX_BACKGROUND_TICK } from "../../shared/messaging/outbox-dispatcher.service.js";
import { MessagingModule } from "../../shared/messaging/messaging.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { BuyerAccountModule } from "../buyer-account/buyer-account.module.js";
import { EmbedModule } from "../embed/embed.module.js";
import { PaymentModule } from "../payment/payment.module.js";
import {
  PAYMENT_PROVIDER_PORT,
  type PaymentProviderPort,
} from "../payment/domain/ports/payment-provider.port.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import {
  EMAIL_SENDER_PORT,
  type EmailSenderPort,
} from "../notifications/domain/ports/email-sender.port.js";
import { WhatsAppChannelModule } from "../whatsapp-channel/whatsapp-channel.module.js";
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsAppConfigRepository,
} from "../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { MetaCloudSenderAdapter } from "../whatsapp-channel/infrastructure/adapters/meta-cloud-sender.adapter.js";
import { TwilioSenderAdapter } from "../whatsapp-channel/infrastructure/adapters/twilio-sender.adapter.js";
import { WhatsAppTemplatesModule } from "../whatsapp-templates/whatsapp-templates.module.js";
import {
  WHATSAPP_TEMPLATE_REPOSITORY,
  type WhatsAppTemplateRepositoryPort,
} from "../whatsapp-templates/domain/ports/whatsapp-template-repository.port.js";
import {
  WHATSAPP_TEMPLATE_SENDER,
  type WhatsAppTemplateSenderPort,
} from "../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js";
import { FISCAL_WEBHOOK_DISPATCH } from "../../shared/integrations/fiscal-webhook-dispatch.port.js";
import { FISCAL_DELIVERY_DISPATCH } from "../../shared/integrations/fiscal-delivery-dispatch.port.js";
import { FISCAL_BEFORE_PAYMENT } from "./domain/fiscal-checkout.port.js";
import { FISCAL_RECIPIENT_COLLECTION } from "./domain/fiscal-recipient-collection.port.js";
import { FISCAL_RECIPIENT_STORE } from "./domain/fiscal-recipient-update.port.js";
import { FISCAL_POSTAL_LOOKUP } from "./domain/fiscal-postal-lookup.port.js";
import {
  FISCAL_ORDER_COMMIT_FACTORY,
  FISCAL_ASSISTANT,
} from "./fiscal-runtime.ports.js";
import { FiscalRuntime } from "./infrastructure/fiscal-runtime.js";
import { FISCAL_OLIST_OAUTH } from "./domain/fiscal-olist-oauth.port.js";
import { FISCAL_OLIST_NOTIFICATIONS } from "./domain/fiscal-olist-notifications.port.js";
import { FiscalOlistNotificationsController, FiscalOlistNotificationCallbackController } from "./presentation/fiscal-olist-notifications.controller.js";
import { FiscalOlistOAuthController, FiscalOlistOAuthCallbackController } from "./presentation/fiscal-olist-oauth.controller.js";
import { PrismaFiscalOrderParticipant } from "./infrastructure/prisma-fiscal-order.participant.js";
import { fiscalProfileSupport } from "./infrastructure/fiscal-profile-support.js";
import { FiscalConnectionService } from "./application/fiscal-connection.service.js";
import { FiscalProfileService } from "./application/fiscal-profile.service.js";
import { FiscalSetupService } from "./application/fiscal-setup.service.js";
import { FiscalMerchantInvoicesService } from "./application/fiscal-merchant-invoices.service.js";
import { FiscalIssuanceService } from "./application/fiscal-issuance.service.js";
import { FiscalReconciliationService } from "./application/fiscal-reconciliation.service.js";
import { FiscalCancellationService } from "./application/fiscal-cancellation.service.js";
import { FiscalDocumentService } from "./application/fiscal-document.service.js";
import { FiscalDeliveryService } from "./application/fiscal-delivery.service.js";
import { FiscalWorker } from "./infrastructure/fiscal.worker.js";
import { FiscalRecipientUpdateService } from "./application/fiscal-recipient-update.service.js";
import { FISCAL_RECIPIENT_PREPARATION } from "./application/fiscal-recipient-preparation.service.js";
import { FiscalConfigurationController } from "./presentation/fiscal-configuration.controller.js";
import { FiscalInvoicesController } from "./presentation/fiscal-invoices.controller.js";
import { FiscalTemplateController } from "./presentation/fiscal-template.controller.js";
import { FiscalCheckoutController } from "./presentation/fiscal-checkout.controller.js";
import {
  BuyerFiscalController,
  FISCAL_DOCUMENT_SERVICE,
} from "./presentation/buyer-fiscal.controller.js";
import { FiscalWebhooksController } from "./presentation/fiscal-webhooks.controller.js";
import { FiscalDeliveryCallbacksController } from "./presentation/fiscal-delivery-callbacks.controller.js";
import { MetricsService } from "../../shared/observability/metrics.service.js";
import { PinoLogger } from "nestjs-pino";
import { FiscalObservability } from "./infrastructure/fiscal-observability.js";
const aliases = [
  [FISCAL_OLIST_OAUTH, "olistOAuth"],
  [FISCAL_OLIST_NOTIFICATIONS, "olistNotifications"],
  [FiscalIssuanceService, "issuance"],
  [FiscalReconciliationService, "reconciliation"],
  [FiscalCancellationService, "cancellation"],
  [FiscalDocumentService, "documents"],
  [FiscalDeliveryService, "deliveries"],
  [FiscalWorker, "worker"],
  [FiscalConnectionService, "connections"],
  [FiscalProfileService, "profiles"],
  [FiscalSetupService, "setup"],
  [FiscalMerchantInvoicesService, "invoices"],
  [FISCAL_BEFORE_PAYMENT, "beforePayment"],
  [FISCAL_RECIPIENT_COLLECTION, "collection"],
  [FISCAL_RECIPIENT_STORE, "recipientStore"],
  [FISCAL_POSTAL_LOOKUP, "postal"],
  [FISCAL_RECIPIENT_PREPARATION, "preparation"],
  [FISCAL_DOCUMENT_SERVICE, "documents"],
  [FISCAL_WEBHOOK_DISPATCH, "webhook"],
  [FISCAL_DELIVERY_DISPATCH, "deliveryCallbacks"],
] as const;
@Global()
@Module({
  imports: [
    PersistenceModule,
    MessagingModule,
    AuthModule,
    BuyerAccountModule,
    forwardRef(() => EmbedModule),
    forwardRef(() => PaymentModule),
    NotificationsModule,
    forwardRef(() => WhatsAppChannelModule),
    WhatsAppTemplatesModule,
  ],
  controllers: [
    FiscalOlistOAuthController,
    FiscalOlistOAuthCallbackController,
    FiscalOlistNotificationsController,
    FiscalOlistNotificationCallbackController,
    FiscalConfigurationController,
    FiscalInvoicesController,
    FiscalTemplateController,
    FiscalCheckoutController,
    BuyerFiscalController,
    FiscalWebhooksController,
    FiscalDeliveryCallbacksController,
  ],
  providers: [
    {
      provide: FiscalRuntime,
      useFactory: (
        db: PrismaClient,
        tenants: TenantContextService,
        bus: DomainEventBus,
        payment: PaymentProviderPort,
        email: EmailSenderPort,
        configs: WhatsAppConfigRepository,
        meta: MetaCloudSenderAdapter,
        twilio: TwilioSenderAdapter,
        templates: WhatsAppTemplateRepositoryPort,
        templateSender: WhatsAppTemplateSenderPort,
        metrics: MetricsService,
        logger: PinoLogger
      ) =>
        new FiscalRuntime(
          db,
          tenants,
          bus,
          payment,
          email,
          configs,
          meta,
          twilio,
          templates,
          templateSender,
          new FiscalObservability(metrics.registry, logger)
        ),
      inject: [
        PRISMA_CLIENT,
        TenantContextService,
        DOMAIN_EVENT_BUS,
        PAYMENT_PROVIDER_PORT,
        EMAIL_SENDER_PORT,
        WHATSAPP_CONFIG_REPOSITORY,
        MetaCloudSenderAdapter,
        TwilioSenderAdapter,
        WHATSAPP_TEMPLATE_REPOSITORY,
        WHATSAPP_TEMPLATE_SENDER,
        MetricsService,
        PinoLogger,
      ],
    },
    ...aliases.map(([provide, key]) => ({
      provide,
      useFactory: (runtime: FiscalRuntime) => runtime[key],
      inject: [FiscalRuntime],
    })),
    {
      provide: FISCAL_ASSISTANT,
      useFactory: (runtime: FiscalRuntime) => ({
        documents: runtime.documents,
        environment: runtime.environment,
      }),
      inject: [FiscalRuntime],
    },
    {
      provide: FISCAL_ORDER_COMMIT_FACTORY,
      useFactory:
        (runtime: FiscalRuntime, tenants: TenantContextService) =>
        (tx: import("@prisma/client").Prisma.TransactionClient) =>
          new PrismaFiscalOrderParticipant(
            tx,
            runtime.environment,
            tenants,
            fiscalProfileSupport
          ),
      inject: [FiscalRuntime, TenantContextService],
    },
    { provide: OUTBOX_BACKGROUND_TICK, useExisting: FiscalRuntime },
    FiscalRecipientUpdateService,
  ],
  exports: [
    FiscalRuntime,
    ...aliases.map(([provide]) => provide),
    FISCAL_ASSISTANT,
    FISCAL_ORDER_COMMIT_FACTORY,
    OUTBOX_BACKGROUND_TICK,
  ],
})
export class FiscalModule {}
