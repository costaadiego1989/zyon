import { z } from "zod";
import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";
import type { StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import type { StorefrontCartState } from "../../domain/services/storefront-quick-replies.service.js";

const cart = storefrontToolOutputSchemas.get_cart.shape;
const scopeSchema = z.strictObject({ merchantId: cart.cartId, cartId: cart.cartId });
const snapshotSchema = z.object({ merchantId: cart.cartId, sessionId: cart.cartId, total: cart.total, couponCode: cart.couponCode,
  items: z.array(cart.items.element.pick({ variantId: true, name: true, quantity: true })).max(200) });

/** Best-effort quick-reply snapshot; total remains in the repository's cents. */
export async function readStorefrontCartState(repo: Pick<StorefrontCartPort, "getOrCreate">,
  scope: { merchantId: string; cartId: string }): Promise<StorefrontCartState | undefined> {
  const parsedScope = scopeSchema.safeParse(scope);
  if (!parsedScope.success) return undefined;
  try {
    const snapshot = snapshotSchema.safeParse(await repo.getOrCreate(parsedScope.data.merchantId, parsedScope.data.cartId));
    if (!snapshot.success || snapshot.data.merchantId !== parsedScope.data.merchantId || snapshot.data.sessionId !== parsedScope.data.cartId) return undefined;
    const data = snapshot.data;
    return { items: data.items, total: data.total, itemCount: data.items.reduce((sum, item) => sum + item.quantity, 0), couponCode: data.couponCode ?? null };
  } catch { return undefined; }
}

