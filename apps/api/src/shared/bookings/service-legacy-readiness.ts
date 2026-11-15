import type { Prisma } from "@prisma/client";

/** Historical time is not evidence of fulfillment. Call under the merchant
 * lock for admission; profile readers use this only as a configuration hint. */
export async function hasUnclassifiedServiceReservations(
  tx: Pick<Prisma.TransactionClient, "serviceReservation">,
  merchantId: string,
): Promise<boolean> {
  return !!await tx.serviceReservation.findFirst({ where: {
    merchantId, status: "reserved",
    OR: [{ appointmentId: null }, { classificationPending: true }],
    order: { status: { notIn: ["cancelled", "refunded", "returned", "failed"] } },
  }, select: { id: true } });
}
