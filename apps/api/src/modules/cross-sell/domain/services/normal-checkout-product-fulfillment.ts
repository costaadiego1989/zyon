import { z } from "zod";
import { PRODUCT_TYPES, validateProductType, isDigitalContentReady } from "../../../catalog/domain/services/product-type-validation.js";
import { resolveSelectedServiceSlot, ServiceSlotError } from "../../../catalog/domain/services/service-schedule.js";
import { fulfillmentStrategy } from "../../../operations/domain/order-fulfillment.js";

export const normalCheckoutCatalogProductTypeSchema = z.enum(PRODUCT_TYPES);
export class NormalCheckoutProductFulfillmentError extends Error {
  constructor(readonly code: string) { super(code); }
}
const productSchema = z.strictObject({ type: normalCheckoutCatalogProductTypeSchema, metadata: z.unknown().optional() });

/** The caller supplies an actual merchant-scoped catalog row under its fences.
 * This mapper does not make cart/request type or fulfillment hints authoritative.
 * Appointment targets require the canonical slot lifecycle, never inference. */
export function readNormalCheckoutProductFulfillment(raw: { type: unknown; metadata?: unknown }, now: Date) {
  const product = productSchema.parse(raw), metadata = product.metadata ?? undefined;
  const error = validateProductType(product.type, metadata as Record<string, unknown> | undefined);
  if (error) throw new NormalCheckoutProductFulfillmentError(error);
  if (product.type === "digital" && !isDigitalContentReady(metadata)) throw new NormalCheckoutProductFulfillmentError("digital_content_unavailable");
  if (product.type === "service") {
    try { resolveSelectedServiceSlot(metadata, undefined, now); }
    catch (error) { if (error instanceof ServiceSlotError) throw new NormalCheckoutProductFulfillmentError(error.code); throw error; }
  }
  return { productType: product.type, fulfillmentStrategy: fulfillmentStrategy(product.type, metadata),
    requiresStock: product.type === "physical" || product.type === "food" };
}
