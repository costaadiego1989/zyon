import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/** All capacity commands use this row lock. Acquire multiple professionals in
 * stable ID order. Inactive resources remain lockable for reconciliation. */
export async function lockServiceProfessional(tx: Prisma.TransactionClient, merchantId: string, professionalId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM service_professionals WHERE id = ${professionalId} AND merchant_id = ${merchantId} FOR UPDATE`);
  if (rows.length !== 1) throw new NotFoundException("service_professional_not_found");
}
