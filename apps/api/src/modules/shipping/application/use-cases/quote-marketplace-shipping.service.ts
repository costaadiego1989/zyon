import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Cart, CustomerHints } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { MelhorEnvioCarrierAdapter } from "../../infrastructure/adapters/melhor-envio.carrier.js";
import { ShippingQuoteEntity, type ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";
import { createShippingEventEnvelope } from "../../domain/events/shipping-domain-event.js";
import { assertMarketplaceShippingSelection, marketplaceShippingOrigins, type MarketplaceShippingSelection } from
  "../../../marketplace/infrastructure/repositories/marketplace-shipping-selection.js";
import { marketplaceShippingContractHash } from "../../domain/marketplace-shipping-contract.js";
import { assertCarrierQuote } from "../../domain/marketplace-shipment-journal.js";

type Scope = { merchantId: string; sessionId: string };
const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Internal, carrier-backed quotes. No public marketplace admission is enabled.
 * The browser selects IDs; origins, packages and money are read server-side. */
@Injectable()
export class QuoteMarketplaceShippingService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(MelhorEnvioCarrierAdapter) private readonly carrier: Pick<MelhorEnvioCarrierAdapter, "fetchQuotes">) {}

  async quote(scope: Scope) {
    const initial = await this.load(this.prisma, scope);
    const source = await marketplaceShippingOrigins(this.prisma, initial);
    // Only the live carrier participates. Flat-rate estimates, implicit pickup,
    // default dimensions and another merchant's account cannot create a quote.
    const responses: Array<{ origin: Awaited<ReturnType<typeof marketplaceShippingOrigins>>["origins"][number]; quote: ShippingQuoteEntity }> = [];
    for (const origin of source.origins) {
      let results: ShippingQuoteResult[];
      try { results = await this.carrier.fetchQuotes(origin, { requireMerchantAccount: true }); }
      catch { throw new ConflictException("marketplace_shipping_carrier_unavailable"); }
      if (!Array.isArray(results) || !results.length || results.some(row => row.currency !== "BRL" || !/^melhor-envio-\d+$/.test(row.carrier_key) ||
          !row.label?.trim() || !Number.isSafeInteger(row.price) || row.price < 0 || row.price > 2_147_483_647 ||
          !Number.isSafeInteger(row.eta_days) || row.eta_days < 0) ||
          new Set(results.map(row => row.carrier_key)).size !== results.length) {
        throw new ConflictException("marketplace_shipping_carrier_unavailable");
      }
      // A numeric estimate cannot authorize a capture whose frozen packages
      // cannot later be purchased exactly. Ordinary shipping quotes are unaffected.
      results = results.filter(result => {
        if (result.price <= 0 || !/^melhor-envio-(1|2|17)$/.test(result.carrier_key) || !result.marketplaceCarrierQuote) return false;
        try {
          assertCarrierQuote(result.marketplaceCarrierQuote, marketplaceShippingContractHash(result.marketplaceCarrierQuote),
            origin.shipmentContract, Number(result.carrier_key.slice("melhor-envio-".length)), result.price);
          return true;
        } catch { return false; }
      });
      if (!results.length) throw new ConflictException("marketplace_shipping_carrier_unavailable");
      responses.push({ origin, quote: ShippingQuoteEntity.create({ merchant_id: scope.merchantId, session_id: origin.sessionId,
        destination_zip: origin.destinationZip, quote_key: origin.quoteKey, ttl_seconds: 600 })
        .addResults(results.map(result => ({ ...result, marketplaceShipmentContract: origin.shipmentContract }))).recordCreated() });
    }
    return this.prisma.$transaction(async tx => {
      const current = await this.lockMutable(tx, scope);
      const latest = await marketplaceShippingOrigins(tx, current);
      if (JSON.stringify(latest) !== JSON.stringify(source)) throw new ConflictException("marketplace_shipping_checkout_changed");
      for (const { quote } of responses) {
        const s = quote.snapshot();
        await tx.shippingQuote.create({ data: { id: s.id, merchantId: scope.merchantId, sessionId: s.session_id,
          destinationZip: s.destination_zip, quoteKey: s.quote_key, results: json(s.results),
          createdAt: new Date(s.created_at), expiresAt: new Date(s.expires_at) } });
        for (const event of quote.pullEvents()) await this.saveEvent(tx, event);
      }
      return { destinationZip: source.destinationZip, origins: responses.map(({ origin, quote }) => ({
        merchantId: origin.merchantId, quoteId: quote.id, results: quote.snapshot().results, expiresAt: quote.snapshot().expires_at })) };
    });
  }

  async select(input: Scope & { selections: Array<{ merchantId: string; quoteId: string; carrierKey: string }> }) {
    if (!Array.isArray(input.selections) || input.selections.length > 100 || input.selections.some(row =>
        !row || !row.merchantId || !row.quoteId || !row.carrierKey) ||
        new Set(input.selections.map(row => row.merchantId)).size !== input.selections.length ||
        new Set(input.selections.map(row => row.quoteId)).size !== input.selections.length) {
      throw new ConflictException("marketplace_shipping_selection_mismatch");
    }
    return this.prisma.$transaction(async tx => {
      const current = await this.lockMutable(tx, input);
      const { origins, destinationZip } = await marketplaceShippingOrigins(tx, current);
      if (input.selections.length !== origins.length) throw new ConflictException("marketplace_shipping_selection_mismatch");
      const shipping: MarketplaceShippingSelection = { customerPrice: 0, realCost: 0, carrier: "marketplace",
        method: "Entrega por vendedor", destinationZip, marketplace: { version: 1, quotes: [] } };
      for (const origin of origins) {
        const choice = input.selections.find(row => row.merchantId === origin.merchantId);
        if (!choice) throw new ConflictException("marketplace_shipping_selection_mismatch");
        const row = await tx.shippingQuote.findFirst({ where: { id: choice.quoteId, merchantId: input.merchantId, sessionId: origin.sessionId } });
        if (!row || row.quoteKey !== origin.quoteKey || row.expiresAt <= new Date() || !Array.isArray(row.results)) {
          throw new ConflictException("marketplace_shipping_quote_invalid");
        }
        const result = (row.results as unknown as ShippingQuoteResult[]).find(value => value.carrier_key === choice.carrierKey);
        if (!result) throw new ConflictException("marketplace_shipping_quote_invalid");
        shipping.marketplace.quotes.push({ merchantId: origin.merchantId, quoteId: row.id, quoteKey: row.quoteKey,
          carrierKey: choice.carrierKey, amountCents: result.price,
          ...(result.marketplaceCarrierQuote ? { carrierQuoteHash: marketplaceShippingContractHash(result.marketplaceCarrierQuote) } : {}) });
        await tx.shippingQuote.update({ where: { id: row.id }, data: { selectedCarrierKey: choice.carrierKey } });
      }
      shipping.customerPrice = shipping.marketplace.quotes.reduce((sum, row) => sum + row.amountCents, 0) / 100;
      shipping.realCost = shipping.customerPrice;
      const validated = await assertMarketplaceShippingSelection(tx, { ...current, shipping });
      shipping.deliveryDays = validated.deliveryDays;
      await tx.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: input.merchantId, sessionId: input.sessionId } },
        data: { shipping: json(shipping), updatedAt: new Date() } });
      await this.saveEvent(tx, createShippingEventEnvelope({ eventType: "shipping.method.selected", merchantId: input.merchantId,
        payload: { session_id: input.sessionId, marketplace: true, origin_count: origins.length,
          price: validated.totalCents, quote_ids: validated.quotes.map(row => row.quoteId) } }));
      return shipping;
    });
  }

  private async load(db: Prisma.TransactionClient, scope: Scope) {
    if (!scope.merchantId?.trim() || !scope.sessionId?.trim()) throw new NotFoundException("marketplace_shipping_checkout_missing");
    const row = await db.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.sessionId } } });
    if (!row || row.merchantId !== scope.merchantId || row.sessionId !== scope.sessionId) throw new NotFoundException("marketplace_shipping_checkout_missing");
    return { merchantId: scope.merchantId, sessionId: scope.sessionId, cart: row.cart as unknown as Cart, customer: row.customer as unknown as CustomerHints,
      shipping: row.shipping };
  }

  private async lockMutable(tx: Prisma.TransactionClient, scope: Scope) {
    await tx.$queryRaw`SELECT session_id FROM checkout_sessions WHERE merchant_id = ${scope.merchantId} AND session_id = ${scope.sessionId} FOR UPDATE`;
    const current = await this.load(tx, scope), cartRef = (current.cart as Cart & { cart_ref?: string }).cart_ref ?? scope.sessionId;
    if (await tx.paymentIntent.findFirst({ where: { merchantId: scope.merchantId, sessionId: scope.sessionId } }) ||
        await tx.marketplaceFundingPlan.findFirst({ where: { hostMerchantId: scope.merchantId, checkoutSessionId: cartRef } })) {
      throw new ConflictException("marketplace_shipping_payment_already_started");
    }
    return current;
  }

  private async saveEvent(tx: Prisma.TransactionClient, event: ReturnType<typeof createShippingEventEnvelope>) {
    await tx.outboxMessage.create({ data: { eventId: event.event_id, eventType: event.event_type, schemaVersion: event.schema_version,
      merchantId: event.merchant_id, occurredAt: new Date(event.occurred_at), correlationId: event.correlation_id,
      causationId: event.causation_id, producer: event.producer, payload: json(event.payload) } });
  }
}
