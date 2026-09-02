import { Injectable } from "@nestjs/common";
import {
  COLUMN_MAPPER,
  type ColumnMapperPort,
  type ColumnMapping,
  type CanonicalField,
} from "../../domain/ports/column-mapper.port.js";

/**
 * Alias table — maps normalized header strings (lowercase, accent/space/paren
 * stripped) to canonical product fields. Multiple aliases per field. Both
 * pt-BR and en variants. Order matters only for readability.
 */
const ALIASES: Record<CanonicalField, readonly string[]> = {
  name: [
    "nome",
    "produto",
    "titulo",
    "title",
    "name",
    "descricao do produto",
    "nome do produto",
  ],
  sku: ["sku", "codigo", "ref", "referencia", "cod", "codigo do produto"],
  price: [
    "preco",
    "valor",
    "price",
    "valor unitario",
    "preco rs",
    "preco em reais",
    "preco unitario",
    "precor",
  ],
  stock: [
    "estoque",
    "quantidade",
    "qtd",
    "stock",
    "qty",
    "inventario",
    "quantidade em estoque",
  ],
  weight_grams: [
    "peso",
    "peso g",
    "weight",
    "peso gramas",
    "gramas",
    "weight g",
    "peso em gramas",
    // kg variants (value is converted to grams via the weightInKg unit hint)
    "peso kg",
    "peso em kg",
    "weight kg",
    "peso quilos",
    "quilos",
    "kg",
  ],
  length_cm: [
    "comprimento",
    "length",
    "comp",
    "comprimento cm",
    "length cm",
    "comprimento em cm",
  ],
  width_cm: ["largura", "width", "larg", "largura cm", "width cm"],
  height_cm: ["altura", "height", "alt", "altura cm", "height cm"],
  description: ["descricao", "description", "detalhes", "descricao do item"],
  category: ["categoria", "category", "categorias", "tipo"],
};

/**
 * Strip accents, collapse to lowercase, drop whitespace + parens + common
 * punctuation. Used for both header-side and alias-side normalization so
 * "Preço (R$)" matches "preco" and "Nome do Produto" matches "nome do produto".
 */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s()_/\\.,;:'\-]+/g, "").replace(/\$/g, "");
}

/**
 * Deterministic column-mapper adapter. Pure alias matching — no LLM.
 *
 * Imported as `{ provide: COLUMN_MAPPER, useClass: CompositeColumnMapper }`
 * normally; this is the fallback that the composite calls on LLM failure.
 */
@Injectable()
export class DeterministicColumnMapper implements ColumnMapperPort {
  // Pre-computed: alias-key (normalized) → canonical field
  private readonly aliasIndex: Map<string, CanonicalField>;

  constructor() {
    this.aliasIndex = new Map();
    for (const [field, aliases] of Object.entries(ALIASES) as [
      CanonicalField,
      readonly string[],
    ][]) {
      for (const alias of aliases) {
        const key = normalize(alias);
        if (!this.aliasIndex.has(key)) {
          this.aliasIndex.set(key, field);
        }
      }
    }
  }

  async mapColumns(
    headers: string[],
    _sampleRows: Array<Record<string, string>>,
  ): Promise<{ mapping: ColumnMapping; unitHints?: { priceInReais?: boolean; weightInKg?: boolean } }> {
    const mapping: ColumnMapping = {};
    let weightInKg = false;
    for (const header of headers) {
      const field = this.aliasIndex.get(normalize(header));
      if (!field) continue;
      // First-occurrence wins for duplicate canonical targets
      if (Object.values(mapping).includes(field)) continue;
      mapping[header] = field;
      // Infer the weight unit from the header text: "Peso (kg)" → values are in
      // kilograms and must be ×1000 to grams by the normalizer.
      if (field === "weight_grams" && /\bkg\b|quilo/i.test(header.normalize("NFD").replace(/[̀-ͯ]/g, ""))) {
        weightInKg = true;
      }
    }
    // Default unit hint: spreadsheet prices are assumed to be in BRL.
    return { mapping, unitHints: { priceInReais: true, weightInKg } };
  }
}

// Re-export symbol for module wiring convenience.
export { COLUMN_MAPPER };