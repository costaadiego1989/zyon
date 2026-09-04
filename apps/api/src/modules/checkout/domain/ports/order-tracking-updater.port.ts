import type { UpdateOrderTrackingRequest, UpdateOrderTrackingResponse } from "@zyon/shared-types";

export const CHECKOUT_ORDER_TRACKING_UPDATER = Symbol("CHECKOUT_ORDER_TRACKING_UPDATER");

export type CheckoutOrderTrackingUpdater = {
  execute(input: UpdateOrderTrackingRequest): Promise<UpdateOrderTrackingResponse>;
};
