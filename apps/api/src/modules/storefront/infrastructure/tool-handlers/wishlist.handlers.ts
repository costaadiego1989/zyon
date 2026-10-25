import type { PrismaClient } from "@prisma/client";
import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { StoreToolHandlers } from "../../domain/tools/types.js";
import { productGallery } from "../product-gallery.js";

type WishlistRow = { productId: string; createdAt: Date };
type WishlistDelegate = {
  upsert(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<WishlistRow[]>;
  deleteMany(args: unknown): Promise<unknown>;
};

export interface WishlistHandlerDeps {
  prisma: PrismaClient;
  productRepo: ProductRepositoryPort;
}

/** Server-derived owner keys keep wishlists tenant-scoped for buyers and guests. */
export function createWishlistHandlers(
  deps: WishlistHandlerDeps,
  ctx: ToolRequestContext,
): Pick<StoreToolHandlers, "addToWishlist" | "getWishlist" | "removeFromWishlist"> {
  const wishlist = (deps.prisma as unknown as { storefrontWishlistItem: WishlistDelegate }).storefrontWishlistItem;
  const ownerKeys = wishlistOwnerKeys(ctx);

  const list = async () => {
    const rows = await wishlist.findMany({
      where: { merchantId: ctx.merchantId, ownerKey: { in: ownerKeys } },
      orderBy: { createdAt: "desc" },
    });
    const seen = new Set<string>();
    const items = [];
    for (const row of rows) {
      if (seen.has(row.productId)) continue;
      seen.add(row.productId);
      const product = await deps.productRepo.findById(ctx.merchantId, row.productId);
      if (!product?.isActive) continue;
      const price = product.defaultVariant?.basePriceInCents ?? 0;
      items.push({
        id: product.id,
        name: product.name,
        description: product.description,
        price,
        priceFormatted: formatPrice(price),
        ...productGallery(product),
        inStock: product.hasStock,
        rating: product.averageRating,
        reviewCount: product.reviewCount ?? 0,
      });
    }
    return items;
  };

  return {
    addToWishlist: async (args) => {
      if (typeof args.productId !== "string" || !args.productId.trim()) {
        return { error: "product_id_required", items: await list() };
      }
      const product = await deps.productRepo.findById(ctx.merchantId, args.productId);
      if (!product?.isActive) return { error: "product_not_found", items: await list() };
      await wishlist.upsert({
        where: {
          merchantId_ownerKey_productId: {
            merchantId: ctx.merchantId,
            ownerKey: ownerKeys[0],
            productId: product.id,
          },
        },
        create: { merchantId: ctx.merchantId, ownerKey: ownerKeys[0], productId: product.id },
        update: {},
      });
      return { added: true, productId: product.id, items: await list(), message: "Produto adicionado à lista de desejos." };
    },

    getWishlist: async () => {
      const items = await list();
      return {
        items,
        message: items.length
          ? "Estes produtos estão salvos na sua lista de desejos."
          : "Sua lista de desejos está vazia. Explore nossos produtos!",
      };
    },

    removeFromWishlist: async (args) => {
      if (typeof args.productId !== "string" || !args.productId.trim()) {
        return { error: "product_id_required", items: await list() };
      }
      await wishlist.deleteMany({
        where: { merchantId: ctx.merchantId, ownerKey: { in: ownerKeys }, productId: args.productId },
      });
      return { removed: true, productId: args.productId, items: await list(), message: "Produto removido da lista de desejos." };
    },
  };
}

function wishlistOwnerKeys(ctx: ToolRequestContext): string[] {
  const sessionOwner = `session:${ctx.conversationId ?? ctx.sessionId}`;
  if (!ctx.buyer?.globalUserId) return [sessionOwner];
  return [`buyer:${ctx.buyer.globalUserId}`, sessionOwner];
}

function formatPrice(valueInCents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valueInCents / 100);
}
