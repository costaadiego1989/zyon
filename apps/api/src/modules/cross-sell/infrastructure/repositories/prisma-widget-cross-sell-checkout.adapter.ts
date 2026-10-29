import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { computeQuoteExpiry } from "@zyon/shipping-engine";
import { createCrossSellEventEnvelope, widgetCrossSellCheckoutAcceptancePayload } from "../../domain/events/cross-sell-domain-event.js";
import type { Cart } from "@zyon/shared-types";
import { checkoutAddressRegistrationSchema, checkoutExplicitAddressSchema } from "../../../checkout/domain/services/checkout-explicit-address.schema.js";
import { manualDeliveryConfigSchema, quoteManualDelivery } from "../../../shipping/domain/services/manual-delivery-quote.js";
import { widgetCheckoutManualShippingSnapshotSchema } from "../../domain/contracts/widget-cross-sell-checkout-shipping.schemas.js";
import { verifyCheckoutEmailOtp } from "../../../checkout/domain/services/checkout-email-otp.js";
import type { CheckoutEmailOtpDeliveryPort } from "../../../checkout/domain/ports/checkout-email-otp-delivery.port.js";
import { checkoutEmailOtpIssueRequestSchema, checkoutEmailOtpDeliveryRequestSchema,
  checkoutEmailOtpDeliveryCompletionSchema } from "../../../checkout/domain/services/checkout-email-otp-delivery.schemas.js";
import { widgetCrossSellCheckoutScopeSchema, widgetCrossSellCheckoutQuoteRequestSchema, widgetCrossSellCheckoutAcceptanceSchema,
  widgetCrossSellCheckoutReceiptSchema, widgetCrossSellCheckoutAcknowledgementSchema,
  widgetCrossSellCheckoutCustomerCommandSchema, widgetCrossSellCheckoutCustomerAcknowledgementSchema,
  widgetCrossSellCheckoutAddressCommandSchema,
  widgetCrossSellCheckoutEmailOtpCommandSchema,
  widgetCrossSellCheckoutManualShippingCommandSchema,
  widgetCrossSellCheckoutManualShippingSelectionSchema,
  type WidgetCrossSellCheckoutScope, type WidgetCrossSellCheckoutQuoteRequest } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";
import { prepareWidgetCrossSellCheckoutQuote, widgetCrossSellCheckoutQuoteMatchesCurrent } from "../../domain/services/widget-cross-sell-checkout-quote.js";
import type { WidgetCrossSellCheckoutPort } from "../../domain/ports/widget-cross-sell-checkout.port.js";
import { storefrontOptionLineIdentity } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { lockAcceptedWidgetCheckout, prepareAcceptedWidgetCheckout } from "./widget-checkout-accepted-reader.js";
import { providerShippingEnvelopeSchema } from "../../domain/contracts/widget-checkout-provider-shipping.schemas.js";
import { readPrismaWidgetCrossSellCheckoutAuthority, requireWidgetCrossSellReview } from "./prisma-widget-cross-sell-checkout.authority.js";
import { widgetCheckoutRevisionContextHash, widgetCheckoutRevisionMetadata, widgetCheckoutRevisionEventName } from "./widget-cross-sell-checkout-revision.js";
import { widgetCheckoutShippingHash, widgetManualShippingConfigurationHash, prepareWidgetManualShippingSelection, readWidgetSelectedManualShipping } from "./widget-checkout-manual-shipping.js";
import { readNeighborhoodDeliveryOrigin } from "../../../shipping/infrastructure/repositories/neighborhood-delivery-origin.reader.js";
import { requestWidgetCheckoutEmailOtp, claimWidgetCheckoutEmailOtpDelivery, completeWidgetCheckoutEmailOtpDelivery,
  requireWidgetCheckoutEmailOtpAttemptForVerify, invalidatePendingWidgetCheckoutEmailOtpForChangedEmail } from "./widget-checkout-email-otp.js";

const transactionOptions = { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 } as const;
/** Not module/controller-wired: native SQL concurrency and public read/payment/
 * recovery provenance gates MUST pass before enabling this writer. No retries,
 * providers, legacy accept/save split or fabricated storefront cart identity. */
export class PrismaWidgetCrossSellCheckoutAdapter implements WidgetCrossSellCheckoutPort, CheckoutEmailOtpDeliveryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /** Actual DB trigger owns checkout version; never acknowledge an inferred
   * increment or a receipt that was not persisted by this exact scoped write. */
  private async confirmWrite(tx:Prisma.TransactionClient,scope:WidgetCrossSellCheckoutScope,
    before:{id:string;version:number;strategyContextVersion:number;globalUserId:string},
    expectedReceipt:z.infer<typeof widgetCrossSellCheckoutReceiptSchema>,buyerId=before.globalUserId){
    const actual=await tx.checkoutSession.findUnique({where:{merchantId_sessionId:scope}});
    const parsed=z.object({_widgetCrossSellAcceptance:widgetCrossSellCheckoutReceiptSchema}).safeParse(actual?.cart);
    if(!actual||actual.id!==before.id||actual.merchantId!==scope.merchantId||actual.sessionId!==scope.sessionId
      ||actual.globalUserId!==buyerId||actual.version!==before.version+1||actual.strategyContextVersion!==before.strategyContextVersion
      ||!parsed.success||!isDeepStrictEqual(parsed.data._widgetCrossSellAcceptance,expectedReceipt))return requireWidgetCrossSellReview();
    return actual.version;
  }

  private async lockSession(tx: Prisma.TransactionClient, scope: WidgetCrossSellCheckoutScope, lockManualConfig = false) {
    await lockAcceptedWidgetCheckout(tx, scope, lockManualConfig);
  }

  private async prepare(tx: Prisma.TransactionClient, scope: WidgetCrossSellCheckoutScope, request: WidgetCrossSellCheckoutQuoteRequest) {
    await this.lockSession(tx, scope);
    await tx.$queryRaw`SELECT id FROM cross_sell_suggestions WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId}
      AND id=${request.suggestionId} FOR UPDATE`;
    const authority = await readPrismaWidgetCrossSellCheckoutAuthority(tx, scope, request);
    const quote = prepareWidgetCrossSellCheckoutQuote(authority.input);
    if (quote.kind !== "quote_candidate") return requireWidgetCrossSellReview();
    return { ...authority, quote };
  }

  async quote(rawScope: unknown, rawRequest: unknown) {
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope), request = widgetCrossSellCheckoutQuoteRequestSchema.parse(rawRequest);
    return this.prisma.$transaction(async tx => (await this.prepare(tx, scope, request)).quote, transactionOptions);
  }

  /** Internal, scope-only projection. No receipt/quote is accepted from callers;
   * generic mapper/forms/payment guards remain in place until full composition. */
  async readAccepted(rawScope: unknown): Promise<Cart> {
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope);
    return this.prisma.$transaction(async tx => (await this.prepareAccepted(tx, scope)).projectedCart, transactionOptions);
  }

  /** Private composition primitive: all canonical reads and any following write
   * share one transaction/fence. Never authorize a write from a prior read. */
  private async prepareAccepted(tx: Prisma.TransactionClient, scope: WidgetCrossSellCheckoutScope, lockManualConfig = false) {
    return prepareAcceptedWidgetCheckout(tx, scope, { lockManualConfig });
  }

  /** Do not erase an outstanding/uncertain supplier operation when editing a
   * buyer, issuing OTP or replacing shipping. Reading the cart remains allowed;
   * explicit technical recovery must settle the operation before another write. */
  private async prepareMutableAccepted(tx: Prisma.TransactionClient, scope: WidgetCrossSellCheckoutScope, lockManualConfig = false) {
    const current = await this.prepareAccepted(tx, scope, lockManualConfig);
    const raw = current.stored.shippingOptions;
    if (raw && typeof raw === "object" && "origin" in raw && raw.origin === "widget_checkout_provider") {
      const envelope = providerShippingEnvelopeSchema.safeParse(raw);
      if (!envelope.success || envelope.data.state !== "completed") return requireWidgetCrossSellReview();
    }
    return current;
  }

  /** Internal contact-only command. Not wired to public forms, OTP or providers.
   * The input cannot carry a cart/receipt or claim identity verification. */
  async updateCustomer(rawScope: unknown, rawRequest: unknown) {
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope);
    const request = widgetCrossSellCheckoutCustomerCommandSchema.parse(rawRequest);
    return this.prisma.$transaction(async tx => {
      const prepared = await this.prepareMutableAccepted(tx, scope), { stored, cart, receipt, quote } = prepared;
      if (stored.version !== request.expectedVersion || stored.version >= 2_147_483_647
        || stored.strategyContextVersion >= 2_147_483_647) return requireWidgetCrossSellReview();
      const previous = stored.customer ?? {};
      const customer: Record<string, unknown> & typeof request.customer = { ...previous, ...request.customer };
      const previousEmail = typeof previous.email === "string" ? previous.email.trim().toLowerCase() : "";
      const previousPhone = typeof previous.phone === "string" ? previous.phone.replace(/\D/g, "") : "";
      const previousCpf = typeof previous.cpf === "string" ? previous.cpf.replace(/\D/g, "") : "";
      const emailChanged = previousEmail !== customer.email, phoneChanged = previousPhone !== customer.phone;
      if (emailChanged) {
        await invalidatePendingWidgetCheckoutEmailOtpForChangedEmail(tx, scope, prepared);
        customer.email_verified = false; customer.address_verified = false;
        customer.recognized_buyer = false; customer.isReturning = false;
        for (const key of ["otp_code", "otp_expires_at", "otp_delivery_id", "otp_delivery_email", "otp_issued_at", "address", "deliveryAddressLabel"]) delete customer[key];
      }
      if (emailChanged || phoneChanged) {
        customer.phone_verified = false; delete customer.phone_otp_code;
      }
      // Provider customer records cache contact/CPF fields; changing any one
      // cannot silently reuse the previous PSP identity on a later payment.
      if (emailChanged || phoneChanged || previousCpf !== customer.cpf || previous.fullName !== customer.fullName) {
        delete customer.externalCustomerId; delete customer.asaasCustomerId;
      }
      const next = { ...stored, customer, globalUserId: emailChanged ? `usr_${randomUUID()}` : stored.globalUserId,
        shipping: emailChanged ? null : stored.shipping, shippingOptions: emailChanged ? null : stored.shippingOptions,
        strategyContextVersion: stored.strategyContextVersion };
      const nextReceipt = widgetCrossSellCheckoutReceiptSchema.parse({ ...receipt, revision: {
        eventId: randomUUID(), previousEventId: receipt.revision?.eventId ?? receipt.eventId,
        persistenceVersion: stored.version + 1, revisedAt: quote.quotedAt, contextHash: widgetCheckoutRevisionContextHash(next),
      } });
      const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, version: stored.version }, data: {
        customer: customer as Prisma.InputJsonObject, globalUserId: next.globalUserId,
        cart: { ...cart, _widgetCrossSellAcceptance: nextReceipt } as unknown as Prisma.InputJsonValue,
        ...(emailChanged ? { shipping: Prisma.DbNull, shippingOptions: Prisma.DbNull } : {}),
        updatedAt: new Date(quote.quotedAt),
      } });
      if (saved.count !== 1) return requireWidgetCrossSellReview();
      await this.confirmWrite(tx,scope,stored,nextReceipt,next.globalUserId);
      await tx.checkoutEvent.create({ data: { id: nextReceipt.revision!.eventId, ...scope,
        eventName: "cross_sell_checkout_customer_updated", occurredAt: new Date(quote.quotedAt), metadata: widgetCheckoutRevisionMetadata(nextReceipt) } });
      return widgetCrossSellCheckoutCustomerAcknowledgementSchema.parse({ version: 1, ...scope, status: "updated", persistenceVersion: stored.version + 1 });
    }, transactionOptions);
  }

  /** Complete explicit buyer submission, as in the existing address form.
   * address_verified means buyer confirmation, NOT a carrier or identity proof.
   * No provider, saved-address lookup, geocoding, generic save or public wiring. */
  async updateAddress(rawScope: unknown, rawRequest: unknown) {
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope);
    const request = widgetCrossSellCheckoutAddressCommandSchema.parse(rawRequest);
    return this.prisma.$transaction(async tx => {
      const { stored, cart, receipt, quote } = await this.prepareMutableAccepted(tx, scope);
      if (stored.version !== request.expectedVersion || stored.version >= 2_147_483_647
        || stored.strategyContextVersion >= 2_147_483_647) return requireWidgetCrossSellReview();
      if (!checkoutAddressRegistrationSchema.safeParse(stored.customer).success) return requireWidgetCrossSellReview();
      const customer: Record<string, unknown> = { ...stored.customer, address: request.address, address_verified: true };
      // A manually supplied address must not retain a different saved-address
      // label. Contact, identity and their existing server proofs are unchanged.
      delete customer.deliveryAddressLabel;
      const next = { ...stored, customer, shipping: null, shippingOptions: null,
        strategyContextVersion: stored.strategyContextVersion };
      const nextReceipt = widgetCrossSellCheckoutReceiptSchema.parse({ ...receipt, revision: {
        eventId: randomUUID(), previousEventId: receipt.revision?.eventId ?? receipt.eventId,
        persistenceVersion: stored.version + 1, revisedAt: quote.quotedAt,
        contextHash: widgetCheckoutRevisionContextHash(next), operation: "address",
      } });
      const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, version: stored.version }, data: {
        customer: customer as Prisma.InputJsonObject, shipping: Prisma.DbNull, shippingOptions: Prisma.DbNull,
        cart: { ...cart, _widgetCrossSellAcceptance: nextReceipt } as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(quote.quotedAt),
      } });
      if (saved.count !== 1) return requireWidgetCrossSellReview();
      await this.confirmWrite(tx,scope,stored,nextReceipt);
      await tx.checkoutEvent.create({ data: { id: nextReceipt.revision!.eventId, ...scope,
        eventName: widgetCheckoutRevisionEventName(nextReceipt), occurredAt: new Date(quote.quotedAt), metadata: widgetCheckoutRevisionMetadata(nextReceipt) } });
      return widgetCrossSellCheckoutCustomerAcknowledgementSchema.parse({ version: 1, ...scope, status: "updated", persistenceVersion: stored.version + 1 });
    }, transactionOptions);
  }

  /** Consume only an existing server-owned email challenge. No generation,
   * resend, delivery, buyer recognition, phone proof or public activation. */
  async verifyEmailOtp(rawScope: unknown, rawRequest: unknown) {
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope);
    const request = widgetCrossSellCheckoutEmailOtpCommandSchema.parse(rawRequest);
    return this.prisma.$transaction(async tx => {
      const prepared = await this.prepareMutableAccepted(tx, scope), { stored, cart, receipt, quote } = prepared;
      if (stored.version !== request.expectedVersion || stored.version >= 2_147_483_647
        || stored.strategyContextVersion >= 2_147_483_647) return requireWidgetCrossSellReview();
      const previous = stored.customer;
      await requireWidgetCheckoutEmailOtpAttemptForVerify(tx, scope, prepared);
      if (!previous || previous.email_verified === true || !z.email().max(254).safeParse(previous.email).success
        || verifyCheckoutEmailOtp({ code: request.code, challenge: previous.otp_code,
          expiresAt: previous.otp_expires_at, nowMilliseconds: Date.parse(quote.quotedAt) }) !== "verified") return requireWidgetCrossSellReview();
      const customer: Record<string, unknown> = { ...previous, email_verified: true, otp_code: "", otp_expires_at: "" };
      for (const key of ["otp_delivery_id", "otp_delivery_email", "otp_issued_at"]) delete customer[key];
      const next = { ...stored, customer };
      const nextReceipt = widgetCrossSellCheckoutReceiptSchema.parse({ ...receipt, revision: {
        eventId: randomUUID(), previousEventId: receipt.revision?.eventId ?? receipt.eventId,
        persistenceVersion: stored.version + 1, revisedAt: quote.quotedAt,
        contextHash: widgetCheckoutRevisionContextHash(next), operation: "email_otp",
      } });
      const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, version: stored.version }, data: {
        customer: customer as Prisma.InputJsonObject,
        cart: { ...cart, _widgetCrossSellAcceptance: nextReceipt } as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(quote.quotedAt),
      } });
      if (saved.count !== 1) return requireWidgetCrossSellReview();
      await this.confirmWrite(tx,scope,stored,nextReceipt);
      await tx.checkoutEvent.create({ data: { id: nextReceipt.revision!.eventId, ...scope,
        eventName: widgetCheckoutRevisionEventName(nextReceipt), occurredAt: new Date(quote.quotedAt), metadata: widgetCheckoutRevisionMetadata(nextReceipt) } });
      return widgetCrossSellCheckoutCustomerAcknowledgementSchema.parse({ version: 1, ...scope, status: "updated", persistenceVersion: stored.version + 1 });
    }, transactionOptions);
  }

  /** Internal OTP commands: orchestration may dispatch only after claim COMMIT.
   * No public DTO/provider/identity promotion is attached to these methods. */
  async requestEmailOtp(rawScope: unknown, rawRequest: unknown) {
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope), request = checkoutEmailOtpIssueRequestSchema.parse(rawRequest);
    return this.prisma.$transaction(async tx => requestWidgetCheckoutEmailOtp(tx, scope, request, await this.prepareMutableAccepted(tx, scope)), transactionOptions);
  }

  async claimEmailOtpDelivery(rawScope: unknown, rawRequest: unknown) {
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope), request = checkoutEmailOtpDeliveryRequestSchema.parse(rawRequest);
    return this.prisma.$transaction(async tx => claimWidgetCheckoutEmailOtpDelivery(tx, scope, request, await this.prepareMutableAccepted(tx, scope)), transactionOptions);
  }

  /** Settle only the scoped old send's journal, even after contact/price changes.
   * Never reauthorize a purchase, update customer proof or repeat an email. */
  async completeEmailOtpDelivery(rawScope: unknown, rawRequest: unknown) {
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope), request = checkoutEmailOtpDeliveryCompletionSchema.parse(rawRequest);
    return this.prisma.$transaction(async tx => {
      await this.lockSession(tx, scope);
      const raw = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope }, select: { merchantId: true, sessionId: true, version: true, cart: true } });
      const stored = widgetCrossSellCheckoutScopeSchema.extend({ version: z.number().int().min(1).max(2_147_483_647),
        cart: z.object({ _widgetCrossSellAcceptance: widgetCrossSellCheckoutReceiptSchema }) }).parse(raw);
      if (stored.merchantId !== scope.merchantId || stored.sessionId !== scope.sessionId) return requireWidgetCrossSellReview();
      const [clock] = z.array(z.object({ now: z.date() })).length(1).parse(await tx.$queryRaw`SELECT clock_timestamp() AS now`);
      return completeWidgetCheckoutEmailOtpDelivery(tx, scope, request, { stored, receipt: stored.cart._widgetCrossSellAcceptance, now: clock!.now });
    }, transactionOptions);
  }

  /** Internal network-free manual tariff quotation, NOT shipping selection or
   * subsidy/payment admission. Radius needs separately fenced geocoder evidence.
   * No client address/price/config, generic session save, nested tx or retry. */
  async quoteManualShipping(rawScope: unknown, rawRequest: unknown) {
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope);
    const request = widgetCrossSellCheckoutManualShippingCommandSchema.parse(rawRequest);
    return this.prisma.$transaction(async tx => {
      const { stored, cart, receipt, quote } = await this.prepareMutableAccepted(tx, scope, true);
      if (stored.version !== request.expectedVersion || stored.version >= 2_147_483_647
        || stored.strategyContextVersion >= 2_147_483_647 || stored.customer?.address_verified !== true) return requireWidgetCrossSellReview();
      const address = checkoutExplicitAddressSchema.safeParse(stored.customer.address);
      const config = manualDeliveryConfigSchema.safeParse(await tx.ownDeliveryConfig.findUnique({ where: { merchantId: scope.merchantId } }));
      if (!address.success || !config.success || config.data.merchantId !== scope.merchantId
        || !config.data.enabled || config.data.mode === "radius") return requireWidgetCrossSellReview();
      const originResult = config.data.mode === "neighborhood" ? await readNeighborhoodDeliveryOrigin(tx, scope.merchantId) : undefined;
      if (config.data.mode === "neighborhood" && originResult?.kind !== "ready") return requireWidgetCrossSellReview();
      const origin = originResult?.kind === "ready" ? originResult.origin : undefined;
      const shippingOptions = widgetCheckoutManualShippingSnapshotSchema.parse({
        version: 1, origin: "widget_checkout_manual", id: randomUUID(), ...scope, buyerId: stored.globalUserId,
        acceptanceEventId: receipt.eventId, issuedAt: quote.quotedAt, expiresAt: computeQuoteExpiry(new Date(quote.quotedAt)).toISOString(),
        basisHash: widgetCheckoutShippingHash({ acceptanceEventId: receipt.eventId, quote: receipt.quote }),
        destinationHash: widgetCheckoutShippingHash({ ...scope, buyerId: stored.globalUserId, address: address.data }), configHash: widgetManualShippingConfigurationHash(config.data, origin),
        options: quoteManualDelivery(config.data, { cartTotalCents: quote.totalCents, neighborhood: address.data.neighborhood,
          origin, destinationCity: address.data.city, destinationState: address.data.state }),
      });
      const next = { ...stored, shipping: null, shippingOptions };
      const nextReceipt = widgetCrossSellCheckoutReceiptSchema.parse({ ...receipt, revision: {
        eventId: randomUUID(), previousEventId: receipt.revision?.eventId ?? receipt.eventId,
        persistenceVersion: stored.version + 1, revisedAt: quote.quotedAt,
        contextHash: widgetCheckoutRevisionContextHash(next), operation: "manual_shipping_quote",
      } });
      const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, version: stored.version }, data: {
        shipping: Prisma.DbNull, shippingOptions: shippingOptions as Prisma.InputJsonValue,
        cart: { ...cart, _widgetCrossSellAcceptance: nextReceipt } as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(quote.quotedAt),
      } });
      if (saved.count !== 1) return requireWidgetCrossSellReview();
      await this.confirmWrite(tx,scope,stored,nextReceipt);
      await tx.checkoutEvent.create({ data: { id: nextReceipt.revision!.eventId, ...scope,
        eventName: widgetCheckoutRevisionEventName(nextReceipt), occurredAt: new Date(quote.quotedAt), metadata: widgetCheckoutRevisionMetadata(nextReceipt) } });
      return widgetCrossSellCheckoutCustomerAcknowledgementSchema.parse({ version: 1, ...scope, status: "updated", persistenceVersion: stored.version + 1 });
    }, transactionOptions);
  }

  async selectManualShipping(rawScope: unknown, rawRequest: unknown) {
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope), request = widgetCrossSellCheckoutManualShippingSelectionSchema.parse(rawRequest);
    return this.prisma.$transaction(async tx => {
      const current = await this.prepareMutableAccepted(tx, scope, true), { stored, cart, receipt, quote } = current;
      if (stored.version !== request.expectedVersion || stored.version >= 2_147_483_647
        || stored.strategyContextVersion >= 2_147_483_647) return requireWidgetCrossSellReview();
      const { storedShipping: shipping } = await prepareWidgetManualShippingSelection(tx, scope, current, request.quoteId, request.carrierKey);
      const next = { ...stored, shipping };
      const nextReceipt = widgetCrossSellCheckoutReceiptSchema.parse({ ...receipt, revision: {
        eventId: randomUUID(), previousEventId: receipt.revision?.eventId ?? receipt.eventId, persistenceVersion: stored.version + 1,
        revisedAt: quote.quotedAt, contextHash: widgetCheckoutRevisionContextHash(next), operation: "manual_shipping_select",
      } });
      const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, version: stored.version }, data: {
        shipping: shipping as Prisma.InputJsonValue, cart: { ...cart, _widgetCrossSellAcceptance: nextReceipt } as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(quote.quotedAt),
      } });
      if (saved.count !== 1) return requireWidgetCrossSellReview();
      await this.confirmWrite(tx,scope,stored,nextReceipt);
      await tx.checkoutEvent.create({ data: { id: nextReceipt.revision!.eventId, ...scope,
        eventName: widgetCheckoutRevisionEventName(nextReceipt), occurredAt: new Date(quote.quotedAt), metadata: widgetCheckoutRevisionMetadata(nextReceipt) } });
      return widgetCrossSellCheckoutCustomerAcknowledgementSchema.parse({ version: 1, ...scope, status: "updated", persistenceVersion: stored.version + 1 });
    }, transactionOptions);
  }

  /** Internal shipping-only read. A detached result is never payment authority. */
  async readAcceptedShipping(rawScope: unknown) {
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope);
    return this.prisma.$transaction(async tx => readWidgetSelectedManualShipping(tx, scope, await this.prepareAccepted(tx, scope, true)), transactionOptions);
  }

  async accept(rawScope: unknown, rawRequest: unknown) {
    // Parsing snapshots the request before the first await. Merchant/session
    // are always an authenticated outer scope, never inferred from quote JSON.
    const scope = widgetCrossSellCheckoutScopeSchema.parse(rawScope);
    const { expectedQuote } = widgetCrossSellCheckoutAcceptanceSchema.parse(rawRequest);
    if (scope.merchantId !== expectedQuote.merchantId || scope.sessionId !== expectedQuote.sessionId) return requireWidgetCrossSellReview();
    return this.prisma.$transaction(async tx => {
      const { quote, stored, cart, rows, baseItems } = await this.prepare(tx, scope, {
        suggestionId: expectedQuote.suggestionId, variantId: expectedQuote.target.variantId,
        quantity: expectedQuote.target.acceptedQuantity, selectedOptionItemIds: expectedQuote.target.selectedOptionItemIds,
      });
      if (!widgetCrossSellCheckoutQuoteMatchesCurrent(expectedQuote, quote)) return requireWidgetCrossSellReview();
      const payload = widgetCrossSellCheckoutAcceptancePayload(quote, stored.version + 1);
      const effectivePercent = payload.computed_discount;
      const event = createCrossSellEventEnvelope({ eventType: "cross-sell.offer.accepted", merchantId: scope.merchantId,
        causationId: quote.suggestionId, payload });
      event.occurred_at = quote.quotedAt;
      const receipt = widgetCrossSellCheckoutReceiptSchema.parse({ version: 1, origin: "widget_checkout", eventId: event.event_id,
        committedVersion: stored.version + 1, acceptedAt: quote.quotedAt, quote });
      const { discountBudget: _priorBudget, commercialNotices: _priorNotices, ...unquotedCart } = cart;
      const previousLines = new Map(baseItems.map((line, index) => [storefrontOptionLineIdentity(line), cart.items[index]!]));
      const deliveryMetadata = (line: Parameters<typeof storefrontOptionLineIdentity>[0]) => {
        const previous = previousLines.get(storefrontOptionLineIdentity(line));
        // Preserve only existing server-loaded non-financial metadata. Money,
        // quantities, selectors, category and titles are reconstructed below.
        const fields = ["weightGrams", "weight_kg", "height_cm", "width_cm", "length_cm", "imageUrl", "productUrl", "description",
          "fulfillmentStrategy", "fulfillmentSchedule", "variantLabel", "cost"];
        return Object.fromEntries(fields.flatMap(key => previous?.[key] === undefined ? [] : [[key, previous[key]]]));
      };
      const baseCart = { ...unquotedCart, currentDiscount: 0, total: quote.originalSubtotalCents / 100,
        items: quote.items.map(line => {
          const catalog = rows.find(row => row.id === line.variantId)!;
          return { ...deliveryMetadata(line), productType: "physical", sku: line.sku, name: catalog.product.name,
          ...(catalog.weightGrams === null ? {} : { weightGrams: catalog.weightGrams }),
          ...(catalog.heightCm === null ? {} : { height_cm: catalog.heightCm }),
          ...(catalog.widthCm === null ? {} : { width_cm: catalog.widthCm }),
          ...(catalog.lengthCm === null ? {} : { length_cm: catalog.lengthCm }),
          ...(catalog.media[0] ? { imageUrl: catalog.media[0].url } : {}),
          variantId: line.variantId, product_id: line.productId, quantity: line.quantity, price: line.baseUnitPriceCents / 100,
          variant: JSON.stringify([line.variantId, (line.selectedOptions ?? []).map(option => option.itemId).sort()]),
          ...(line.categoryId === undefined ? {} : { category: line.categoryId }),
          ...(line.selectedOptions?.length ? { selected_options: line.selectedOptions.map(option => ({
            group_name: option.groupName, item_name: option.itemName, price_modifier: option.priceModifierInCents / 100 })) } : {}) };
        }),
        _widgetCrossSellAcceptance: receipt };
      // The storage base never contains a second application of the promotion.
      // Only the private receipt's canonical projection can expose the benefit.
      const suggestion = await tx.crossSellSuggestion.updateMany({ where: { id: quote.suggestionId, ...scope,
        promoId: quote.target.promotionId, status: "pending" }, data: { status: "accepted", rankedItems: [quote.target.sku],
        resolvedAt: new Date(quote.quotedAt), computedDiscount: effectivePercent } });
      if (suggestion.count !== 1) return requireWidgetCrossSellReview();
      const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, version: stored.version },
        data: { cart: baseCart as unknown as Prisma.InputJsonValue, shipping: Prisma.DbNull, shippingOptions: Prisma.DbNull,
          updatedAt: new Date(quote.quotedAt) } });
      if (saved.count !== 1) return requireWidgetCrossSellReview();
      await this.confirmWrite(tx,scope,stored,receipt);
      await tx.checkoutEvent.create({ data: { ...scope, eventName: "cross_sell_accepted", occurredAt: new Date(quote.quotedAt),
        metadata: { suggestion_id: quote.suggestionId, acceptance_event_id: event.event_id, checkout_version: stored.version + 1 } } });
      // Create rather than collision-suppressing upsert: an unexpected event-ID
      // collision must roll back, never bind this receipt to a different event.
      await tx.outboxMessage.create({ data: { eventId: event.event_id, eventType: event.event_type, schemaVersion: event.schema_version,
        merchantId: event.merchant_id, occurredAt: new Date(event.occurred_at), correlationId: event.correlation_id,
        causationId: event.causation_id, producer: event.producer, payload: event.payload } });
      return widgetCrossSellCheckoutAcknowledgementSchema.parse({ ...scope, version: 1, status: "accepted",
        suggestionId: quote.suggestionId, persistenceVersion: stored.version + 1, eventId: event.event_id });
    }, transactionOptions);
  }
}
