import neo4j from "neo4j-driver";

/** Decode only the two known pair maps. Unknown fields remain for strict
 * result validation; arbitrary nested driver values never become evidence. */
export function neo4jPublicRow(row: Record<string, unknown>): Record<string, unknown> {
  const scalar = (value: unknown) => neo4j.isInt(value) ? value.inSafeRange() ? value.toNumber() : NaN : value;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    ["service", "professional"].includes(key) && value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, scalar(item)])) : scalar(value)]));
}
