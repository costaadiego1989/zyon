/**
 * Prisma Decimal → number converters.
 * Prisma returns Decimal fields as objects with a toNumber() method.
 * These utilities safely convert to plain numbers for domain/application use.
 */

type DecimalLike = { toNumber(): number } | number | string | null | undefined;

export function toNumber(value: DecimalLike): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return value.toNumber();
}

export function toNumberOrNull(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return value.toNumber();
}
