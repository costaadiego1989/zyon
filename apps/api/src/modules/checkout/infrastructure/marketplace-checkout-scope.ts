import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

type Reader = Pick<Prisma.TransactionClient, "checkoutSession" | "crossStoreLineItem">;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const present = (value: unknown) => value !== null && value !== undefined;

export function isMarketplaceCheckoutSession(session: unknown): boolean {
  const row = object(session), cart = object(row?.cart), shipping = object(row?.shipping);
  return (Array.isArray(row?.crossStoreItems) && row.crossStoreItems.length > 0) ||
    (Array.isArray(cart?.items) && cart.items.some(line => present(object(line)?.marketplace))) ||
    present(shipping?.marketplace);
}

/** A caller's old snapshot can omit both the markers and the original cart ref.
 * Always consult the persisted, tenant-bound session before consulting lines.
 * This is a scope fence, not an authorization to quote or charge marketplace.
 */
export async function hasMarketplaceCheckout(reader: Reader, input: {
  merchantId: string;
  sessionId: string;
  session?: unknown;
}): Promise<boolean> {
  if (!input.merchantId?.trim() || !input.sessionId?.trim()) throw new ConflictException("marketplace_shipping_selection_required");
  const stored = await reader.checkoutSession.findUnique({
    where: { merchantId_sessionId: { merchantId: input.merchantId, sessionId: input.sessionId } },
    select: { merchantId: true, sessionId: true, cart: true, shipping: true },
  });
  if (stored && (stored.merchantId !== input.merchantId || stored.sessionId !== input.sessionId)) {
    throw new ConflictException("marketplace_shipping_selection_required");
  }
  if (isMarketplaceCheckoutSession(stored) || isMarketplaceCheckoutSession(input.session)) return true;
  const refs = new Set([input.sessionId]);
  for (const candidate of [stored, input.session]) {
    const ref = object(object(candidate)?.cart)?.cart_ref;
    if (typeof ref === "string" && ref.trim()) refs.add(ref);
  }
  return !!await reader.crossStoreLineItem.findFirst({
    where: { hostMerchantId: input.merchantId, checkoutSessionId: { in: [...refs] } },
    select: { id: true },
  });
}
