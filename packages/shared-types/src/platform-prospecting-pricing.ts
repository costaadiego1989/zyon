import type { ProspectingMaxPrice } from "./platform-prospecting.js";

export function validateProspectingMaxPrice(value: unknown): ProspectingMaxPrice | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw Error("invalid_command:maxPrice");
  const price = value as Record<string, unknown>;
  if (Object.keys(price).some(key => !["currency", "amountPerThousandMinor"].includes(key)) ||
      price.currency !== "BRL" || !Number.isSafeInteger(price.amountPerThousandMinor) ||
      (price.amountPerThousandMinor as number) < 1 || (price.amountPerThousandMinor as number) > 2_147_483_647) {
    throw Error("invalid_command:maxPrice");
  }
  return { currency: "BRL", amountPerThousandMinor: price.amountPerThousandMinor as number };
}

/** Exact conversion: BRL per delivery -> centavos per 1000 deliveries. */
export function parseProspectingMaxPrice(input: string): ProspectingMaxPrice {
  const match = /^(\d{1,5})(?:[,.](\d{1,5}))?$/.exec(input.trim());
  if (!match) throw Error("invalid_command:maxPrice");
  const minor = BigInt(match[1] + (match[2] ?? "").padEnd(5, "0"));
  return validateProspectingMaxPrice({ currency: "BRL", amountPerThousandMinor: Number(minor) })!;
}

export function prospectingMaxPriceInput(price: ProspectingMaxPrice): string {
  const amount = validateProspectingMaxPrice(price)!.amountPerThousandMinor;
  const fraction = String(amount % 100_000).padStart(5, "0").replace(/0+$/, "");
  return String(Math.floor(amount / 100_000)) + (fraction ? "," + fraction : "");
}

export function prospectingMaxPriceReservation(price: ProspectingMaxPrice): number {
  return Math.ceil(validateProspectingMaxPrice(price)!.amountPerThousandMinor / 1000);
}
