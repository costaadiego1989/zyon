import type { Prisma } from "@prisma/client";

type Reader = Pick<Prisma.TransactionClient, "completedOrder"> & {
  marketplaceFundingPlan?: { findFirst: (args: any) => Promise<any>; findMany?: (args: any) => Promise<any[]> };
  crossStoreLineItem?: Pick<Prisma.TransactionClient["crossStoreLineItem"], "findFirst" | "findMany">;
};

/** Supports the legacy marketplace schema as well as immutable funding plans. */
export async function marketplaceFulfillmentSessions(reader: Reader, merchantId: string, sessionIds: string[]): Promise<Set<string>> {
  const sessions = new Set<string>();
  if (!sessionIds.length) return sessions;
  if (reader.marketplaceFundingPlan?.findMany) {
    const plans = await reader.marketplaceFundingPlan.findMany({ where: { hostMerchantId: merchantId, payment: { merchantId, sessionId: { in: sessionIds } } }, select: { payment: { select: { sessionId: true } } } });
    for (const plan of plans) sessions.add(plan.payment.sessionId);
  }
  if (reader.crossStoreLineItem) {
    const lines = await reader.crossStoreLineItem.findMany({ where: { hostMerchantId: merchantId, checkoutSessionId: { in: sessionIds } }, select: { checkoutSessionId: true } });
    for (const line of lines) sessions.add(line.checkoutSessionId);
  }
  return sessions;
}

/** The caller must first load the order/shipment/line within its tenant boundary.
 * Funding is immutable and precedes order materialization. Any admitted funding,
 * including an uncertain capture or a digital purchase, requires its own proof.
 */
export async function hasMarketplaceFulfillmentFunding(reader: Reader, input: {
  merchantId: string;
  orderId: string;
  sessionId?: string;
  checkoutCartRef?: string;
}): Promise<boolean> {
  const refs = new Set([input.orderId]);
  const sessions = new Set(input.sessionId ? [input.sessionId] : []);
  if (reader.crossStoreLineItem && await reader.crossStoreLineItem.findFirst({ where: { hostMerchantId: input.merchantId,
    OR: [{ orderId: input.orderId }, ...(input.sessionId ? [{ checkoutSessionId: input.sessionId }] : []), ...(input.checkoutCartRef ? [{ checkoutSessionId: input.checkoutCartRef }] : [])] }, select: { id: true } })) return true;
  if (!reader.marketplaceFundingPlan) return false;
  const matches = () => reader.marketplaceFundingPlan!.findFirst({
    where: {
      hostMerchantId: input.merchantId,
      payment: { merchantId: input.merchantId },
      OR: [
        { providerPaymentId: { in: [...refs] } },
        { payment: { merchantId: input.merchantId, OR: [
          { providerPaymentId: { in: [...refs] } },
          { commerceOrderId: { in: [...refs] } },
          ...(sessions.size ? [{ sessionId: { in: [...sessions] } }] : []),
        ] } },
        ...(input.checkoutCartRef ? [{ checkoutSessionId: input.checkoutCartRef }] : []),
      ],
    },
    select: { paymentIntentId: true },
  });
  if (await matches()) return true;

  // Some legacy shipments store CompletedOrder.id instead of the provider or
  // commerce reference. Resolve only inside the persisted host's boundary.
  const completed = await reader.completedOrder.findMany({ where: {
    merchantId: input.merchantId,
    OR: [{ id: input.orderId }, { externalOrderId: input.orderId }],
  }, select: { externalOrderId: true, sessionId: true } });
  for (const row of completed) {
    refs.add(row.externalOrderId);
    sessions.add(row.sessionId);
  }
  return completed.length > 0 && !!await matches();
}
