/**
 * H4 fix: Extract purchase serializer from controller to dedicated transformer.
 * Reduces controller responsibilities and makes the shape reusable.
 */
export interface PurchaseItemDTO {
  sku?: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  image_url?: string | null;
  variant?: string | null;
}

export function purchaseItems(value: unknown): PurchaseItemDTO[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const source = item as Record<string, unknown>;
      const name = stringValue(source.name ?? source.title);
      const quantity = numberValue(source.quantity, 1);
      const unitPrice = numberValue(source.unit_price ?? source.unitPrice ?? source.price, 0);
      const lineTotal = numberValue(source.line_total ?? source.lineTotal, unitPrice * quantity);
      if (!name) return null;
      return {
        sku: stringValue(source.sku) || undefined,
        name,
        quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
        image_url: stringValue(source.image_url ?? source.imageUrl) || null,
        variant: stringValue(source.variant) || null
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
