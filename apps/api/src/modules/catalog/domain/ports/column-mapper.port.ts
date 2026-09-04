export const CANONICAL_FIELDS = [
  "name",
  "sku",
  "price",
  "stock",
  "weight_grams",
  "length_cm",
  "width_cm",
  "height_cm",
  "description",
  "category",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export type ColumnMapping = Record<string, CanonicalField>;

export interface UnitHints {
  priceInReais?: boolean;
  weightInKg?: boolean;
}

export const COLUMN_MAPPER = Symbol("ColumnMapperPort");

export interface ColumnMapperPort {
  /**
   * Map detected spreadsheet headers to canonical product fields. Returns ONLY a
   * header→field mapping (+ optional unit hints), never row values. Callers must
   * validate the result (validate-column-mapping) before trusting it.
   */
  mapColumns(
    headers: string[],
    sampleRows: Array<Record<string, string>>,
  ): Promise<{ mapping: ColumnMapping; unitHints?: UnitHints }>;
}
