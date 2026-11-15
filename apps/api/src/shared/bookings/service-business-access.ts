import { ForbiddenException, ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { resolveServiceBusinessPolicy } from "../../modules/merchant/domain/service-business-policy.js";

export interface ServiceActor { merchantId: string; userId: string; role: string }

export async function assertServiceAdministration(
  tx: Pick<Prisma.TransactionClient, "merchant" | "product" | "serviceReservation">,
  actor: ServiceActor,
  write = true,
): Promise<void> {
  if (!actor.merchantId || !actor.userId || !(write ? ["owner", "admin"] : ["owner", "admin", "staff"]).includes(actor.role)) throw new ForbiddenException("service_operator_required");
  const merchant = await tx.merchant.findUnique({ where: { id: actor.merchantId }, select: {
    businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true,
  } });
  if (!merchant) throw new NotFoundException("merchant_not_found");
  const hasLegacyServiceData = !merchant.businessModeSelectedAt && (await tx.product.count({ where: { merchantId: actor.merchantId, type: "service" } }) > 0
    || await tx.serviceReservation.count({ where: { merchantId: actor.merchantId } }) > 0);
  const business = resolveServiceBusinessPolicy({ ...merchant, hasLegacyServiceData, policy: null });
  if (business.selectionState === "review_required") throw new ConflictException("business_mode_classification_required");
  if (!business.capabilities.serviceAdministration) throw new ForbiddenException("services_mode_required");
}
