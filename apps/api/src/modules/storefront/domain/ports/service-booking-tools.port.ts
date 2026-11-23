import type { ServiceBookingService } from "../../../checkout/application/service-booking.service.js";
import type { ServiceBookingResult } from "../contracts/service-booking-tool.schemas.js";

/** Same canonical T40 methods with scope captured by the authenticated bridge.
 * No model-visible method receives a merchant, buyer, checkout or credential. */
export type ScopedServiceBookingReader = {
  [Method in "professionals" | "dates" | "slots" | "select"]:
    (input: Parameters<ServiceBookingService[Method]>[1]) => ReturnType<ServiceBookingService[Method]>;
} & { offerName(input: { productId: string; variantId: string }): Promise<string> };
export interface ServiceBookingHandlers {
  getServiceProfessionals(input: unknown): Promise<ServiceBookingResult>;
  getServiceDates(input: unknown): Promise<ServiceBookingResult>;
  getServiceSlots(input: unknown): Promise<ServiceBookingResult>;
  resolveServiceSelection(input: unknown): Promise<ServiceBookingResult>;
}
export interface StorefrontServiceBookingBinding {
  merchantId: string;
  conversationId: string;
  cartRef: string;
}
/** Per-call server closure, outside request JSON and all model input schemas. */
export type StorefrontServiceBookingFactory = (binding: StorefrontServiceBookingBinding) => Promise<ServiceBookingHandlers | undefined>;
