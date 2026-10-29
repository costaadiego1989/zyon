import type { ShippingQuote } from "@zyon/shared-types";

/** Existing conversational quote mapping, shared without changing labels/math. */
export function toCheckoutShippingQuote(input: {
  label: string; carrierKey: string; priceInCents: number; realCostInCents: number;
  isFree: boolean; etaDays: number; destinationZip: string;
}): ShippingQuote {
  const label = input.label.trim();
  const inferred = inferCarrierAndMethod(label, input.carrierKey);
  return { customerPrice: input.priceInCents / 100, realCost: input.realCostInCents / 100,
    carrier: inferred.carrier, method: inferred.method, deliveryDays: input.etaDays, destinationZip: input.destinationZip };
}

function inferCarrierAndMethod(label: string, carrierKey: string): { carrier: string; method: string } {
  if (/^correios\s+pac$/i.test(label)) return { carrier: "Correios", method: "PAC" };
  if (/^correios\s+sedex$/i.test(label)) return { carrier: "Correios", method: "Sedex" };
  if (/^transportadora/i.test(label)) return { carrier: "Transportadora Parceira", method: "Entrega padrao" };
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { carrier: parts[0]!, method: parts.slice(1).join(" ") };
  return { carrier: humanizeCarrierKey(carrierKey), method: label || "Frete" };
}

function humanizeCarrierKey(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\bestimate\b/gi, "").trim().replace(/\b\w/g, char => char.toUpperCase()) || "Transportadora";
}
