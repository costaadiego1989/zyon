import type { ServiceBookingService } from "../../../checkout/application/service-booking.service.js";
import type { ServiceBookingResult } from "../contracts/service-booking-tool.schemas.js";

/** Public reads plus optional buyer-authorized selection, captured by the verified bridge.
 * No model-visible method receives a merchant, buyer, checkout or credential. */
export type ScopedServiceBookingReader = {
  [Method in "professionals" | "dates" | "slots"]:
    (input: Parameters<ServiceBookingService[Method]>[1]) => ReturnType<ServiceBookingService[Method]>;
} & { select?: (input: Parameters<ServiceBookingService["select"]>[1]) => ReturnType<ServiceBookingService["select"]>;
  offerName(input: { productId: string; variantId: string }): Promise<string> };
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
