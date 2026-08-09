import { Module } from "@nestjs/common";
import { SelectShippingMethodUseCase } from "./application/use-cases/select-shipping-method.use-case.js";
import { WidgetShippingController } from "./presentation/http/widget-shipping.controller.js";
import { EmbedShippingController } from "./presentation/http/embed-shipping.controller.js";
import { ShippingLabelController } from "./presentation/http/shipping-label.controller.js";
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

@Module({
  imports: [MerchantModule, FulfillmentModule, IntegrationsModule, CheckoutPersistenceModule, ShippingQuotesModule],
  controllers: [WidgetShippingController, EmbedShippingController, ShippingLabelController],
  providers: [
    EmbedTokenService,
    EmbedAuthGuard,
    SelectShippingMethodUseCase,
    { provide: ORDER_TRACKING_UPDATER, useExisting: UpdateTenantOrderTrackingUseCase },
    { provide: SHIPPING_CARRIER_ADAPTER, useClass: MelhorEnvioCarrierAdapter },
    PurchaseShippingLabelUseCase,
    GetShippingTrackingUseCase,
  ],
  exports: [ShippingQuotesModule]
})
export class ShippingModule {}
