import { Injectable, Inject, Optional, Logger, BadRequestException } from "@nestjs/common";
import { buildQuoteKey } from "@zyon/shipping-engine";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { ShippingQuoteEntity, type ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";
import { SHIPPING_QUOTE_REPOSITORY, type ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";
import { CARRIER_ADAPTERS, SHIPPING_REFERENCE_CARRIERS, type CarrierPort } from "../../domain/ports/carrier.port.js";
import { z } from "zod";
import { OWN_DELIVERY_CONFIG_REPOSITORY, type OwnDeliveryConfigRepository } from "../../domain/ports/own-delivery-config.port.js";
import { applyFreeShippingPolicy } from "../../domain/policies/free-shipping.policy.js";
import type { PackageDimensions, CheckoutSession, ShippingQuote } from "@zyon/shared-types";
import {
  MERCHANT_RULES_REPOSITORY,
  type MerchantRulesRepository
} from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { geocodeBrazilianCep, haversineDistance, getPriceForDistance } from "../../domain/services/distance-calculator.service.js";
import type { OwnDeliveryConfig, OwnDeliveryRadiusZone } from "../../domain/ports/own-delivery-config.port.js";
import { manualDeliveryConfigSchema, normalizeDeliveryNeighborhood, quoteManualDelivery } from "../../domain/services/manual-delivery-quote.js";
import type { NeighborhoodDeliveryOrigin } from "../../domain/services/neighborhood-delivery-origin.js";
import { evaluateSelectedNeighborhoodDelivery } from "../../domain/services/selected-neighborhood-delivery.js";

export interface QuoteShippingInput {
  session_id: string;
  merchant_id: string;
  destination_zip: string;
  /** Owned session address only, and only when its CEP matches destination_zip.
   * Never forward a raw request/model neighborhood as pricing authority. */
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
export function shippingReferenceConfigurationHash(manual: unknown, originZip: string, origin?: NeighborhoodDeliveryOrigin): string {
  const neighborhood = manual && typeof manual === "object" && Reflect.get(manual, "enabled") === true && Reflect.get(manual, "mode") === "neighborhood";
  return createHash("sha256").update(canonicalJson({ namespace: "storefront-reference-v1", manual, originZip,
    ...(neighborhood ? { origin: origin ?? null } : {}) })).digest("hex");
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
  price: z.number().int().min(0).max(2_147_483_647), eta_days: z.number().int().min(0).max(3650), is_free: z.literal(false) })).max(100);

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
    @Optional() @Inject(SHIPPING_REFERENCE_CARRIERS) private readonly referenceCarriers?: CarrierPort[]
  ) {}

  /** Locality gate only, not quote/payment authority. Only an identified
   * neighborhood selection is constrained; an unselected session or another
   * carrier is never rejected just because neighborhood mode is configured. */
  async assertNeighborhoodDestination(session: CheckoutSession, selected: ShippingQuote | null = session.shipping ?? null): Promise<void> {
    if (!selected || selected.carrier !== "Entrega" && !selected.carrier?.startsWith("own_delivery_neighborhood_")) return;
    const source = await this.quotes.findBySession(session.sessionId, session.merchantId);
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
    const manual = raw == null ? null : manualDeliveryConfigSchema.parse(raw);
    if (manual && manual.merchantId !== input.merchant_id) throw new Error("shipping_manual_config_scope_mismatch");
    const entity = ShippingQuoteEntity.create({ session_id: input.session_id, merchant_id: input.merchant_id, destination_zip: input.destination_zip });
    const snapshot = entity.snapshot();
    const result: ShippingReferenceSnapshot = { referenceOnly: true, id: snapshot.id, expiresAt: snapshot.expires_at,
      basisHash: input.basisHash, configurationHash: input.configurationHash, results: [] };
    const refuse = (reason: NonNullable<ShippingReferenceSnapshot["reason"]>) => ({ ...result, reason });
    const originResult = manual?.enabled && manual.mode === "neighborhood" ? await this.ownDeliveryConfig?.getNeighborhoodOrigin?.(input.merchant_id) : undefined;
    if (manual?.enabled && manual.mode === "neighborhood" && originResult?.kind !== "ready") return refuse("origin_address_configuration_required");
    const origin = originResult?.kind === "ready" ? originResult.origin : undefined;
    if (shippingReferenceConfigurationHash(manual, input.origin_zip ?? "", origin) !== input.configurationHash) return refuse("source_changed");
    if (manual?.enabled) {
      if (manual.mode === "neighborhood" && !input.destination_neighborhood) return refuse("address_required");
      if (manual.mode === "radius" && !/^\d{8}$/.test(input.origin_zip ?? "")) return refuse("origin_required");
      const tariffs = await this.appendOwnDeliveryOptions(input, manual, origin);
      // Configured free-above is a benefit candidate, not authorization. Show
      // only the raw configured tariff; do not invent or infer a carrier cost.
      result.results = tariffs.map(({ original_price, ...tariff }) => ({ ...tariff, price: original_price ?? tariff.price, is_free: false }));
      if (!result.results.length) return refuse("coverage_unavailable");
    } else {
      if (!/^\d{8}$/.test(input.origin_zip ?? "")) return refuse("origin_required");
      if (!input.packages?.length) return refuse("dimensions_required");
      const context = { merchantId: input.merchant_id, originZip: input.origin_zip!, destinationZip: input.destination_zip,
        cartTotalCents: Math.round(input.cart_total * 100), packages: input.packages };
      const settled = await Promise.allSettled((this.referenceCarriers ?? []).filter(carrier => carrier.carrierKey !== "flat-rate")
        .map(carrier => carrier.fetchQuotes(context)));
      result.results = dedupeQuoteResults(settled.flatMap(item => item.status === "fulfilled" ? item.value : []));
      if (!result.results.length) return refuse("carrier_unavailable");
    }
    result.results = referenceResults.parse(result.results);
    if (Date.parse(result.expiresAt) <= Date.now()) return { ...refuse("source_changed"), results: [] };
    return result;
  }

  async execute(unresolvedInput: QuoteShippingInput, resolveCanonicalPackages?: () => PackageDimensions[]) {
    // Read BEFORE cache: changed/disabled/foreign manual configuration must
    // never reuse a previously enabled mode or silently authorize a carrier.
    const rawManual = await this.ownDeliveryConfig?.getByMerchantId(unresolvedInput.merchant_id);
    const manual = rawManual == null ? null : manualDeliveryConfigSchema.parse(rawManual);
    if (manual && manual.merchantId !== unresolvedInput.merchant_id) throw new Error("shipping_manual_config_scope_mismatch");
    // Internal owned-session resolver, never an HTTP/body option. Resolve only
    // for a carrier, but BEFORE cache: a cached quote cannot hide newly missing
    // catalog dimensions. One config snapshot decides the branch; do not mutate
    // the caller or invent parcel measurements for this authenticated path.
    const input = !manual?.enabled && resolveCanonicalPackages
      ? { ...unresolvedInput, packages: resolveCanonicalPackages() }
      : unresolvedInput;
    const originResult = manual?.enabled && manual.mode === "neighborhood" ? await this.ownDeliveryConfig?.getNeighborhoodOrigin?.(input.merchant_id) : undefined;
    if (manual?.enabled && manual.mode === "neighborhood" && originResult?.kind !== "ready") throw new BadRequestException({
      code: "shipping_origin_address_configuration_required", message: "A loja precisa configurar o endereço da origem da entrega." });
    const origin = originResult?.kind === "ready" ? originResult.origin : undefined;
    const cartTotalCents = Math.round(input.cart_total * 100);
    const baseKey = buildQuoteKey({
      merchantId: input.merchant_id,
      destinationZip: input.destination_zip,
      cartTotalCents,
      items: input.items
    });

    // M1 fix: append merchant rules hash to quote key so that cache invalidates
    // when merchant updates free-shipping configuration.
    const rules = this.merchantRules
      ? await this.merchantRules.getRules(input.merchant_id)
      : null;
    const rulesHash = rules ? computeRulesHash(rules) : "none";
    const contextHash = createHash("sha256").update(canonicalJson({ manual,
      neighborhood: normalizeDeliveryNeighborhood(input.destination_neighborhood ?? ""), originZip: input.origin_zip ?? "",
      ...(manual?.enabled && manual.mode === "neighborhood" ? { origin, city: input.destination_city ?? null, state: input.destination_state ?? null } : {}),
      packages: input.packages ?? null })).digest("hex");
    const quoteKey = `${baseKey}:rules:${rulesHash}:live-first-v2:context:${contextHash}`;

    const reusable = await this.quotes.findValidByKey(quoteKey, input.merchant_id);
    if (reusable) {
      // C2 fix (session_id leak): do NOT rebind session_id on quote reuse.
      // If the quote belongs to a different session, it is stale in the current
      // session context and should not be reused. Validate session_id matches;
      // if not, fall through to generate a fresh quote.
      const snap = reusable.snapshot();
      if (snap.session_id === input.session_id) {
        return snap; // Same session; safe to reuse
      }
      // Quote belongs to a different session; ignore cache and create fresh
    }

    if (manual?.enabled) {
      const results = await this.appendOwnDeliveryOptions(input, manual, origin);
      const ownedQuote = ShippingQuoteEntity.create({ session_id: input.session_id, merchant_id: input.merchant_id,
        destination_zip: input.destination_zip, quote_key: quoteKey }).addResults(results).recordCreated();
      await this.quotes.saveWithEvents(ownedQuote);
      return ownedQuote.snapshot();
    }

    let quote = ShippingQuoteEntity.create({
      session_id: input.session_id,
      merchant_id: input.merchant_id,
      destination_zip: input.destination_zip,
      quote_key: quoteKey
    });

    // Ensure packages is never empty — carriers reject empty arrays.
    // Use a sensible default (small box, 0.5kg) when caller omits dimensions.
    const packages = input.packages && input.packages.length > 0
      ? input.packages
      : [{ weightKg: 0.5, heightCm: 10, widthCm: 15, lengthCm: 20, quantity: 1 }];

    const ctx = {
      originZip: input.origin_zip ?? "",
      destinationZip: input.destination_zip,
      cartTotalCents,
      merchantId: input.merchant_id,
      packages,
    };
    const allResults = await Promise.allSettled(
      this.carriers.map((c) => c.fetchQuotes(ctx))
    );

    const liveResults: ShippingQuoteResult[] = [];
    const fallbackResults: ShippingQuoteResult[] = [];

    for (let i = 0; i < allResults.length; i++) {
      const res = allResults[i];
      const carrier = this.carriers[i];
      if (res.status === "fulfilled" && res.value.length > 0) {
        if (carrier.carrierKey === "flat-rate") {
          fallbackResults.push(...res.value);
        } else {
          liveResults.push(...res.value);
        }
      }
      // P3 fix: log carrier failures (rejected promises) so they are visible
      // in server logs rather than silently discarded.
      if (res.status === "rejected") {
        this.logger.warn("carrier.quote.failed", {
          carrier: carrier.carrierKey,
          merchantId: input.merchant_id,
          error: res.reason instanceof Error ? res.reason.message : String(res.reason),
        });
      }
    }

    // Estimates are a fallback for a failed/unconfigured carrier integration,
    // never competing delivery services when a real quote is available.
    const resultsToAdd = dedupeQuoteResults(liveResults.length ? liveResults : fallbackResults);
    quote = quote.addResults(resultsToAdd);

    // P0 fix: always derive the free-shipping threshold from merchant rules,
    // never from the caller-supplied input field (which would let a client
    // bypass the shipping-engine subsidy invariant).
    // Note: `rules` already fetched above (M1 fix) — reuse cached result.
    const freeShippingEnabled = rules?.allowFreeShipping ?? false;
    const freeThreshold = rules?.freeShippingMinCartValue ?? Infinity;

    // BUG 1 fix: applyFreeShippingPolicy returns the SAME carriers re-priced to
    // R$0.00. Appending those onto the existing paid entries produced two rows
    // per carrier (priced + free) in the widget. Instead, merge by carrier_key
    // keeping exactly one entry per carrier — the free variant replaces the
    // paid one when free shipping applies. A distinct promo entry (a free
    // carrier_key that has no paid counterpart) is kept as its own single row.
    const currentResults = quote.snapshot().results;
    const finalResults = freeShippingEnabled
      ? mergeFreeShipping(
          currentResults,
          applyFreeShippingPolicy(currentResults, input.cart_total, {
            enabled: true,
            min_cart_total: freeThreshold
          })
        )
      : currentResults;

    // Only return delivery methods configured by the merchant or quoted by a carrier.
    const withFreeShipping = ShippingQuoteEntity.create({
      session_id: input.session_id,
      merchant_id: input.merchant_id,
      destination_zip: input.destination_zip,
      quote_key: quoteKey
    }).addResults(finalResults);

    const finalQuote = withFreeShipping.recordCreated();
    await this.quotes.saveWithEvents(finalQuote);
    return finalQuote.snapshot();
  }

  private async appendOwnDeliveryOptions(
    input: QuoteShippingInput,
    config: OwnDeliveryConfig,
    origin?: NeighborhoodDeliveryOrigin
  ): Promise<ShippingQuoteResult[]> {
    const radiusPriceCents = config.mode === "radius"
      ? await this.computeRadiusPrice(input.origin_zip ?? "", input.destination_zip, config.radiusZones!) : null;
    return quoteManualDelivery(config, { cartTotalCents: Math.round(input.cart_total * 100),
      neighborhood: input.destination_neighborhood, radiusPriceCents, origin,
      destinationCity: input.destination_city, destinationState: input.destination_state });
  }

  private async computeRadiusPrice(
    originZip: string,
    destinationZip: string,
    zones: OwnDeliveryRadiusZone[]
  ): Promise<number | null> {
    const origin = await geocodeBrazilianCep(originZip);
    const dest = await geocodeBrazilianCep(destinationZip);
    const validCoordinates = (point: { lat: number; lng: number } | null): point is { lat: number; lng: number } => point !== null
      && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
    if (!validCoordinates(origin) || !validCoordinates(dest)) {
      this.logger.warn("radius.geocode.failed", { originZip, destinationZip });
      return null;
    }
    const distanceKm = haversineDistance(origin.lat, origin.lng, dest.lat, dest.lng);
    return getPriceForDistance(distanceKm, zones);
  }
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
    const key = `${normalize(result.carrier_key)}:${normalize(result.label)}`;
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

/**
 * M1: Simple deterministic hash from merchant rules relevant to shipping.
 * Used to bust quote cache when merchant changes free-shipping config.
 */
function computeRulesHash(rules: { allowFreeShipping?: boolean; freeShippingMinCartValue?: number }): string {
  const enabled = rules.allowFreeShipping ? "1" : "0";
  const threshold = rules.freeShippingMinCartValue ?? 0;
  return `${enabled}:${threshold}`;
}
