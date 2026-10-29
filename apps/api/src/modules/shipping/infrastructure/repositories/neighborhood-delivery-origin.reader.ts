import type { Prisma } from "@prisma/client";
import { resolveNeighborhoodDeliveryOrigin } from "../../domain/services/neighborhood-delivery-origin.js";

/** Reuse the caller's actual client/transaction. No client, transaction, write
 * or network provider is created here. Internal callers hold merchant fences. */
export async function readNeighborhoodDeliveryOrigin(prisma: Pick<Prisma.TransactionClient, "merchant" | "merchantRule">, merchantId: string) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { id: true, storeSettings: true } });
  const rule = await prisma.merchantRule.findUnique({ where: { merchantId }, select: { merchantId: true, originZip: true } });
  return resolveNeighborhoodDeliveryOrigin(merchantId, merchant, rule);
}
