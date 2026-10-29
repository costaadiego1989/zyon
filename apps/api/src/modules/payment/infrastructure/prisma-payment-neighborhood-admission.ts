import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { evaluateSelectedNeighborhoodDelivery } from "../../shipping/domain/services/selected-neighborhood-delivery.js";
import { resolveNeighborhoodDeliveryOrigin } from "../../shipping/domain/services/neighborhood-delivery-origin.js";

const id = z.string().trim().min(1).max(191);
const scopeSchema = z.strictObject({ merchantId: id, sessionId: id });
// Analytic realCost is deliberately not decoded as an eligibility prerequisite.
const selectedSchema = z.object({ customerPrice: z.number().finite().nonnegative(),
  carrier: z.string().optional(), method: z.string().optional(), deliveryDays: z.number().finite().optional(),
  destinationZip: z.string().optional(), region: z.string().optional() });
const addressSchema = z.object({ zip: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
  neighborhood: z.string().optional(), street: z.string().optional(), number: z.string().optional(),
  complement: z.string().nullable().optional().transform(value => value ?? undefined) });
const customerSchema = z.object({ address_verified: z.boolean().optional(), address: addressSchema.optional() });
const cartSchema = z.object({ total: z.number().finite().nonnegative().refine(value => Number.isSafeInteger(Math.round(value * 100))) });
const sourceQuoteSchema = z.object({ merchantId: id, sessionId: id, destinationZip: z.string(),
  results: z.array(z.object({ carrier_key: z.string(), label: z.string(), price: z.number().int().nonnegative(),
    original_price: z.number().int().nonnegative().optional(), eta_days: z.number().int().nonnegative(), is_free: z.boolean() })) });
type StoredSession = { merchantId: string; sessionId: string; shipping: unknown; customer: unknown; cart: unknown };
const review = (code = "neighborhood_quote_review_required"): never => { throw new ConflictException({ code }); };

/** Caller holds merchant -> rules/config -> checkout/session fences in this
 * actual transaction. Read-only authority: no journal, retry, quote or grant.
 * Only new admission / a ready journal's FIRST dispatch may call this reader. */
export async function assertNeighborhoodPaymentAdmission(tx: Prisma.TransactionClient,
  scope: { merchantId: string; sessionId: string }, stored: StoredSession | null): Promise<void> {
  const { merchantId, sessionId } = scopeSchema.parse(scope);
  if (stored?.shipping === null || stored?.shipping === undefined) return;
  const selected = selectedSchema.safeParse(stored.shipping);
  if (!selected.success) return review();
  const customer = customerSchema.safeParse(stored.customer), cart = cartSchema.safeParse(stored.cart);
  const input = { merchantId, sessionId, selected: selected.data,
    address: customer.success ? customer.data.address : undefined,
    addressVerified: customer.success && customer.data.address_verified === true,
    cartTotalCents: cart.success ? Math.round(cart.data.total * 100) : Number.NaN };
  const initial = evaluateSelectedNeighborhoodDelivery({ ...input, config: undefined, origin: undefined, sourceQuote: null });
  if (initial.kind === "not_neighborhood") return;
  if (stored.merchantId !== merchantId || stored.sessionId !== sessionId || !cart.success) return review();
  const config = await tx.ownDeliveryConfig.findUnique({ where: { merchantId } });
  // This payment adapter owns its transaction reads; share the pure locality
  // policy, not another context's infrastructure repository.
  const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: { id: true, storeSettings: true } });
  const rule = await tx.merchantRule.findUnique({ where: { merchantId }, select: { merchantId: true, originZip: true } });
  const origin = resolveNeighborhoodDeliveryOrigin(merchantId, merchant, rule);
  // The same scoped quote supports both HTTP carrier_key and the legacy chat's
  // human label, without treating that label/body as a coverage authorization.
  await tx.$queryRaw`SELECT id FROM shipping_quotes WHERE merchant_id = ${merchantId} AND session_id = ${sessionId} FOR SHARE`;
  const rawQuote = sourceQuoteSchema.safeParse(await tx.shippingQuote.findFirst({ where: { merchantId, sessionId }, orderBy: { createdAt: "desc" } }));
  const sourceQuote = rawQuote.success ? { merchant_id: rawQuote.data.merchantId, session_id: rawQuote.data.sessionId,
    destination_zip: rawQuote.data.destinationZip, results: rawQuote.data.results } : null;
  const decision = evaluateSelectedNeighborhoodDelivery({ ...input, config, origin, sourceQuote });
  if (decision.kind === "requires_review") return review(decision.reason);
}
