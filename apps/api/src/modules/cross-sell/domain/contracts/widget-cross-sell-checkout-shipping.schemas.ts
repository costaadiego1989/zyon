import { z } from "zod";

const ref = z.string().min(1).max(191), cents = z.number().int().nonnegative().max(2_147_483_647);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Storage-private quote, NOT selection, a subsidy grant or a payment source.
 * Its complete envelope is committed by the checkout revision context/event.
 * Future selection must revalidate current config/basis/address/expiry under
 * fences; a parsed or still readable snapshot never grants a price. */
export const widgetCheckoutManualShippingSnapshotSchema = z.strictObject({
  version: z.literal(1), origin: z.literal("widget_checkout_manual"), id: z.uuidv4(),
  merchantId: ref, sessionId: ref, buyerId: ref, acceptanceEventId: ref,
  issuedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
  basisHash: hash, destinationHash: hash, configHash: hash,
  options: z.array(z.strictObject({ carrier_key: z.string().min(1).max(300), label: z.string().min(1).max(300),
    price: cents, original_price: cents.optional(), eta_days: z.number().int().positive(), is_free: z.boolean(),
  }).refine(option => option.is_free ? option.price === 0 && option.original_price !== undefined : option.original_price === undefined)).max(1),
}).refine(value => Date.parse(value.expiresAt) > Date.parse(value.issuedAt));
