/**
 * Pure mapping from catalog ProductEntity to Google Merchant Feed canonical row.
 *
 * Required canonical fields:
 *   id, title, description, link, image_link, availability, price, brand, currency
 *
 * Mapping rules:
 *   - id            ← product.id (sku/variant id is also exported via "id" — GMF requires a single id)
 *   - title         ← product.name
 *   - description   ← product.description (empty string when undefined; GMF requires non-empty)
 *   - link          ← storefront PDP URL (only present when product has a slug/known host)
 *   - image_link    ← first IMAGE variant media URL (empty string when none)
 *   - availability  ← "in_stock" | "out_of_stock" | "preorder" based on ProductEntity.hasStock
 *   - price         ← variant.basePriceInCents converted to decimal with currency (e.g. "199.90 BRL")
 *   - brand         ← merchant name (provided by caller; falls back to "AACP" when unknown)
 *   - currency      ← variant.currency (defaults to "BRL")
 */
export interface MerchantFeedRow {
  id: string;
  title: string;
  description: string;
  link: string;
  image_link: string;
  availability: "in_stock" | "out_of_stock" | "preorder";
  price: string;
  brand: string;
  currency: string;
}

export interface ProductFeedMapperInput {
  product: {
    id: string;
    name: string;
    description?: string;
    slug?: string;
    variants: Array<{
      basePriceInCents: number;
      currency?: string;
      media: Array<{ url: string; type: "IMAGE" | "VIDEO"; order?: number }>;
      stockQuantity?: number;
      stockReserved?: number;
    }>;
  };
  merchantId: string;
  brandName?: string;
  publicBaseUrl?: string;
}

/**
 * Convert minor units (cents) to a decimal string with two digits.
 * `"19990"` → `"199.90"`. Negative is rejected by throwing — pricing should never be negative.
 */
export function minorUnitsToDecimalPrice(minor: number): string {
  if (!Number.isFinite(minor)) {
    throw new Error(`Invalid price minor units: ${minor}`);
  }
  const negative = minor < 0;
  if (negative) {
    throw new Error(`Negative price not allowed: ${minor}`);
  }
  const whole = Math.floor(minor / 100);
  const fraction = minor % 100;
  const fractionStr = fraction.toString().padStart(2, "0");
  return `${whole}.${fractionStr}`;
}

/**
 * Pick the cheapest in-stock variant (used for feed). Falls back to the first variant.
 */
function pickPrimaryVariant(input: ProductFeedMapperInput["product"]) {
  if (!input.variants.length) return null;
  const inStock = input.variants.find(
    (v) => (v.stockQuantity ?? 0) - (v.stockReserved ?? 0) > 0,
  );
  return inStock ?? input.variants[0];
}

export class ProductFeedMapper {
  /**
   * Map a single ProductEntity to a Google Merchant Feed row.
   * Returns null when the product has no variants (no price → GMF rejects the row).
   */
  static toFeedRow(input: ProductFeedMapperInput): MerchantFeedRow | null {
    const { product, merchantId, brandName, publicBaseUrl } = input;
    const variant = pickPrimaryVariant(product);
    if (!variant) return null;

    const firstImage = [...(variant.media ?? [])]
      .filter((m) => m.type === "IMAGE")
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];

    const inStock =
      (variant.stockQuantity ?? 0) - (variant.stockReserved ?? 0) > 0;

    const link = product.slug && publicBaseUrl
      ? `${publicBaseUrl.replace(/\/$/, "")}/${product.slug}`
      : "";

    return {
      id: product.id,
      title: product.name,
      description: (product.description ?? "").toString(),
      link,
      image_link: firstImage?.url ?? "",
      availability: inStock ? "in_stock" : "out_of_stock",
      price: `${minorUnitsToDecimalPrice(variant.basePriceInCents)} ${variant.currency ?? "BRL"}`,
      brand: brandName && brandName.length > 0 ? brandName : merchantId,
      currency: variant.currency ?? "BRL",
    };
  }

  /**
   * Build the GMF canonical header order. Stays consistent across CSV and JSON exporters.
   */
  static readonly FIELDS = [
    "id",
    "title",
    "description",
    "link",
    "image_link",
    "availability",
    "price",
    "brand",
    "currency",
  ] as const;
}
