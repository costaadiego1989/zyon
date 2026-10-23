import type { Prisma } from "@prisma/client";
import type { Cart } from "@zyon/shared-types";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import { assertSamePaymentIdentity } from "../domain/payment-persistence.js";
import { readPaymentWidgetCheckoutAuthority, assertSamePaymentWidgetCheckoutAuthority } from "../domain/payment-widget-checkout-authority.js";
import { parseWidgetCheckoutPaymentAuthority, widgetCheckoutFrozenProjectionSchema, type WidgetCheckoutPaymentAuthority } from "../domain/widget-checkout-payment-authority.schemas.js";
import { widgetCheckoutRevisionContextHash } from "../../cross-sell/infrastructure/repositories/widget-cross-sell-checkout-revision.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { readBuyerServiceFeeCents } from "./stripe-env.js";

export interface AcceptedWidgetCheckoutPaymentCurrent {
  stored: { merchantId: string; sessionId: string; version: number; strategyContextVersion: number; globalUserId: string;
    customer?: Record<string, unknown> | null; shipping?: unknown; shippingOptions?: unknown; paymentMethod?: string | null };
  receipt: { eventId: string; revision?: { eventId: string } }; quote: { quotedAt: string };
  projectedCart: Cart; selectedShipping: unknown;
}
export type AcceptedWidgetCheckoutPaymentReader = (tx: Prisma.TransactionClient, scope: { merchantId: string; sessionId: string },
  options?: { ownPaymentIntentId?: string }) => Promise<AcceptedWidgetCheckoutPaymentCurrent>;
export type CaptureWidgetCheckoutPayment = (tx: Prisma.TransactionClient, snapshot: PaymentIntentSnapshot) => Promise<WidgetCheckoutPaymentAuthority>;
const conflict = (): never => { throw new Error("payment_widget_checkout_authority_conflict"); };
const methodSchema = z.enum(["pix", "card", "boleto", "crypto"]);
const headerSchema = z.object({ merchantId: z.string().min(1).max(200), sessionId: z.string().min(1).max(200),
  version: z.number().int().min(1).max(2_147_483_647), strategyContextVersion: z.number().int().min(0).max(2_147_483_647),
  globalUserId: z.string().min(1).max(200), customer: z.record(z.string(), z.unknown()).nullish(),
  shipping: z.unknown().optional(), shippingOptions: z.unknown().optional(), paymentMethod: z.string().nullish() });

/** No transaction, principal, provider, retry or ignore-list is created here.
 * The repository holds merchant/payment/session fences; readCanonical owns ALL
 * accepted receipt/catalog/config/shipping reads within that SAME supplied tx. */
export function createWidgetCheckoutPaymentAdmission(readCanonical: AcceptedWidgetCheckoutPaymentReader,
  buyerFee: () => number = readBuyerServiceFeeCents): CaptureWidgetCheckoutPayment {
  return async (tx, snapshot) => {
    try {
    const original = readPaymentWidgetCheckoutAuthority(snapshot), creation = snapshot.creation;
    if (!creation || snapshot.status !== "pending" || snapshot.providerPaymentId || snapshot.currency !== "BRL"
      || snapshot.acceptedOfferId || snapshot.commerceOrderId || creation.cancellation
      || "couponAuthority" in creation || creation.input.marketplaceFunding || creation.input.marketplacePublicAdmission) return conflict();
    const actual = await tx.paymentIntent.findUnique({ where: { id: snapshot.id } });
    if (!actual) {
      if (original || (snapshot.version ?? 0) !== 0 || creation.state !== "ready" || creation.firstAttemptAt) return conflict();
    } else {
      const current: PaymentIntentSnapshot = { id: actual.id, merchantId: actual.merchantId, sessionId: actual.sessionId,
        idempotencyKey: actual.idempotencyKey, version: actual.version, amountCents: actual.amountCents, currency: actual.currency,
        method: methodSchema.parse(actual.method), status: "pending", providerPaymentId: actual.providerPaymentId ?? undefined,
        acceptedOfferId: actual.acceptedOfferId ?? undefined, commerceOrderId: actual.commerceOrderId ?? undefined,
        amountBreakdown: actual.amountBreakdown as PaymentIntentSnapshot["amountBreakdown"],
        // JSONB is decoded only by the strict stored-sibling reader below.
        creation: actual.creation as unknown as PaymentIntentSnapshot["creation"], statusHistory: [] };
      if (!original || actual.status !== "pending" || actual.providerPaymentId || actual.version !== snapshot.version
        || current.creation?.state !== "ready" || current.creation.firstAttemptAt || creation.state !== "in_flight" || !creation.firstAttemptAt
        || !readPaymentWidgetCheckoutAuthority(current)) return conflict();
      // Prove actual immutable storage BEFORE passing its exact ID to the
      // reader. Parsed JSON/client IDs cannot widen the payment mutability gate.
      assertSamePaymentIdentity(current, snapshot);
      assertSamePaymentWidgetCheckoutAuthority(current, snapshot);
    }
    const scope = { merchantId: snapshot.merchantId, sessionId: snapshot.sessionId };
    const source = await readCanonical(tx, scope, actual ? { ownPaymentIntentId: actual.id } : undefined);
    const stored = headerSchema.parse(source.stored);
    if (stored.merchantId !== scope.merchantId || stored.sessionId !== scope.sessionId
      || stored.paymentMethod && stored.paymentMethod !== snapshot.method) return conflict();
    const customer = stored.customer ?? {};
    const projection = widgetCheckoutFrozenProjectionSchema.parse({ globalUserId: stored.globalUserId,
      cart: { currency: source.projectedCart.currency, total: source.projectedCart.total, currentDiscount: source.projectedCart.currentDiscount,
        ...(source.projectedCart.source === undefined ? {} : { source: source.projectedCart.source }),
        items: source.projectedCart.items.map(item => ({ sku: item.sku, variantId: item.variantId, product_id: item.product_id, name: item.name,
          productType: item.productType, quantity: item.quantity, price: item.price, variant: item.variant,
          ...(item.originalPrice === undefined ? {} : { originalPrice: item.originalPrice }),
          ...(item.selected_options === undefined ? {} : { selected_options: item.selected_options }),
          ...(item.fulfillmentStrategy === undefined ? {} : { fulfillmentStrategy: item.fulfillmentStrategy }),
          ...(item.imageUrl === undefined ? {} : { imageUrl: item.imageUrl }), ...(item.productUrl === undefined ? {} : { productUrl: item.productUrl }),
        })), discountBudget: source.projectedCart.discountBudget,
        ...(source.projectedCart.commercialNotices === undefined ? {} : { commercialNotices: source.projectedCart.commercialNotices }) },
      shipping: source.selectedShipping,
      customer: { fullName: customer.fullName, email: typeof customer.email === "string" ? customer.email.trim().toLowerCase() : customer.email,
        cpf: typeof customer.cpf === "string" ? customer.cpf.replace(/\D/g, "") : customer.cpf,
        phone: typeof customer.phone === "string" ? customer.phone.replace(/\D/g, "") : customer.phone,
        email_verified: customer.email_verified, address_verified: customer.address_verified, address: customer.address },
    });
    if (creation.input.payerEmail !== undefined && creation.input.payerEmail.trim().toLowerCase() !== projection.customer.email
      || creation.input.payerName !== undefined && creation.input.payerName.trim() !== projection.customer.fullName
      || creation.input.payerIdentification !== undefined && (creation.input.payerIdentification.type !== "CPF"
        || creation.input.payerIdentification.number.replace(/\D/g, "") !== projection.customer.cpf)
      || creation.input.asaasCustomerId !== undefined && creation.input.asaasCustomerId !== customer.asaasCustomerId) return conflict();
    const captured = parseWidgetCheckoutPaymentAuthority({ version: 1, origin: "widget_checkout", paymentId: snapshot.id, merchantId: scope.merchantId,
      checkoutSessionId: scope.sessionId, buyerId: stored.globalUserId, acceptanceEventId: source.receipt.eventId,
      checkoutVersion: stored.version, ...(source.receipt.revision ? { revisionEventId: source.receipt.revision.eventId } : {}),
      contextHash: widgetCheckoutRevisionContextHash(stored), basisHash: paymentCartFingerprint(projection), method: snapshot.method,
      currency: snapshot.currency, amountCents: snapshot.amountCents, amountBreakdown: snapshot.amountBreakdown,
      admittedAt: original?.admittedAt ?? source.quote.quotedAt, frozenProjection: projection,
    });
    if (captured.amountBreakdown.platformFeeCents !== buyerFee()) return conflict();
    // Bind even the initial capture to every immutable provider/journal field.
    readPaymentWidgetCheckoutAuthority({ ...snapshot, creation: { ...creation, widgetCheckoutAuthority: captured } });
    if (original && !isDeepStrictEqual(original, captured)) return conflict();
    return captured;
    } catch (error) {
      if (error instanceof z.ZodError) return conflict();
      throw error;
    }
  };
}
