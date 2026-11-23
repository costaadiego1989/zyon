import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/** Call only inside the canonical service transaction AFTER acquiring its
 * merchant/session anchor locks, which payment admission also acquires.
 * Same non-retryable statuses as PrismaPaymentRepository.hasCommittedPaymentForSession.
 * Prior confirmation receipts must be read before this guard (replay is read-only).
 */
export async function assertNoActiveServiceCheckoutPayment(tx: Prisma.TransactionClient, merchantId: string, sessionId: string) {
  const active = await tx.paymentIntent.findFirst({ where: { merchantId, sessionId,
    status: { notIn: ["failed", "cancelled"] } }, select: { id: true } });
  if (active) throw new ConflictException("service_checkout_payment_in_progress");
}
