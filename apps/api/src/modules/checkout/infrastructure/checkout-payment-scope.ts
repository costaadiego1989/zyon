import type { Prisma, PrismaClient } from "@prisma/client";

/** Prepared or paid intents freeze delivery until cancellation is confirmed. */
export async function hasPreparedCheckoutPayment(
  prisma: PrismaClient | Prisma.TransactionClient,
  scope: { merchantId: string; sessionId: string },
): Promise<boolean> {
  return !!await prisma.paymentIntent.findFirst({
    where: { merchantId: scope.merchantId, sessionId: scope.sessionId, status: { notIn: ["cancelled", "failed"] } },
    select: { id: true },
  });
}
