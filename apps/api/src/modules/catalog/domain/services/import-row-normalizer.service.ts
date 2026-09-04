import { CANONICAL_FIELDS, type ColumnMapping, type UnitHints } from "../ports/column-mapper.port.js";
import type { CreateProductInput } from "../ports/product-repository.port.js";

/**
 * Pure domain service. Turns one raw spreadsheet row + a column mapping into a
 * single-product / single-variant CreateProductInput, or a RowError describing
 * why the row was rejected. No NestJS / Prisma dependencies.
 */

export interface RowError {
  row: number;
  sku?: string;
  reason:
    | "missing_name"
    | "missing_sku"
    | "invalid_price"
    | "physical_product_requires_weight";
}

export type NormalizeRowResult =
  | { ok: true; input: CreateProductInput }
  | { ok: false; error: RowError };

export interface NormalizeRowParams {
  row: Record<string, string>;
  mapping: ColumnMapping;
  merchantId: string;
  /** 1-based row index, used only for error reporting. */
  rowIndex: number;
  unitHints?: UnitHints;
  /** Defaults to "physical". */
  productType?: string;
}

const CANONICAL_SET = new Set<string>(CANONICAL_FIELDS as readonly string[]);

/**
 * Inverts the mapping (canonicalField -> detectedHeader). Unknown canonical
 * fields are ignored gracefully. If two headers map to the same canonical
 * field, the last one wins (deterministic on insertion order).
 */
function invertMapping(mapping: ColumnMapping): Partial<Record<(typeof CANONICAL_FIELDS)[number], string>> {
  const inverted: Partial<Record<(typeof CANONICAL_FIELDS)[number], string>> = {};
  for (const [header, canonical] of Object.entries(mapping)) {
    if (!CANONICAL_SET.has(canonical)) continue; // ignore unknown fields
    inverted[canonical] = header;
  }
  return inverted;
}

function readValue(
  row: Record<string, string>,
  inverted: Partial<Record<(typeof CANONICAL_FIELDS)[number], string>>,
  field: (typeof CANONICAL_FIELDS)[number]
): string | undefined {
  const header = inverted[field];
  if (header === undefined) return undefined;
  const raw = row[header];
  return raw === undefined ? undefined : raw;
}

function isBlank(v: string | undefined): boolean {
  return v === undefined || v.trim() === "";
}

/**
 * Parses a currency-ish numeric string that may use pt-BR ("1.234,56") or
 * en ("1,234.56") thousands/decimal separators, or plain forms ("99,90",
 * "99.90", "9990"). Returns the numeric value (in whatever unit the string
 * represents) or null if it cannot be parsed.
 *
 * Strategy: strip everything but digits, ',' and '.'. Whichever of ',' or '.'
 * appears LAST is treated as the decimal separator; the other is a thousands
 * separator and removed. If only one separator type is present and it repeats,
 * it is a thousands separator; a single occurrence is the decimal separator.
 */
function parseCurrencyNumber(input: string | undefined): number | null {
  if (input === undefined) return null;
  let s = input.trim();
  if (s === "") return null;
  // keep sign, digits, comma, dot
  s = s.replace(/[^0-9.,-]/g, "");
  if (s === "" || s === "-") return null;

  const negative = s.startsWith("-");
  s = s.replace(/-/g, "");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const commaCount = (s.match(/,/g) ?? []).length;
  const dotCount = (s.match(/\./g) ?? []).length;

  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = s;
  } else if (lastComma > lastDot) {
    // comma is the decimal separator -> remove dots (thousands), comma -> dot
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // dot is the decimal separator -> remove commas (thousands)
    normalized = s.replace(/,/g, "");
  } else {
    normalized = s;
  }

  // If a single separator type repeats, it was thousands-only (already stripped
  // above for the "other" separator). Guard the case of e.g. "1.234.567".
  if (lastComma === -1 && dotCount > 1) {
    normalized = s.replace(/\./g, "");
  } else if (lastDot === -1 && commaCount > 1) {
    normalized = s.replace(/,/g, "");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function parsePlainNumber(input: string | undefined): number | null {
  const n = parseCurrencyNumber(input);
  return n;
}

export function normalizeRow(params: NormalizeRowParams): NormalizeRowResult {
  const { row, mapping, merchantId, rowIndex } = params;
  const unitHints = params.unitHints ?? {};
  const productType = params.productType ?? "physical";

  const inverted = invertMapping(mapping);

  // --- name (required) ---
  const nameRaw = readValue(row, inverted, "name");
  if (isBlank(nameRaw)) {
    return { ok: false, error: { row: rowIndex, reason: "missing_name" } };
  }
  const name = nameRaw!.trim();

  // --- sku (required) ---
  const skuRaw = readValue(row, inverted, "sku");
  if (isBlank(skuRaw)) {
    return { ok: false, error: { row: rowIndex, reason: "missing_sku" } };
  }
  const sku = skuRaw!.trim();

  // --- price (required, > 0) ---
  const priceRaw = readValue(row, inverted, "price");
  const priceNum = parseCurrencyNumber(priceRaw);
  if (priceNum === null || priceNum <= 0) {
    return { ok: false, error: { row: rowIndex, sku, reason: "invalid_price" } };
  }
  const priceInReais = unitHints.priceInReais !== false; // default true
  const basePriceInCents = priceInReais
    ? Math.round(priceNum * 100)
    : Math.round(priceNum);
  if (basePriceInCents <= 0) {
    return { ok: false, error: { row: rowIndex, sku, reason: "invalid_price" } };
  }

  // --- weight (grams) ---
  const weightRaw = readValue(row, inverted, "weight_grams");
  let weightGrams: number | undefined;
  if (!isBlank(weightRaw)) {
    const w = parsePlainNumber(weightRaw);
    if (w !== null && Number.isFinite(w)) {
      weightGrams = unitHints.weightInKg === true ? Math.round(w * 1000) : w;
    }
  }

  // Physical products require a positive weight.
  const isPhysical = productType === "physical";
  if (isPhysical && (weightGrams === undefined || weightGrams <= 0)) {
    return {
      ok: false,
      error: { row: rowIndex, sku, reason: "physical_product_requires_weight" },
    };
  }

  // --- dimensions (optional) ---
  const lengthCm = optionalNumber(readValue(row, inverted, "length_cm"));
  const widthCm = optionalNumber(readValue(row, inverted, "width_cm"));
  const heightCm = optionalNumber(readValue(row, inverted, "height_cm"));

  // --- stock (default 0) ---
  const stockRaw = readValue(row, inverted, "stock");
  let stockQuantity = 0;
  if (!isBlank(stockRaw)) {
    const s = parsePlainNumber(stockRaw);
    if (s !== null && Number.isFinite(s)) {
      stockQuantity = Math.trunc(s);
    }
  }

  // --- passthrough fields ---
  const descriptionRaw = readValue(row, inverted, "description");
  const description = isBlank(descriptionRaw) ? undefined : descriptionRaw!.trim();

  // category stays a NAME string; the use-case resolves name -> id downstream.
  const categoryRaw = readValue(row, inverted, "category");
  const categoryId = isBlank(categoryRaw) ? undefined : categoryRaw!.trim();

  const input: CreateProductInput = {
    merchantId,
    name,
    ...(description !== undefined ? { description } : {}),
    type: productType,
    ...(categoryId !== undefined ? { categoryId } : {}),
    variants: [
      {
        sku,
        attributes: {},
        basePriceInCents,
        currency: "BRL",
        stockQuantity,
        ...(weightGrams !== undefined ? { weightGrams } : {}),
        ...(lengthCm !== undefined ? { lengthCm } : {}),
        ...(widthCm !== undefined ? { widthCm } : {}),
        ...(heightCm !== undefined ? { heightCm } : {}),
      },
    ],
  };

  return { ok: true, input };
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (isBlank(raw)) return undefined;
  const n = parsePlainNumber(raw);
  return n !== null && Number.isFinite(n) ? n : undefined;
}
