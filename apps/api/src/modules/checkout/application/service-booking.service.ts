import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Cart, CheckoutSession } from "@zyon/shared-types";
import { isDeepStrictEqual } from "node:util";
import { lockCheckoutSessionAnchor } from "../../../shared/persistence/checkout-session-lock.js";
import { lockStorefrontCart } from "../../../shared/persistence/storefront-cart-lock.js";
import { canonicalizeProfessionalServiceCart, professionalStorefrontSlot } from "../../../shared/bookings/service-checkout-cart.js";
import { professionalSlotId, type ProfessionalCheckoutSelection } from "../../../shared/bookings/service-checkout-selection.js";
import { assertServiceCheckoutCreationCapability, readStoredServiceOrigin, serviceBookingParentFingerprint as parentFingerprint, type ServiceCheckoutBookingCapability } from "../../../shared/bookings/service-checkout-provenance.js";
import { readProfessionalCheckout } from "../../../shared/bookings/read-professional-checkout.js";
import { hasUnclassifiedServiceReservations } from "../../../shared/bookings/service-legacy-readiness.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { serviceSlotStore, type RedisServiceSlots } from "../../../shared/bookings/redis-service-slots.js";
import { ServiceSlotHoldsService } from "../../../shared/bookings/service-slot-holds.service.js";
import { assertNoActiveServiceCheckoutPayment } from "../../../shared/bookings/service-booking-active-payment.js";
import { resolveServiceBusinessPolicy } from "../../merchant/domain/service-business-policy.js";
import { getProfessionalAvailability } from "../../catalog/application/get-professional-availability.js";
import { FIXED_SERVICE_TIME_ZONE } from "../../catalog/domain/services/fixed-service-time-zone.js";
import { publicProfessionalProfile, readProfessionalServiceLink, resolveProfessionalServiceLink } from "../../catalog/domain/services/professional-service-link.js";
import { overlayCurrentProfessionalHolds } from "../../knowledge-base/infrastructure/prisma-current-service-facts-reader.js";
import { executionClock } from "../../revenue-manager/infrastructure/strategy-execution-ledger.js";
import { withStorefrontCartInTransaction } from "../../storefront/infrastructure/repositories/storefront-cart-transaction.js";
import type { StorefrontCartCommercialSnapshot, StorefrontCartItem } from "../../storefront/domain/ports/storefront-cart.port.js";
import { paymentCartFingerprint } from "../domain/services/payment-cart-fingerprint.js";
import { toCheckoutSession } from "../infrastructure/prisma/checkout-session.mapper.js";
import { StartCheckoutUseCase } from "./use-cases/start-checkout.use-case.js";
import type { TrustedCheckoutBuyer } from "./services/trusted-checkout-buyer.js";
import { CheckoutCartAuthorityService } from "./services/checkout-cart-authority.service.js";

/** Only the authenticated embed transport constructs this private context. */
export interface ServiceBookingScope {
  merchantId: string; sessionId: string; cartRef?: string; allowedOrigin: string; expiresAtUnix: number; buyer: TrustedCheckoutBuyer;
}
import { revalidateNativeServiceBookingAdmission, assertNativeServiceBookingGesture, type NativeServiceBookingScope } from "../../../shared/bookings/native-service-booking-authority.js";
type ServiceBookingRequestScope = ServiceBookingScope | NativeServiceBookingScope;

type Offer = { productId: string; variantId: string };
type ProfessionalChoice = Offer & { professionalId: string };
type Select = { selection: ProfessionalCheckoutSelection };
type Prepare = Select & { parent_cart_fingerprint: string };
type Tx = Prisma.TransactionClient;
const empty = (): StorefrontCartCommercialSnapshot => ({ items: [], total: 0, discount: 0, couponCode: null, freeShipping: false });
function commercial(row?: StorefrontCartCommercialSnapshot | null): StorefrontCartCommercialSnapshot {
  if (!row) return empty();
  if (!Array.isArray(row.items)) throw new ConflictException("service_booking_parent_changed");
  return structuredClone({ items: row.items, total: row.total, discount: row.discount, couponCode: row.couponCode, freeShipping: row.freeShipping });
}
function total(items: StorefrontCartItem[]) {
  const value = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new BadRequestException("cart_total_invalid");
  return value;
}

/** Buyer orchestration only. Existing cart, Start, lease and confirmation
 * writers retain their authority. This class never charges or confirms. */
export class ServiceBookingService {
  constructor(private readonly prisma: PrismaClient, private readonly start: StartCheckoutUseCase,
    private readonly holds: ServiceSlotHoldsService,
    private readonly store: () => Pick<RedisServiceSlots, "active" | "assertActive"> = serviceSlotStore,
    private readonly cartAuthority?: CheckoutCartAuthorityService) {}

  private nativeAdmission(scope: ServiceBookingRequestScope) {
    return scope.allowedOrigin === undefined ? { merchantId: scope.merchantId, sessionId: scope.sessionId, cartRef: scope.cartRef,
      globalUserId: scope.buyer.globalUserId, buyer: scope.buyer, expiresAtUnix: scope.expiresAtUnix } : undefined;
  }
  private capability(scope: ServiceBookingRequestScope, cart?: Cart): ServiceCheckoutBookingCapability {
    return Object.freeze({ merchantId: scope.merchantId, sessionId: scope.sessionId, globalUserId: scope.buyer.globalUserId,
      ...(scope.allowedOrigin === undefined ? { cartRef: scope.cartRef } : { allowedOrigin: scope.allowedOrigin }), expiresAtUnix: scope.expiresAtUnix,
      ...(cart ? { cartFingerprint: paymentCartFingerprint({ cart }) } : {}) });
  }
  private async authorize(tx: Tx, scope: ServiceBookingRequestScope) {
    if (scope.allowedOrigin === undefined) return (await revalidateNativeServiceBookingAdmission(tx, this.nativeAdmission(scope)))!;
    const buyer = await tx.buyerAccount.findUnique({ where: { globalUserId: scope.buyer.globalUserId }, select: { globalUserId: true, email: true } });
    if (!buyer || buyer.globalUserId !== scope.buyer.globalUserId || buyer.email !== scope.buyer.customer.email || scope.buyer.customer.email_verified !== true)
      throw new UnauthorizedException("embed_buyer_token_invalid");
    const now = await executionClock(tx);
    assertServiceCheckoutCreationCapability({ merchantId: scope.merchantId, sessionId: scope.sessionId, globalUserId: scope.buyer.globalUserId }, this.capability(scope), now);
    return now;
  }
  private async merchant(tx: Tx, scope: ServiceBookingRequestScope) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id=${scope.merchantId} FOR UPDATE`;
    if (rows.length !== 1) throw new NotFoundException("merchant_not_found");
    await this.authorize(tx, scope);
    if (await hasUnclassifiedServiceReservations(tx, scope.merchantId)) throw new ConflictException("service_legacy_classification_required");
    const merchant = await tx.merchant.findUniqueOrThrow({ where: { id: scope.merchantId }, select: {
      businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } });
    const policy = await tx.serviceBusinessPolicy.findUnique({ where: { merchantId: scope.merchantId } });
    const business = resolveServiceBusinessPolicy({ ...merchant, hasLegacyServiceData: false, policy });
    if (!business.capabilities.serviceBooking || !business.policy || business.policyVersion === null)
      throw new ConflictException("service_booking_" + business.bookingBlockReason);
    return { policy: business.policy, version: business.policyVersion };
  }
  private async ownedSession(tx: Tx, scope: ServiceBookingRequestScope) {
    const row = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.sessionId } } });
    if (!row) return;
    if (row.globalUserId !== scope.buyer.globalUserId || !row.cart || typeof row.cart !== "object" || Array.isArray(row.cart)
      || row.cart.cart_ref !== scope.cartRef) throw new UnauthorizedException("checkout_buyer_session_binding_mismatch");
    if (readStoredServiceOrigin(row) !== (scope.allowedOrigin === undefined ? "whatsapp" : "storefront")) throw new UnauthorizedException("service_booking_capability_invalid");
    return toCheckoutSession(row);
  }
  private async parent(tx: Tx, scope: ServiceBookingRequestScope, now: Date) {
    if (!scope.cartRef) return empty();
    const row = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartRef } } });
    if (row && row.expiresAt <= now) throw new ConflictException("checkout_cart_expired");
    return commercial(row as unknown as StorefrontCartCommercialSnapshot | null);
  }
  private async read<T>(scope: ServiceBookingRequestScope, professionalId: string | undefined, work: (tx: Tx, scope: ServiceBookingRequestScope, business: Awaited<ReturnType<ServiceBookingService["merchant"]>>) => Promise<T>) {
    const bound = structuredClone(scope);
    return this.prisma.$transaction(async tx => {
      await revalidateNativeServiceBookingAdmission(tx, this.nativeAdmission(bound));
      const business = await this.merchant(tx, bound);
      if (professionalId) await lockServiceProfessional(tx, bound.merchantId, professionalId);
      const result = await work(tx, bound, business);
      await this.authorize(tx, bound);
      return result;
    }, { timeout: 15_000 });
  }
  private async availability(tx: Tx, scope: ServiceBookingRequestScope, input: ProfessionalChoice & { fromDate: string; toDate: string }, business: Awaited<ReturnType<ServiceBookingService["merchant"]>>) {
    const facts = await readProfessionalServiceLink(tx, { ...input, merchantId: scope.merchantId });
    const session = await this.ownedSession(tx, scope), now = await this.authorize(tx, scope);
    const availability = await getProfessionalAvailability(tx, { ...input, merchantId: scope.merchantId, now });
    if (availability.policyVersion !== business.version) throw new ConflictException("service_policy_changed");
    let active: Awaited<ReturnType<RedisServiceSlots["active"]>> = [];
    if (business.policy.holdEnabled) {
      try { active = await this.store().active(scope.merchantId, "professional:" + input.professionalId); }
      catch { throw new ServiceUnavailableException("service_schedule_temporarily_unavailable"); }
    }
    const current = await this.authorize(tx, scope);
    const slots = overlayCurrentProfessionalHolds(availability.slots, active, "professional:" + input.professionalId, session?.sessionId)
      .filter(slot => Date.parse(slot.startsAt) > current.getTime());
    return { facts: { ...facts, timeZone: availability.timeZone }, slots, dates: [...new Set(slots.map(slot => slot.date))] };
  }
  private selected(facts: Awaited<ReturnType<typeof readProfessionalServiceLink>>, policyVersion: number,
    slot: { date: string; startsAt: string; endsAt: string; timeZone: string; durationMinutes: number }): ProfessionalCheckoutSelection {
    const value = { productId: facts.productId, variantId: facts.variantId, professionalId: facts.professionalId,
      professionalVersion: facts.professionalVersion, policyVersion, date: slot.date, startsAt: slot.startsAt, endsAt: slot.endsAt,
      timeZone: slot.timeZone, durationMinutes: slot.durationMinutes, priceInCents: facts.priceInCents, currency: facts.currency };
    return { ...value, slotId: professionalSlotId(facts.merchantId, value) };
  }
  private async accept(tx: Tx, scope: ServiceBookingRequestScope, selection: ProfessionalCheckoutSelection, business: Awaited<ReturnType<ServiceBookingService["merchant"]>>) {
    const facts = await readProfessionalServiceLink(tx, { ...selection, merchantId: scope.merchantId });
    if (selection.policyVersion !== business.version) throw new ConflictException("service_policy_changed");
    if (selection.professionalVersion !== facts.professionalVersion) throw new ConflictException("service_selection_stale");
    if (selection.priceInCents !== facts.priceInCents || selection.currency !== facts.currency) throw new ConflictException("service_offer_changed");
    const available = await this.availability(tx, scope, { ...selection, fromDate: selection.date, toDate: selection.date }, business);
    const slot = available.slots.find(value => value.startsAt === selection.startsAt && value.endsAt === selection.endsAt);
    if (!slot) throw new ConflictException("service_slot_unavailable");
    const canonical = this.selected(facts, business.version, slot);
    if (!isDeepStrictEqual(canonical, selection)) throw new ConflictException("service_selection_stale");
    return canonical;
  }
  async professionals(scope: ServiceBookingRequestScope, input: Offer) {
    return this.read(scope, undefined, async (tx, bound) => {
      const variant = await tx.productVariant.findFirst({ where: { id: input.variantId, productId: input.productId, isActive: true,
        product: { merchantId: bound.merchantId, type: "service", isActive: true, deletedAt: null } }, select: { id: true } });
      if (!variant) throw new NotFoundException("professional_service_not_found");
      const rows = await tx.professionalService.findMany({ where: { merchantId: bound.merchantId, productId: input.productId, isActive: true,
        professional: { merchantId: bound.merchantId, isActive: true, isPublished: true } },
        include: { professional: true, product: { include: { category: true, variants: { where: { id: input.variantId }, include: { price: true }, take: 1 } } } }, orderBy: { id: "asc" }, take: 51 });
      const professionals = rows.slice(0, 50).map(row => {
        const variant = row.product.variants[0];
        if (!variant) throw new NotFoundException("professional_service_not_found");
        const facts = resolveProfessionalServiceLink({ merchantId: bound.merchantId, professional: row.professional, link: row,
          product: row.product, category: row.product.category, variant });
        return { id: facts.professionalId, name: row.professional.publicName, version: facts.professionalVersion,
          timeZone: FIXED_SERVICE_TIME_ZONE, profile: publicProfessionalProfile(row.professional.publicProfile) };
      });
      return { professionals, has_more: rows.length > 50 };
    });
  }
  async dates(scope: ServiceBookingRequestScope, input: ProfessionalChoice & { fromDate: string; toDate: string }) {
    return this.read(scope, input.professionalId, async (tx, bound, business) => {
      const result = await this.availability(tx, bound, input, business);
      return { dates: result.dates, professional_version: result.facts.professionalVersion, policy_version: business.version, time_zone: result.facts.timeZone };
    });
  }
  async slots(scope: ServiceBookingRequestScope, input: ProfessionalChoice & { date: string }) {
    return this.read(scope, input.professionalId, async (tx, bound, business) => {
      const result = await this.availability(tx, bound, { ...input, fromDate: input.date, toDate: input.date }, business);
      return { selections: result.slots.map(slot => this.selected(result.facts, business.version, slot)) };
    });
  }
  async select(scope: ServiceBookingRequestScope, input: Select) {
    const choice = structuredClone(input.selection);
    return this.read(scope, choice.professionalId, async (tx, bound, business) => {
      const selection = await this.accept(tx, bound, choice, business);
      const [product, professional] = await Promise.all([
        tx.product.findFirst({ where: { id: choice.productId, merchantId: bound.merchantId }, select: { name: true } }),
        tx.serviceProfessional.findFirst({ where: { id: choice.professionalId, merchantId: bound.merchantId }, select: { publicName: true } })]);
      if (!product || !professional) throw new NotFoundException("professional_service_not_found");
      const parent = await this.parent(tx, bound, await this.authorize(tx, bound));
      return { selection, service: { name: product.name }, professional: { name: professional.publicName },
        parent_cart_fingerprint: parentFingerprint(parent), policy: { version: business.version, ...business.policy } };
    });
  }
  private cart(items: StorefrontCartItem[], currency: Cart["currency"], ref?: string): Cart {
    if (!items.length || items.length > 100) throw new BadRequestException("service_checkout_selection_required");
    return { currency, source: ref ? "storefront" : "checkout", ...(ref ? { cart_ref: ref } : {}), total: total(items) / 100,
      items: items.map(item => ({ sku: item.sku, product_id: item.productId, variantId: item.variantId, name: item.name,
        quantity: item.quantity, price: item.unitPriceCents / 100, productType: "service", fulfillmentStrategy: "scheduled_service",
        fulfillmentSchedule: item.selectedServiceSlot })) };
  }
  /** Explicit existing /embed/start is a separate review action. Merely retrying
   * prepare never enters this lease-acquiring continuation. */
  async continuationCapability(merchantId: string, cartRef: string, verifiedScope: () => ServiceBookingRequestScope) {
    const source = await this.prisma.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: cartRef } } });
    if (!source || !Array.isArray(source.items) || !(source.items as unknown as StorefrontCartItem[]).some(item => item.selectedServiceSlot?.professionalId)) return;
    const bound = structuredClone(verifiedScope());
    if (bound.merchantId !== merchantId || bound.cartRef !== cartRef) throw new UnauthorizedException("service_booking_capability_invalid");
    const stored = await this.prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: bound.sessionId } } });
    // A finalized checkout resumes its immutable historical terms through the
    // existing Start path; it is not a request for a newly available slot.
    if (stored && stored.globalUserId === bound.buyer.globalUserId && await this.holds.isCommittedCheckout(toCheckoutSession(stored))) return;
    if (!this.cartAuthority) throw new ServiceUnavailableException("checkout_cart_authority_unavailable");
    const cart = await this.cartAuthority.resolveStorefront(merchantId, cartRef);
    return this.prisma.$transaction(async tx => {
      await revalidateNativeServiceBookingAdmission(tx, this.nativeAdmission(bound));
      await this.merchant(tx, bound);
      await readProfessionalCheckout(tx, { merchantId, sessionId: bound.sessionId, cart }, undefined, { store: () => this.store() });
      await lockCheckoutSessionAnchor(tx, merchantId, bound.sessionId);
      await lockStorefrontCart(tx, merchantId, cartRef);
      const current = await this.parent(tx, bound, await this.authorize(tx, bound));
      if (!isDeepStrictEqual(current, commercial(source as unknown as StorefrontCartCommercialSnapshot)))
        throw new ConflictException("service_booking_parent_changed");
      const existing = await this.ownedSession(tx, bound);
      if (existing && paymentCartFingerprint(existing) !== paymentCartFingerprint({ cart })) throw new ConflictException("service_booking_cart_changed");
      await this.authorize(tx, bound);
      return Object.freeze({ ...this.capability(bound, cart), storefrontCartRef: cartRef, parentCartFingerprint: parentFingerprint(current), leaseIntent: "review_checkout" as const });
    }, { timeout: 15_000 });
  }
  /** Explicit current native review button only. Background payment and ordinary
   * prepare replay never enter this lease-acquiring continuation. */
  async reviewNativeCheckout(scope: NativeServiceBookingScope) {
    assertNativeServiceBookingGesture(scope, "continue");
    const capability = await this.continuationCapability(scope.merchantId, scope.cartRef, () => scope);
    if (!capability) throw new ConflictException("service_booking_review_unavailable");
    const row = await this.prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.sessionId } } });
    if (!row) throw new ConflictException("service_booking_preparation_unknown");
    return this.start.execute({ merchant_id: scope.merchantId, session_id: scope.sessionId, cart: toCheckoutSession(row).cart },
      { serverChannel: "whatsapp", storefrontCartRef: scope.cartRef, trustedWhatsAppBuyer: scope.buyer, requireBuyerProof: true, bookingCapability: capability });
  }
  async prepare(scope: ServiceBookingRequestScope, input: Prepare) {
    if (scope.allowedOrigin === undefined) assertNativeServiceBookingGesture(scope, "continue");
    const bound = structuredClone(scope), command = structuredClone(input);
    const prepared = await this.prisma.$transaction(async tx => {
      await revalidateNativeServiceBookingAdmission(tx, this.nativeAdmission(bound));
      const business = await this.merchant(tx, bound), parent = await this.parent(tx, bound, await this.authorize(tx, bound));
      if (parent.discount !== 0 || parent.couponCode !== null || parent.freeShipping
        || parent.items.some(item => item.crossSellIntent !== undefined || item.marketplace || item.selectedOptions?.length || !item.selectedServiceSlot?.professionalId))
        throw new ConflictException("service_cart_review_required");
      const professionalIds = [...new Set([...parent.items.map(item => item.selectedServiceSlot!.professionalId!), command.selection.professionalId])].sort();
      for (const id of professionalIds) await lockServiceProfessional(tx, bound.merchantId, id);
      const selection = await this.accept(tx, bound, command.selection, business);
      const target = parent.items.findIndex(item => item.variantId === selection.variantId && item.productId === selection.productId && item.selectedServiceSlot?.slotId === selection.slotId);
      let replayed = false;
      if (parentFingerprint(parent) !== command.parent_cart_fingerprint) {
        const without = target < 0 ? undefined : { ...parent, items: parent.items.filter((_, index) => index !== target) };
        if (without) without.total = total(without.items);
        if (!without || parentFingerprint(without) !== command.parent_cart_fingerprint) throw new ConflictException("service_booking_parent_changed");
        replayed = true;
      }
      const next = structuredClone(parent);
      if (target < 0) {
        const variant = await tx.productVariant.findFirst({ where: { id: selection.variantId, productId: selection.productId,
          isActive: true, product: { merchantId: bound.merchantId, type: "service", isActive: true, deletedAt: null } }, include: { product: true, media: { orderBy: { order: "asc" }, take: 1 } } });
        if (!variant) throw new NotFoundException("professional_service_not_found");
        next.items.push({ variantId: variant.id, productId: variant.productId, name: variant.product.name, sku: variant.sku,
          quantity: 1, unitPriceCents: selection.priceInCents, selectedServiceSlot: professionalStorefrontSlot(selection),
          ...(variant.media[0]?.url ? { imageUrl: variant.media[0].url } : {}) });
        next.total = total(next.items);
      } else if (next.items[target]!.quantity !== 1) throw new BadRequestException("service_slot_quantity_invalid");
      const cart = await canonicalizeProfessionalServiceCart(tx, bound.merchantId, this.cart(next.items, selection.currency as Cart["currency"], bound.cartRef));
      await lockCheckoutSessionAnchor(tx, bound.merchantId, bound.sessionId);
      if (bound.cartRef) await lockStorefrontCart(tx, bound.merchantId, bound.cartRef);
      const current = await this.parent(tx, bound, await this.authorize(tx, bound));
      if (!isDeepStrictEqual(current, parent)) throw new ConflictException("service_booking_parent_changed");
      const existing = await this.ownedSession(tx, bound);
      if (existing && paymentCartFingerprint(existing) !== paymentCartFingerprint({ cart })) throw new ConflictException("service_booking_cart_changed");
      if (business.policy.paymentMode === "at_attendance") await assertNoActiveServiceCheckoutPayment(tx, bound.merchantId, bound.sessionId);
      if (!existing && target < 0 && bound.cartRef) await withStorefrontCartInTransaction(tx, bound.merchantId, bound.cartRef, async (_tx, locked) => {
        if (!isDeepStrictEqual(commercial(locked), parent)) throw new ConflictException("service_booking_parent_changed");
        await this.authorize(tx, bound);
        locked.items = structuredClone(next.items);
      });
      const now = await this.authorize(tx, bound);
      if (cart.items.some(item => Date.parse(item.fulfillmentSchedule!.startsAt) <= now.getTime())) throw new ConflictException("service_slot_unavailable");
      return { cart, existing, sourceFingerprint: bound.cartRef ? parentFingerprint(next) : undefined, replayed: replayed || !!existing };
    }, { timeout: 15_000 });
    const capability: ServiceCheckoutBookingCapability = Object.freeze({ ...this.capability(bound, prepared.cart),
      ...(bound.cartRef ? { storefrontCartRef: bound.cartRef, parentCartFingerprint: prepared.sourceFingerprint } : {}) });
    if (!prepared.existing) {
      try {
        await this.start.execute({ merchant_id: bound.merchantId, session_id: bound.sessionId, cart: prepared.cart },
          bound.allowedOrigin === undefined
            ? { serverChannel: "whatsapp", storefrontCartRef: bound.cartRef, trustedWhatsAppBuyer: bound.buyer, requireBuyerProof: true, bookingCapability: capability }
            : { serverChannel: "storefront", storefrontCartRef: bound.cartRef, trustedBuyer: bound.buyer, requireBuyerProof: true, bookingCapability: capability });
      } catch (error) {
        const response = error instanceof ConflictException && error.getStatus() === 409 ? error.getResponse() : undefined;
        if (!response || typeof response !== "object" || Array.isArray(response) || !("code" in response) || !("next_action" in response)
          || response.code !== "service_hold_required" || response.next_action !== "review_checkout") throw error;
        // One fresh observation below may see an original creator's lease.
        // It never acquires, waits in a loop, or guarantees creator ordering.
      }
    }
    const loaded = await this.prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: bound.merchantId, sessionId: bound.sessionId } } });
    if (!loaded) throw new ConflictException("service_booking_preparation_unknown");
    const session = toCheckoutSession(loaded), state = await this.holds.state(session);
    return this.prisma.$transaction(async tx => {
      await revalidateNativeServiceBookingAdmission(tx, this.nativeAdmission(bound));
      await this.merchant(tx, bound);
      const current = await this.ownedSession(tx, bound);
      if (!current || paymentCartFingerprint(current) !== capability.cartFingerprint) throw new ConflictException("service_booking_cart_changed");
      const read = await readProfessionalCheckout(tx, current, undefined, { store: () => this.store() }), [products, professionals] = await Promise.all([
        tx.product.findMany({ where: { merchantId: bound.merchantId, id: { in: read.selections.map(item => item.productId) } }, select: { id: true, name: true } }),
        tx.serviceProfessional.findMany({ where: { merchantId: bound.merchantId, id: { in: read.selections.map(item => item.professionalId) } }, select: { id: true, publicName: true } })]);
      await lockCheckoutSessionAnchor(tx, bound.merchantId, bound.sessionId);
      if (bound.cartRef) await lockStorefrontCart(tx, bound.merchantId, bound.cartRef);
      const winner = await this.ownedSession(tx, bound);
      if (!winner || paymentCartFingerprint(winner) !== capability.cartFingerprint) throw new ConflictException("service_booking_cart_changed");
      if (read.policy.paymentMode === "at_attendance") await assertNoActiveServiceCheckoutPayment(tx, bound.merchantId, bound.sessionId);
      if (bound.cartRef && parentFingerprint(await this.parent(tx, bound, await this.authorize(tx, bound))) !== capability.parentCartFingerprint)
        throw new ConflictException("service_booking_parent_changed");
      const now = await this.authorize(tx, bound);
      if (read.selections.some(item => Date.parse(item.startsAt) <= now.getTime())) throw new ConflictException("service_slot_unavailable");
      if (read.policy.holdEnabled && (!state.service_slot_hold || Date.parse(state.service_slot_hold.expiresAt) <= now.getTime())) throw new ConflictException({
        code: "service_hold_required", message: "Revise os dados do atendimento e confirme a continua\u00e7\u00e3o da compra.", next_action: "review_checkout" });
      const selections = read.selections.map(item => {
        const product = products.find(value => value.id === item.productId), professional = professionals.find(value => value.id === item.professionalId);
        if (!product || !professional) throw new ConflictException("service_offer_changed");
        return { ...item, productName: product.name, professionalName: professional.publicName };
      });
      const hold = read.policy.holdEnabled && state.service_slot_hold ? { expiresAt: state.service_slot_hold.expiresAt,
        slots: state.service_slot_hold.slots.map(({ resourceId, slotId, startsAt, endsAt }) => ({ resourceId, slotId, startsAt, endsAt })) } : null;
      return { session_id: bound.sessionId, replayed: prepared.replayed, confirmed: false as const,
        cart_fingerprint: paymentCartFingerprint(current), payment_mode: read.policy.paymentMode, policy_version: read.policyVersion,
        requires_hold: read.policy.holdEnabled, service_slot_hold: hold, selections };
    }, { timeout: 15_000 });
  }
}
