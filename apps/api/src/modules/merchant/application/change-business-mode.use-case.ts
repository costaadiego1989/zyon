import { invalidateServiceBusinessPublicationWithin } from "../../graph-rag/infrastructure/public-business-write.js";
import { enqueueCompanySettingsWork } from "./company-settings-write.js";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { assertCompatibleBusinessModeChange, parseBusinessMode, ServiceBusinessPolicyError } from "../domain/service-business-policy.js";

export function parseBusinessModeChange(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("business_mode_required");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["businessMode", "expectedBusinessMode"].includes(key))) throw new BadRequestException("invalid_business_mode_field");
  try { return { businessMode: parseBusinessMode(body.businessMode), expectedBusinessMode: parseBusinessMode(body.expectedBusinessMode) }; }
  catch (error) { if (error instanceof ServiceBusinessPolicyError) throw new BadRequestException(error.code); throw error; }
}

export function isOpenCommercialCheckout(row: { cart: unknown; events: { eventName: string; metadata: unknown }[] }) {
  const cart = row.cart && typeof row.cart === "object" && !Array.isArray(row.cart) ? row.cart as Record<string, unknown> : {};
  return Array.isArray(cart.items) && cart.items.length > 0 && !row.events.some(event => {
    const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata as Record<string, unknown> : {};
    return event.eventName === "checkout_abandoned" && metadata.reason === "buyer_initiated";
  });
}

@Injectable()
export class ChangeBusinessModeUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, actorId: string, value: unknown) {
    const input = parseBusinessModeChange(value);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: {
        businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true, storeSettings: true,
      } });
      if (!merchant) throw new NotFoundException("merchant_not_found");
      if (merchant.businessMode !== input.expectedBusinessMode) throw new ConflictException("business_mode_version_conflict");
      if (merchant.businessMode === input.businessMode && merchant.businessModeSelectedAt && !merchant.businessModeNeedsReview)
        return { businessMode: merchant.businessMode, businessModeSelectionState: "selected" };
      const facts = {
        activeProductOffers: await tx.product.count({ where: { merchantId, isActive: true, deletedAt: null, type: { not: "service" } } }),
        activeServiceOffers: await tx.product.count({ where: { merchantId, isActive: true, deletedAt: null, type: "service" } }),
        ongoingAppointments: await tx.serviceAppointment.count({ where: { merchantId, operationalStatus: { in: ["pending", "scheduled", "in_service"] } } })
          + await tx.serviceReservation.count({ where: { merchantId, appointmentId: null, status: "reserved",
            order: { status: { notIn: ["cancelled", "refunded", "returned", "failed"] } },
          } }),
      };
      try { assertCompatibleBusinessModeChange(input.businessMode, facts); }
      catch (error) { if (error instanceof ServiceBusinessPolicyError) throw new ConflictException(error.code); throw error; }
      if (merchant.businessMode !== input.businessMode) {
        if (await tx.paymentIntent.count({ where: { merchantId, status: { in: ["pending", "requires_action"] } } }))
          throw new ConflictException("business_mode_financial_attempt_pending");
        const checkouts = await tx.checkoutSession.findMany({ where: { merchantId, completedOrders: { none: {} } },
          select: { cart: true, events: { where: { eventName: "checkout_abandoned" }, select: { eventName: true, metadata: true } } } });
        const activeCart = await tx.storefrontCart.count({ where: { merchantId, expiresAt: { gt: new Date() }, NOT: { items: { equals: [] } } } });
        if (activeCart || checkouts.some(isOpenCommercialCheckout)) throw new ConflictException("business_mode_checkout_active");
      }
      const selected = await tx.merchant.updateMany({ where: { id: merchantId,
        businessMode: merchant.businessMode, businessModeSelectedAt: merchant.businessModeSelectedAt, businessModeNeedsReview: merchant.businessModeNeedsReview,
      }, data: { businessMode: input.businessMode, businessModeSelectedAt: new Date(), businessModeNeedsReview: false } });
      if (selected.count !== 1) throw new ConflictException("business_mode_version_conflict");
      // Closing new admission never deletes a policy, appointment or payment.
      await tx.serviceBusinessPolicy.updateMany({ where: { merchantId, admissionsEnabled: true }, data: { admissionsEnabled: false, version: { increment: 1 } } });
      await enqueueCompanySettingsWork(tx, merchantId, merchant.storeSettings, merchant.storeSettings, merchant.businessMode, input.businessMode);
      await invalidateServiceBusinessPublicationWithin(tx, merchantId);
      await tx.merchantAuditEvent.create({ data: {
        merchantId, actorType: "human", actorId, action: "business_mode.changed", resourceType: "merchant", resourceId: merchantId,
        metadata: { before: merchant.businessMode, after: input.businessMode, reviewResolved: merchant.businessModeNeedsReview },
      } });
      return { businessMode: input.businessMode, businessModeSelectionState: "selected" };
    });
  }
}
