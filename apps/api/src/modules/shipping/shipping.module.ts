import { Module } from "@nestjs/common";
import { SelectShippingMethodUseCase } from "./application/use-cases/select-shipping-method.use-case.js";
import { WidgetShippingController } from "./presentation/http/widget-shipping.controller.js";
import { EmbedShippingController } from "./presentation/http/embed-shipping.controller.js";
import { ShippingLabelController } from "./presentation/http/shipping-label.controller.js";
import { MelhorEnvioOAuthController } from "./presentation/http/melhor-envio-oauth.controller.js";
import { DeliveryConfigController } from "./presentation/http/delivery-config.controller.js";
import { EmbedAuthGuard } from "../embed/presentation/http/embed-auth.guard.js";
import { EmbedTokenService } from "../embed/domain/embed-token.service.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { CheckoutPersistenceModule } from "../checkout/checkout-persistence.module.js";
import { FulfillmentModule } from "../fulfillment/fulfillment.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { GetShippingTrackingUseCase, PurchaseShippingLabelUseCase } from "./application/use-cases/shipping-label.use-cases.js";
import { ShippingQuotesModule } from "./shipping-quotes.module.js";
import { ORDER_TRACKING_UPDATER } from "./domain/ports/order-tracking-updater.port.js";
import { SHIPPING_CARRIER_ADAPTER } from "./domain/ports/shipping-carrier.port.js";
import { UpdateTenantOrderTrackingUseCase } from "../integrations/application/integrations.use-cases.js";
import { MelhorEnvioCarrierAdapter } from "./infrastructure/adapters/melhor-envio.carrier.js";
import { GetDeliveryConfigUseCase } from "./application/use-cases/get-delivery-config.use-case.js";
import { UpdateDeliveryConfigUseCase } from "./application/use-cases/update-delivery-config.use-case.js";
import { ListMerchantShipmentsUseCase } from "./application/use-cases/list-merchant-shipments.use-case.js";
import { QuoteRadiusDeliveryUseCase } from "./application/use-cases/quote-radius-delivery.use-case.js";
import { PrismaOwnDeliveryConfigRepository } from "./infrastructure/repositories/prisma-own-delivery-config.repository.js";
import { OWN_DELIVERY_CONFIG_REPOSITORY } from "./domain/ports/own-delivery-config.port.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";

@Module({
  imports: [MerchantModule, FulfillmentModule, IntegrationsModule, CheckoutPersistenceModule, ShippingQuotesModule],
  controllers: [WidgetShippingController, EmbedShippingController, ShippingLabelController, MelhorEnvioOAuthController, DeliveryConfigController],
  providers: [
    EmbedTokenService,
    EmbedAuthGuard,
    SelectShippingMethodUseCase,
    { provide: ORDER_TRACKING_UPDATER, useExisting: UpdateTenantOrderTrackingUseCase },
    { provide: SHIPPING_CARRIER_ADAPTER, useExisting: MelhorEnvioCarrierAdapter },
    PurchaseShippingLabelUseCase,
    GetShippingTrackingUseCase,
    GetDeliveryConfigUseCase,
    UpdateDeliveryConfigUseCase,
    ListMerchantShipmentsUseCase,
    QuoteRadiusDeliveryUseCase,
    {
      provide: OWN_DELIVERY_CONFIG_REPOSITORY,
      useFactory: (prisma: any) => new PrismaOwnDeliveryConfigRepository(prisma),
      inject: [PRISMA_CLIENT]
    }
  ],
  exports: [ShippingQuotesModule, OWN_DELIVERY_CONFIG_REPOSITORY]
})
export class ShippingModule {}
