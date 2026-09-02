import { CANONICAL_FIELDS, type ColumnMapping } from "../ports/column-mapper.port.js";

export function validateColumnMapping(
  raw: unknown,
  detectedHeaders: string[]
): { ok: true; mapping: ColumnMapping } | { ok: false; reason: string } {
  // Check if raw is a plain non-null object
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "not_an_object" };
  }

  const canonicalSet = new Set(CANONICAL_FIELDS);
  const detectedHeadersLower = new Map(detectedHeaders.map((h) => [h.toLowerCase(), h]));
  const mapping: ColumnMapping = {};
  const seenCanonicalTargets = new Set<(typeof CANONICAL_FIELDS)[number]>();

  for (const [key, value] of Object.entries(raw)) {
    // Normalize key to detected header (case-insensitive match)
    const normalizedKey = detectedHeadersLower.get(key.toLowerCase());
    if (!normalizedKey) {
      // Unknown header key, drop it
      continue;
    }

    // Check if value is a canonical field (must be a string)
    if (typeof value !== "string" || !canonicalSet.has(value as (typeof CANONICAL_FIELDS)[number])) {
      // Invalid canonical value, drop it
      continue;
    }

    // Check for duplicate canonical target
    if (seenCanonicalTargets.has(value as (typeof CANONICAL_FIELDS)[number])) {
      // Keep first, drop rest
      continue;
    }

    // Valid entry
    mapping[normalizedKey] = value as (typeof CANONICAL_FIELDS)[number];
    seenCanonicalTargets.add(value as (typeof CANONICAL_FIELDS)[number]);
  }

  // Check if we have at least one of the essential fields
  const hasEssentialField = ["name", "sku", "price"].some(
    (field) =>
      Object.values(mapping).includes(field as (typeof CANONICAL_FIELDS)[number])
  );

  if (!hasEssentialField) {
    return { ok: false, reason: "no_usable_columns" };
  }

  return { ok: true, mapping };
}
