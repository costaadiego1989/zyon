import { z } from "zod";

const ref = z.string().min(1).max(191), hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso.datetime({ offset: true });
const revision = z.number().int().nonnegative().max(2_147_483_647);
export const providerShippingCommandSchema = z.strictObject({ expectedVersion: revision });
export const providerShippingScopeSchema = z.strictObject({ merchantId: ref, sessionId: ref });
/** Private canonical SQL-reader output. Hash parsing alone proves no provenance.
 * metadataHash includes actual fenced scoped DB/config/account generation. */
export const providerShippingSourcesSchema = z.strictObject({
  merchantId: ref, sessionId: ref, buyerId: ref, acceptanceEventId: ref, persistenceVersion: revision,
  originZip: z.string().regex(/^\d{8}$/), destinationZip: z.string().regex(/^\d{8}$/),
  mode: z.enum(["radius", "carrier"]), basisHash: hash, destinationHash: hash, packageHash: hash,
  originHash: hash, configHash: hash, metadataHash: hash,
});
export const rawProviderShippingOptionSchema = z.strictObject({
  carrier_key: z.string().min(1).max(300), label: z.string().min(1).max(300),
  price: z.number().int().nonnegative().max(2_147_483_647), eta_days: z.number().int().nonnegative().max(365),
});
const options = z.array(rawProviderShippingOptionSchema).max(40)
  .refine(rows => new Set(rows.map(row => row.carrier_key)).size === rows.length);
const baseResult = { requestId: z.uuidv4(), expiresAt: instant, options };
export const providerShippingResultSchema = z.discriminatedUnion("mode", [
  z.strictObject({ ...baseResult, mode: z.literal("radius"), evidence: z.strictObject({
    kind: z.literal("cep_haversine"), originZip: z.string().regex(/^\d{8}$/), destinationZip: z.string().regex(/^\d{8}$/),
    distanceKm: z.number().finite().nonnegative().max(50_000),
  }) }),
  z.strictObject({ ...baseResult, mode: z.literal("carrier"), evidence: z.strictObject({
    kind: z.literal("merchant_carrier_account"), provider: z.literal("melhor-envio"),
    accountFingerprint: hash, metadataHash: hash, environment: z.enum(["test", "live"]),
  }) }),
]);
const envelopeBase = { version: z.literal(1), origin: z.literal("widget_checkout_provider"),
  requestId: z.uuidv4(), sources: providerShippingSourcesSchema, issuedAt: instant, expiresAt: instant,
  persistenceVersion: revision };
export const providerShippingEnvelopeSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...envelopeBase, state: z.literal("pending") }),
  z.strictObject({ ...envelopeBase, state: z.literal("unknown"), finishedAt: instant }),
  z.strictObject({ ...envelopeBase, state: z.literal("completed"), finishedAt: instant, result: providerShippingResultSchema }),
]);
export type ProviderShippingSources = z.infer<typeof providerShippingSourcesSchema>;
export type ProviderShippingEnvelope = z.infer<typeof providerShippingEnvelopeSchema>;
export type ProviderShippingPending = Extract<ProviderShippingEnvelope, { state: "pending" }>;
export type ProviderShippingResult = z.infer<typeof providerShippingResultSchema>;
