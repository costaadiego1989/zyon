import { Injectable, Inject, Optional , Logger} from "@nestjs/common";
import { buildQuoteKey } from "@zyon/shipping-engine";
import { ShippingQuoteEntity, type ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";
import { SHIPPING_QUOTE_REPOSITORY, type ShippingQuoteRepository } from "../../domain/ports/shipping-quote-repository.port.js";
import { CARRIER_ADAPTERS, type CarrierPort } from "../../domain/ports/carrier.port.js";
import { applyFreeShippingPolicy } from "../../domain/policies/free-shipping.policy.js";
import type { PackageDimensions } from "@zyon/shared-types";
import {
  MERCHANT_RULES_REPOSITORY,
  type MerchantRulesRepository
} from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface QuoteShippingInput {
  session_id: string;
  merchant_id: string;
  destination_zip: string;
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
    private readonly merchantRules?: MerchantRulesRepository
  ) {}

  async execute(input: QuoteShippingInput) {
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
    const quoteKey = `${baseKey}:rules:${rulesHash}`;

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

    let quote = ShippingQuoteEntity.create({
      session_id: input.session_id,
      merchant_id: input.merchant_id,
      destination_zip: input.destination_zip,
      quote_key: quoteKey
    });

    const ctx = {
      originZip: input.origin_zip ?? "",
      destinationZip: input.destination_zip,
      cartTotalCents,
      merchantId: input.merchant_id,
      packages: input.packages ?? [],
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

    const resultsToAdd = dedupeQuoteResults([...liveResults, ...fallbackResults]);
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
