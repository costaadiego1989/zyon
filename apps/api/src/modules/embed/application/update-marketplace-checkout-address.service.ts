import { BadRequestException, ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import type { CustomerAddress } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { hasMarketplaceCheckout } from "../../checkout/infrastructure/marketplace-checkout-scope.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";

type Address = Required<CustomerAddress>;
const states = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function address(value: unknown): Address {
  if (!object(value) || Object.keys(value).some(key => !["zip", "street", "number", "complement", "neighborhood", "city", "state"].includes(key))) {
    throw new BadRequestException("marketplace_address_invalid");
  }
  const text = (key: string, max: number, optional = false): string => {
    const raw = value[key] ?? (optional ? "" : undefined);
    if (typeof raw !== "string" || /[\u0000-\u001f\u007f]/.test(raw)) throw new BadRequestException("marketplace_address_invalid");
    const normalized = raw.trim();
    if ((!optional && !normalized) || normalized.length > max) throw new BadRequestException("marketplace_address_invalid");
    return normalized;
  };
  const zip = text("zip", 9), state = text("state", 2).toUpperCase();
  if (!/^\d{5}-?\d{3}$/.test(zip) || /^0{5}-?0{3}$/.test(zip) || !states.has(state)) {
    throw new BadRequestException("marketplace_address_invalid");
  }
  return { zip: zip.replace("-", ""), street: text("street", 200), number: text("number", 32),
    complement: text("complement", 160, true), neighborhood: text("neighborhood", 120), city: text("city", 120), state };
}

export interface UpdateMarketplaceCheckoutAddressResponse {
  ok: true;
  session_id: string;
  address: Address;
  shipping_invalidated: boolean;
}

/** An explicit buyer confirmation, independent of chat extraction or a carrier.
 * Only this narrow writer may invalidate marketplace shipping before payment. */
@Injectable()
export class UpdateMarketplaceCheckoutAddressService {
  private readonly logger = new Logger(UpdateMarketplaceCheckoutAddressService.name);
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(MetricsService) private readonly metrics?: MetricsService) {}

  async execute(input: { merchantId: string; sessionId: string; address: unknown }): Promise<UpdateMarketplaceCheckoutAddressResponse> {
    try {
      const normalized = address(input.address);
      if (!input.merchantId?.trim() || !input.sessionId?.trim()) throw new BadRequestException("marketplace_address_invalid");
      const result = await this.prisma.$transaction(async tx => {
        // Shares the first lock with shipping selection, generic session writes,
        // funding admission and the first provider submission.
        await tx.$queryRaw`SELECT session_id FROM checkout_sessions WHERE merchant_id = ${input.merchantId}
          AND session_id = ${input.sessionId} FOR UPDATE`;
        const repository = new PrismaCheckoutRepository(tx, true);
        const current = await repository.getSession(input.merchantId, input.sessionId);
        if (!current || current.merchantId !== input.merchantId || current.sessionId !== input.sessionId) {
          throw new NotFoundException("checkout_session_not_found");
        }
        if (!await hasMarketplaceCheckout(tx, { merchantId: input.merchantId, sessionId: input.sessionId, session: current })) {
          throw new ConflictException("marketplace_address_not_available");
        }
        const customer = current.customer;
        if (!customer?.fullName?.trim() || !customer.email?.trim() || !customer.phone?.replace(/\D/g, "") ||
          customer.cpf?.replace(/\D/g, "").length !== 11) throw new BadRequestException("customer_registration_required");
        let previous: Address | undefined;
        try { previous = address(customer.address); } catch { /* incomplete legacy address */ }
        if (previous && isDeepStrictEqual(previous, normalized)) {
          return { ok: true as const, session_id: input.sessionId, address: normalized, shipping_invalidated: false };
        }
        const cartRef = (current.cart as { cart_ref?: string }).cart_ref ?? input.sessionId;
        if (await tx.marketplaceFundingPlan.findFirst({ where: { OR: [
          { hostMerchantId: input.merchantId, checkoutSessionId: { in: [input.sessionId, cartRef] } },
          { payment: { merchantId: input.merchantId, sessionId: input.sessionId } },
        ] }, select: { paymentIntentId: true } }) || await tx.paymentIntent.findFirst({
          where: { merchantId: input.merchantId, sessionId: input.sessionId }, select: { id: true },
        })) throw new ConflictException("marketplace_funding_checkout_changed");
        // The generic writer supplies its existing funded-cart defense. Keep
        // its current shipping snapshot until the narrow invalidation below.
        await repository.saveSession({ ...current, customer: { ...customer, address: normalized,
          // This means the buyer explicitly confirmed their address, as with
          // the existing chat confirmation; it is not carrier/geocoding proof.
          address_verified: true }, updatedAt: new Date().toISOString() });
        await tx.checkoutSession.update({ where: { merchantId_sessionId: {
          merchantId: input.merchantId, sessionId: input.sessionId,
        } }, data: { shipping: Prisma.DbNull, shippingOptions: Prisma.DbNull } });
        return { ok: true as const, session_id: input.sessionId, address: normalized, shipping_invalidated: true };
      });
      this.observe(result.shipping_invalidated ? "updated" : "unchanged");
      return result;
    } catch (error) {
      const expected = error instanceof HttpException && [400, 404, 409].includes(error.getStatus());
      this.observe(expected ? "blocked" : "error");
      if (expected) throw error;
      throw new ServiceUnavailableException("marketplace_address_update_unavailable");
    }
  }

  private observe(outcome: "updated" | "unchanged" | "blocked" | "error"): void {
    this.metrics?.marketplaceCheckoutAddressUpdates.inc({ outcome });
    this.logger.log({ event: "marketplace.checkout_address_update", outcome });
  }
}
