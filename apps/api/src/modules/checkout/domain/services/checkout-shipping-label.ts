import type { ShippingQuote } from "@zyon/shared-types";

/** Bind carrier, service, price and delivery time to the complete server label. */
export function checkoutShippingLabel(option: ShippingQuote): string {
  const carrier = option.carrier?.trim();
  const method = option.method?.trim();
  const label = carrier && method && !method.toLowerCase().includes(carrier.toLowerCase())
    ? `${carrier} ${method}` : method ?? carrier ?? "Frete";
  const price = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(option.customerPrice);
  const eta = option.estimatedUnit === "minutes" ? ` (${option.estimatedValue} minutos)` : typeof option.deliveryDays === "number" ? ` (${option.deliveryDays} dias)` : "";
  return `${label}${eta} - ${price}`;
}
