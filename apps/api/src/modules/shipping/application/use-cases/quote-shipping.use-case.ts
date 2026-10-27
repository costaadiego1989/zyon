import { Injectable, Inject, Optional, Logger, ConflictException, BadRequestException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { hasMarketplaceCheckout } from "../../../checkout/infrastructure/marketplace-checkout-scope.js";
import { requiresPhysicalDelivery } from "../../../checkout/domain/services/cart-fulfillment.js";
import type { Cart, CheckoutSession, ShippingQuote } from "@zyon/shared-types";
import { checkoutShippingInput } from "../checkout-shipping-quote.js";
import { hasPreparedCheckoutPayment } from "../../../checkout/infrastructure/checkout-payment-scope.js";
import { buildQuoteKey } from "@zyon/shipping-engine";
import { ShippingQuoteEntity, type ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";
import { SHIPPING_QUOTE_REPOSITORY, type ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";
import { CARRIER_ADAPTERS, type CarrierPort } from "../../domain/ports/carrier.port.js";
import { OWN_DELIVERY_CONFIG_REPOSITORY, type OwnDeliveryConfigRepository } from "../../domain/ports/own-delivery-config.port.js";
import { applyFreeShippingPolicy } from "../../domain/policies/free-shipping.policy.js";
import type { PackageDimensions } from "@zyon/shared-types";
import {
  MERCHANT_RULES_REPOSITORY,
  type MerchantRulesRepository
} from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import { z } from "zod";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { SHIPPING_REFERENCE_CARRIERS } from "../../domain/ports/carrier.port.js";
import { manualDeliveryConfigSchema, normalizeDeliveryNeighborhood, quoteManualDelivery } from "../../domain/services/manual-delivery-quote.js";
import type { NeighborhoodDeliveryOrigin } from "../../domain/services/neighborhood-delivery-origin.js";
import { evaluateSelectedNeighborhoodDelivery } from "../../domain/services/selected-neighborhood-delivery.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import type { OwnDeliveryConfig } from "../../domain/ports/own-delivery-config.port.js";
import { createHash } from "node:crypto";
import { lookupAddressByViaCep } from "../../../checkout/domain/services/viacep-lookup.service.js";
import { geocodeBrazilianCep, haversineDistance, getPriceForDistance } from "../../domain/services/distance-calculator.service.js";
import type { OwnDeliveryRadiusZone } from "../../domain/ports/own-delivery-config.port.js";

export interface QuoteShippingInput {
  session_id: string;
  merchant_id: string;
  destination_zip: string;
  destination_neighborhood?: string;
  destination_city?: string;
  destination_state?: string;
  cart_total: number;
  /**
   * @deprecated C1 fix: IGNORED at runtime. Free-shipping threshold is always
   * derived from merchant rules. Field kept only for type-level backward compat
   * with existing callers; will be removed once all callers drop it.
   */
  free_shipping_threshold?: number;
  origin_zip?: string;
  packages?: PackageDimensions[];
  items?: { sku: string; quantity: number }[];
}

export type ShippingReferenceInput = Omit<QuoteShippingInput, "free_shipping_threshold"> & { basisHash: string; configurationHash: string };
export type ShippingReferenceSnapshot = { referenceOnly: true; id: string; expiresAt: string; basisHash: string; configurationHash: string;
  results: ShippingQuoteResult[]; reason?: "source_changed" | "origin_required" | "origin_address_configuration_required" | "dimensions_required" | "address_required" | "coverage_unavailable" | "carrier_unavailable" };
export function shippingReferenceConfigurationHash(manual: unknown, originZip: string, origin?: NeighborhoodDeliveryOrigin, carrierEnabled?: boolean): string {
  const neighborhood = manual && typeof manual === "object" && Reflect.get(manual, "enabled") === true && Reflect.get(manual, "mode") === "neighborhood";
  return createHash("sha256").update(canonicalJson({ namespace: "storefront-reference-v1", manual, originZip,
    ...(neighborhood ? { origin: origin ?? null } : {}), ...(carrierEnabled !== undefined ? { carrierEnabled } : {}) })).digest("hex");
}
const referenceInput = z.strictObject({ session_id: z.string().min(1).max(191), merchant_id: z.string().min(1).max(191),
  destination_zip: z.string().regex(/^\d{8}$/).refine(value => value !== "00000000"), destination_neighborhood: z.string().min(1).max(120).optional(),
  destination_city: z.string().min(1).max(191).optional(), destination_state: z.string().length(2).optional(),
  cart_total: z.number().finite().nonnegative().refine(value => Number.isSafeInteger(Math.round(value * 100)) && Math.round(value * 100) <= 2_147_483_647),
  origin_zip: z.string().max(8).optional(), basisHash: z.string().regex(/^[a-f0-9]{64}$/), configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  packages: z.array(z.strictObject({ weightKg: z.number().finite().positive(), heightCm: z.number().finite().positive(),
    widthCm: z.number().finite().positive(), lengthCm: z.number().finite().positive(), quantity: z.number().int().min(1).max(99) })).min(1).max(200).optional(),
  items: z.array(z.strictObject({ sku: z.string().min(1).max(191), quantity: z.number().int().min(1).max(99) })).min(1).max(200),
});
const referenceResults = z.array(z.object({ carrier_key: z.string().min(1).max(300), label: z.string().min(1).max(300),
  price: z.number().int().min(0).max(2_147_483_647), eta_days: z.number().int().min(0).max(3650), is_free: z.literal(false),
  estimated_value: z.number().int().positive().optional(), estimated_unit: z.enum(["minutes", "days"]).optional() })).max(100);

@Injectable()
export class QuoteShippingUseCase {
  private readonly logger = new Logger(QuoteShippingUseCase.name);

  constructor(
    @Inject(SHIPPING_QUOTE_REPOSITORY) private readonly quotes: ShippingQuoteRepository,
    @Inject(CARRIER_ADAPTERS) private readonly carriers: CarrierPort[],
    // P0 fix: merchant rules are the authoritative source for free-shipping
    // threshold. @Optional so existing unit tests that don't wire the repo
    // still compile; when absent, free-shipping policy is effectively disabled
    // (threshold = Infinity), which is the safe/conservative default.
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY)
    private readonly merchantRules?: MerchantRulesRepository,
    // Own delivery config — optional for backward compat with tests
    @Optional() @Inject(OWN_DELIVERY_CONFIG_REPOSITORY)
    private readonly ownDeliveryConfig?: OwnDeliveryConfigRepository,
    @Optional() @Inject(SHIPPING_REFERENCE_CARRIERS) private readonly referenceCarriers?: CarrierPort[],
    @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient
  ) {}

  /** Locality gate only, not quote/payment authority. Only an identified
   * neighborhood selection is constrained; an unselected session or another
   * carrier is never rejected just because neighborhood mode is configured. */
  async assertNeighborhoodDestination(session: CheckoutSession, selected: ShippingQuote | null = session.shipping ?? null): Promise<void> {
    if (!selected) return;
    if (selected.carrierKey?.startsWith("own_delivery_neighborhood_")) selected = { ...selected, carrier: selected.carrierKey };
    if (selected.carrier !== "Entrega" && !selected.carrier?.startsWith("own_delivery_neighborhood_")) return;
    const source = selected.quoteId ? await this.quotes.findById(selected.quoteId, session.merchantId) : await this.quotes.findBySession(session.sessionId, session.merchantId);
    const config = await this.ownDeliveryConfig?.getByMerchantId(session.merchantId);
    const origin = config?.enabled && config.mode === "neighborhood" ? await this.ownDeliveryConfig?.getNeighborhoodOrigin?.(session.merchantId) : undefined;
    const decision = evaluateSelectedNeighborhoodDelivery({ merchantId: session.merchantId, sessionId: session.sessionId, selected,
      address: session.customer?.address, addressVerified: session.customer?.address_verified === true,
      config, origin, cartTotalCents: Math.round(session.cart.total * 100), sourceQuote: source?.snapshot() });
    if (decision.kind === "requires_review") throw new BadRequestException({ code: decision.reason });
  }

  /** Reference ONLY: no cache lookup, quote persistence/events, selection or
   * subsidy. Existing execute() behavior below remains independent. */
  async executeReference(rawInput: ShippingReferenceInput): Promise<ShippingReferenceSnapshot> {
    const input = referenceInput.parse(structuredClone(rawInput));
    const raw = await this.ownDeliveryConfig?.getByMerchantId(input.merchant_id);
    const merchant = await this.prisma?.merchant.findUnique({ where: { id: input.merchant_id }, select: { melhorEnvioEnabled: true } });
    const carrierEnabled = merchant?.melhorEnvioEnabled;
    const manual = raw == null ? null : manualDeliveryConfigSchema.parse(raw);
    if (manual && manual.merchantId !== input.merchant_id) throw new Error("shipping_manual_config_scope_mismatch");
    const entity = ShippingQuoteEntity.create({ session_id: input.session_id, merchant_id: input.merchant_id, destination_zip: input.destination_zip });
    const snapshot = entity.snapshot();
    const result: ShippingReferenceSnapshot = { referenceOnly: true, id: snapshot.id, expiresAt: snapshot.expires_at,
      basisHash: input.basisHash, configurationHash: input.configurationHash, results: [] };
    const refuse = (reason: NonNullable<ShippingReferenceSnapshot["reason"]>) => ({ ...result, reason });
    const originResult = manual?.enabled && manual.mode === "neighborhood" ? await this.ownDeliveryConfig?.getNeighborhoodOrigin?.(input.merchant_id) : undefined;
    if (manual?.enabled && manual.mode === "neighborhood" && originResult?.kind !== "ready" && !carrierEnabled) return refuse("origin_address_configuration_required");
    const origin = originResult?.kind === "ready" ? originResult.origin : undefined;
    if (shippingReferenceConfigurationHash(manual, input.origin_zip ?? "", origin, carrierEnabled) !== input.configurationHash) return refuse("source_changed");
    if (manual?.enabled) {
      if (manual.mode === "neighborhood" && !input.destination_neighborhood && !carrierEnabled) return refuse("address_required");
      if (manual.mode === "radius" && !/^\d{8}$/.test(input.origin_zip ?? "") && !carrierEnabled) return refuse("origin_required");
      const tariffs = await this.referenceOwnDeliveryOptions(input, manual, origin);
      // Configured free-above is a benefit candidate, not authorization. Show
      // only the raw configured tariff; do not invent or infer a carrier cost.
      result.results = tariffs.map(({ original_price, ...tariff }) => ({ ...tariff, price: original_price ?? tariff.price, is_free: false }));
      if (!result.results.length && carrierEnabled === false) return refuse("coverage_unavailable");
    }
    {
      if (carrierEnabled === false) return result.results.length ? result : refuse("carrier_unavailable");
      if (!/^\d{8}$/.test(input.origin_zip ?? "")) return result.results.length ? result : refuse("origin_required");
      if (!input.packages?.length) return result.results.length ? result : refuse("dimensions_required");
      const context = { merchantId: input.merchant_id, originZip: input.origin_zip!, destinationZip: input.destination_zip,
        cartTotalCents: Math.round(input.cart_total * 100), packages: input.packages };
      const settled = await Promise.allSettled((this.referenceCarriers ?? []).filter(carrier => carrier.carrierKey !== "flat-rate")
        .map(carrier => carrier.fetchQuotes(context)));
      result.results = dedupeQuoteResults([...result.results, ...settled.flatMap(item => item.status === "fulfilled" ? item.value : [])]);
      if (!result.results.length) return refuse("carrier_unavailable");
    }
    result.results = referenceResults.parse(result.results);
    if (Date.parse(result.expiresAt) <= Date.now()) return { ...refuse("source_changed"), results: [] };
    return result;
  }

  private async referenceOwnDeliveryOptions(
    input: QuoteShippingInput,
    config: OwnDeliveryConfig,
    origin?: NeighborhoodDeliveryOrigin
  ): Promise<ShippingQuoteResult[]> {
    const radiusPriceCents = config.mode === "radius"
      ? await this.computeRadiusPrice(input.origin_zip ?? "", input.destination_zip, config.radiusZones!) : null;
    if (config.mode === "flat") return this.appendOwnDeliveryOptions([], input, { ...config, freeAboveCents: null });
    return quoteManualDelivery(config, { cartTotalCents: Math.round(input.cart_total * 100),
      neighborhood: input.destination_neighborhood, radiusPriceCents, origin,
      destinationCity: input.destination_city, destinationState: input.destination_state }).map(option => ({ ...option,
        source: "own_delivery" as const, estimated_value: config.estimatedValue, estimated_unit: config.estimatedUnit }));
  }

  async execute(input: QuoteShippingInput, resolveCanonicalPackages?: () => PackageDimensions[]) {
    if (resolveCanonicalPackages) { try { input = { ...input, packages: resolveCanonicalPackages() }; } catch { input = { ...input, packages: [] }; } }
    await this.assertGenericCheckout(input);
    const configuration = await this.configuration(input);
    const reusable = await this.quotes.findValidByKey(configuration.key, input.merchant_id);
    if (reusable && reusable.snapshot().session_id === input.session_id && reusable.snapshot().results.length) {
      await this.assertGenericCheckout(input);
      return reusable.snapshot();
    }
    const results = await this.calculate(input, configuration);
    if ((await this.configuration(input)).key !== configuration.key) throw new ConflictException("shipping_configuration_changed");
    const quote = ShippingQuoteEntity.create({
      session_id: input.session_id, merchant_id: input.merchant_id,
      destination_zip: input.destination_zip.replace(/\D/g, ""), quote_key: configuration.key, ttl_seconds: 600,
    }).addResults(results).recordCreated();
    await this.assertGenericCheckout(input);
    await this.quotes.saveWithEvents(quote);
    return quote.snapshot();
  }

  /** Read-only product/cart preview; never creates a checkout or changes a cart. */
  async preview(input: Omit<QuoteShippingInput, "session_id">) {
    const configuration = await this.configuration(input);
    const results = await this.calculate(input, configuration);
    if ((await this.configuration(input)).key !== configuration.key) throw new ConflictException("shipping_configuration_changed");
    return { results };
  }

  async quoteKey(input: Omit<QuoteShippingInput, "session_id">): Promise<string> {
    return (await this.configuration(input)).key;
  }

  async assertSelection(session: CheckoutSession): Promise<void> {
    await this.assertNeighborhoodDestination(session);
    const selected = session.shipping;
    if (!selected?.quoteId || !selected.carrierKey) throw new ConflictException("shipping_quote_required");
    const quote = await this.quotes.findById(selected.quoteId, session.merchantId);
    if (!quote || quote.isExpired()) throw new ConflictException("shipping_quote_expired");
    const snapshot = quote.snapshot();
    const result = snapshot.results.find(result => result.carrier_key === selected.carrierKey);
    if (snapshot.session_id !== session.sessionId || snapshot.quote_key !== await this.quoteKey(checkoutShippingInput(session)) ||
      !result || result.price !== Math.round(selected.customerPrice * 100)) throw new ConflictException("shipping_quote_changed");
  }

  private async configuration(input: Omit<QuoteShippingInput, "session_id">) {
    if (!/^\d{8}$/.test(input.destination_zip.replace(/\D/g, ""))) throw new BadRequestException("shipping_destination_zip_invalid");
    if (!Number.isFinite(input.cart_total) || input.cart_total < 0) throw new BadRequestException("shipping_cart_total_invalid");
    const [merchant, rules, ownDelivery] = await Promise.all([
      this.prisma?.merchant.findUnique({ where: { id: input.merchant_id }, select: { melhorEnvioEnabled: true, updatedAt: true } }),
      this.merchantRules?.getRules(input.merchant_id),
      this.ownDeliveryConfig?.getByMerchantId(input.merchant_id),
    ]);
    if (!merchant) throw new BadRequestException("shipping_merchant_not_found");
    const originZip = (rules?.originZip ?? input.origin_zip ?? "").replace(/\D/g, "");
    const key = "delivery-v2:" + createHash("sha256").update(JSON.stringify({
      cart: buildQuoteKey({ merchantId: input.merchant_id, destinationZip: input.destination_zip.replace(/\D/g, ""),
        cartTotalCents: Math.round(input.cart_total * 100), items: input.items }),
      originZip, packages: input.packages ?? [], neighborhood: normalize(input.destination_neighborhood ?? ""),
      city: normalize(input.destination_city ?? ""), state: input.destination_state,
      carrierEnabled: merchant.melhorEnvioEnabled, merchantRevision: merchant.updatedAt, ownDelivery,
      freeShipping: [rules?.allowFreeShipping ?? false, rules?.freeShippingMinCartValue ?? null],
    })).digest("hex");
    return { key, rules, ownDelivery, originZip, carrierEnabled: merchant.melhorEnvioEnabled };
  }

  private async calculate(input: Omit<QuoteShippingInput, "session_id">, config: Awaited<ReturnType<QuoteShippingUseCase["configuration"]>>): Promise<ShippingQuoteResult[]> {
    const packages = input.packages ?? [];
    const validPackages = packages.length > 0 && packages.every(p =>
      [p.weightKg, p.heightCm, p.widthCm, p.lengthCm].every(value => typeof value === "number" && Number.isFinite(value) && value > 0) &&
      Number.isSafeInteger(p.quantity) && p.quantity > 0);
    const carriers = config.carrierEnabled && validPackages && config.originZip.length === 8
      ? this.carriers.filter(carrier => carrier.carrierKey !== "flat-rate") : [];
    const responses = await Promise.allSettled(carriers.map(carrier => carrier.fetchQuotes({
      merchantId: input.merchant_id, originZip: config.originZip,
      destinationZip: input.destination_zip.replace(/\D/g, ""), packages,
      cartTotalCents: Math.round(input.cart_total * 100),
    })));
    const results: ShippingQuoteResult[] = [];
    responses.forEach((response, index) => {
      if (response.status === "fulfilled") {
        results.push(...response.value.filter(result => !/estimate|local_pickup/.test(result.carrier_key))
          .map(result => ({ ...result, source: "melhor_envio" as const, real_cost: result.price })));
      } else {
        this.logger.warn("carrier.quote.failed", { merchantId: input.merchant_id, carrier: carriers[index]?.carrierKey });
      }
    });
    const paid = dedupeQuoteResults(results);
    const final = config.rules?.allowFreeShipping
      ? mergeFreeShipping(paid, applyFreeShippingPolicy(paid, input.cart_total, {
          enabled: true, min_cart_total: config.rules.freeShippingMinCartValue ?? Infinity,
        })) : paid;
    return dedupeQuoteResults(await this.appendOwnDeliveryOptions(final, { ...input, session_id: "", origin_zip: config.originZip }, config.ownDelivery));
  }

  private async assertGenericCheckout(input: QuoteShippingInput): Promise<void> {
    if (!this.prisma) throw new ConflictException("marketplace_checkout_scope_unavailable");
    if (await hasMarketplaceCheckout(this.prisma, { merchantId: input.merchant_id, sessionId: input.session_id })) {
      throw new ConflictException("marketplace_shipping_selection_required");
    }
    const session = await this.prisma.checkoutSession.findUnique({
      where: { merchantId_sessionId: { merchantId: input.merchant_id, sessionId: input.session_id } }, select: { cart: true },
    });
    if (await hasPreparedCheckoutPayment(this.prisma, { merchantId: input.merchant_id, sessionId: input.session_id })) {
      throw new ConflictException("shipping_change_requires_payment_cancellation");
    }
    const cart = session?.cart as unknown as Cart | undefined;
    if (Array.isArray(cart?.items) && !requiresPhysicalDelivery(cart)) throw new BadRequestException("checkout_shipping_not_required");
  }

  private async appendOwnDeliveryOptions(
    currentResults: ShippingQuoteResult[],
    input: QuoteShippingInput,
    savedConfig?: Awaited<ReturnType<OwnDeliveryConfigRepository["getByMerchantId"]>>
  ): Promise<ShippingQuoteResult[]> {
    if (!this.ownDeliveryConfig) return currentResults;

    try {
      const config = savedConfig ?? await this.ownDeliveryConfig.getByMerchantId(input.merchant_id);
      if (!config?.enabled) return currentResults;

      const ownDeliveryOptions: ShippingQuoteResult[] = [];

      let destinationNeighborhood = input.destination_neighborhood;
      if (config.mode === "flat") {
        const [origin, destination] = await Promise.all([
          lookupAddressByViaCep(input.origin_zip ?? ""), lookupAddressByViaCep(input.destination_zip),
        ]);
        if (!origin?.city || !destination?.city || !origin.state || !destination.state ||
          normalize(origin.city) !== normalize(destination.city) || origin.state !== destination.state) return currentResults;
        destinationNeighborhood = destination.neighborhood || destinationNeighborhood;
      }
      if (config.mode === "flat" && config.flatPriceCents !== null) {
        const cartTotalCents = Math.round(input.cart_total * 100);
        const isFree = config.freeAboveCents !== null && cartTotalCents >= config.freeAboveCents;
        const etaDays = convertToEtaDays(config.estimatedValue, config.estimatedUnit);

        ownDeliveryOptions.push({
          carrier_key: "own_delivery_flat",
          label: "Entrega própria",
          price: isFree ? 0 : config.flatPriceCents,
          real_cost: config.flatPriceCents,
          eta_days: etaDays,
          is_free: isFree
        });
      } else if (config.mode === "neighborhood") {
        const origin = await this.ownDeliveryConfig.getNeighborhoodOrigin?.(input.merchant_id);
        if (origin?.kind === "ready") ownDeliveryOptions.push(...quoteManualDelivery(config, {
          cartTotalCents: Math.round(input.cart_total * 100), neighborhood: destinationNeighborhood,
          origin: origin.origin, destinationCity: input.destination_city, destinationState: input.destination_state,
        }));
      } else if (config.mode === "radius" && config.radiusZones && config.radiusZones.length > 0) {
        // Radius mode: compute distance (origin → destination CEP) and pick the
        // matching zone price. Requires origin_zip + destination_zip to geocode.
        const cartTotalCents = Math.round(input.cart_total * 100);
        const etaDays = convertToEtaDays(config.estimatedValue, config.estimatedUnit);
        const isFree = config.freeAboveCents !== null && cartTotalCents >= config.freeAboveCents;

        const priceCents = await this.computeRadiusPrice(
          input.origin_zip ?? "",
          input.destination_zip,
          config.radiusZones
        );

        if (priceCents !== null) {
          ownDeliveryOptions.push({
            carrier_key: "own_delivery_radius",
            label: "Entrega própria",
            price: isFree ? 0 : priceCents,
            real_cost: priceCents,
            eta_days: etaDays,
            is_free: isFree
          });
        }
        // If priceCents is null, destination is out of delivery range — no option added
      }

      return [...currentResults, ...ownDeliveryOptions.map(option => ({
        ...option, source: "own_delivery" as const, currency: "BRL",
        real_cost: option.real_cost ?? option.original_price ?? option.price, is_free: option.price === 0,
        estimated_value: config.estimatedValue, estimated_unit: config.estimatedUnit,
      }))];
    } catch (err) {
      this.logger.warn("own-delivery.append.failed", {
        merchantId: input.merchant_id,
        error: err instanceof Error ? err.message : String(err)
      });
      return currentResults;
    }
  }

  private async computeRadiusPrice(
    originZip: string,
    destinationZip: string,
    zones: OwnDeliveryRadiusZone[]
  ): Promise<number | null> {
    const [origin, dest] = await Promise.all([geocodeBrazilianCep(originZip), geocodeBrazilianCep(destinationZip)]);
    if (!origin || !dest) {
      this.logger.warn("radius.geocode.failed", { originZip, destinationZip });
      return null;
    }
    const distanceKm = haversineDistance(origin.lat, origin.lng, dest.lat, dest.lng);
    return getPriceForDistance(distanceKm, zones);
  }
}

/**
 * Convert estimatedValue and estimatedUnit to eta_days.
 * minutes → eta_days = Math.ceil(value / 1440)
 * days → eta_days = value
 */
function convertToEtaDays(estimatedValue: number, estimatedUnit: "minutes" | "days"): number {
  if (estimatedUnit === "days") {
    return estimatedValue;
  }
  // minutes
  return Math.ceil(estimatedValue / 1440);
}

/**
 * Merge the paid quote set with the free-shipping policy output so each
 * carrier_key appears exactly once. When both a paid and a free variant exist
 * for the same carrier, the free (cheaper) one wins and replaces the paid one.
 * Free entries with no paid counterpart (distinct promos) are kept as-is.
 */
function mergeFreeShipping(
  paid: ShippingQuoteResult[],
  freeVariants: ShippingQuoteResult[]
): ShippingQuoteResult[] {
  const byCarrier = new Map<string, ShippingQuoteResult>();
  for (const r of paid) {
    byCarrier.set(r.carrier_key, r);
  }
  for (const r of freeVariants) {
    if (!r.is_free) continue;
    const existing = byCarrier.get(r.carrier_key);
    // Replace the paid entry with the free one (free is cheaper); for a
    // brand-new free carrier_key this just inserts it.
    if (!existing || !existing.is_free || r.price < existing.price) {
      byCarrier.set(r.carrier_key, r);
    }
  }
  return [...byCarrier.values()].sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    if (a.eta_days !== b.eta_days) return a.eta_days - b.eta_days;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}

function dedupeQuoteResults(results: ShippingQuoteResult[]): ShippingQuoteResult[] {
  const seen = new Set<string>();
  const deduped: ShippingQuoteResult[] = [];
  for (const result of results) {
    const key = normalize(result.carrier_key);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped.sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    if (a.eta_days !== b.eta_days) return a.eta_days - b.eta_days;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
