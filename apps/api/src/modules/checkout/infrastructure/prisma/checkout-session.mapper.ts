import type { ShippingQuote } from "@zyon/shared-types";
import type { Prisma } from "@prisma/client";
export { toCheckoutSession } from "../../domain/services/checkout-session-projection.js";

/** ShippingQuote contains scalar JSON fields only. Preserve absent optional
 * fields (including unknown cost), and refuse values JSON would lose/coerce. */
export function toCheckoutShippingJson(quote: ShippingQuote): Prisma.InputJsonObject {
  const value = { ...quote };
  if (!Number.isFinite(value.customerPrice) || Object.values(value).some(field => field !== undefined
    && typeof field !== "string" && (typeof field !== "number" || !Number.isFinite(field)))) {
    throw new Error("invalid_shipping_quote_json");
  }
  return value;
}
