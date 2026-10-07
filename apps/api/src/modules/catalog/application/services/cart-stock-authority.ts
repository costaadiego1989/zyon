import { ConflictException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";

export type StockCartLine = { sku: string; variantId?: string | null; quantity: number };

/** Validate the aggregate native-catalog quantity, including separate option lines. */
export async function assertCartStock(prisma: Pick<PrismaClient, "productVariant">, merchantId: string, items: StockCartLine[]): Promise<void> {
  if (!items.length) return;
  const rows = await prisma.productVariant.findMany({ where: { product: { merchantId }, OR: [
    { id: { in: items.flatMap(i => i.variantId ? [i.variantId] : []) } },
    { sku: { in: items.map(i => i.sku) } },
  ] }, include: { product: true, stock: true } });
  const requested = new Map<string, number>();
  for (const item of items) {
    const matches = rows.filter(v => item.variantId ? v.id === item.variantId : v.sku === item.sku);
    // External commerce-adapter lines remain under their existing authority.
    if (!matches.length && !item.variantId) continue;
    if (matches.length !== 1 || !matches[0]!.isActive || !matches[0]!.product.isActive || matches[0]!.product.deletedAt) throw new ConflictException("cart_product_unavailable");
    const variant = matches[0]!;
    requested.set(variant.id, (requested.get(variant.id) ?? 0) + item.quantity);
  }
  for (const [id, quantity] of requested) {
    const variant = rows.find(v => v.id === id)!;
    if (["digital", "service"].includes(variant.product.type)) continue;
    const available = variant.stock.reduce((sum, s) => sum + Math.max(0, s.quantity - s.reserved), 0);
    if (quantity > available) throw new ConflictException({ message: "cart_insufficient_stock", sku: variant.sku, variantId: id, availableQuantity: available });
  }
}
