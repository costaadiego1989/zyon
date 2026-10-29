import { Module } from "@nestjs/common";
import { CheckoutPersistenceModule } from "./checkout-persistence.module.js";
import { UpdateOrderTrackingUseCase } from "./application/use-cases/update-order-tracking.use-case.js";
import { CHECKOUT_ORDER_TRACKING_UPDATER } from "./domain/ports/order-tracking-updater.port.js";

@Module({
  imports: [CheckoutPersistenceModule],
  providers: [
    UpdateOrderTrackingUseCase,
    { provide: CHECKOUT_ORDER_TRACKING_UPDATER, useExisting: UpdateOrderTrackingUseCase }
  ],
  exports: [CHECKOUT_ORDER_TRACKING_UPDATER]
})
export class CheckoutOrderTrackingModule {}
