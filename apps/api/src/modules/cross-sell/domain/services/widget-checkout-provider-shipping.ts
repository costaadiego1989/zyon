import { DEFAULT_QUOTE_TTL_SECONDS } from "@zyon/shipping-engine";
import { z } from "zod";
import { providerShippingCommandSchema, providerShippingEnvelopeSchema, providerShippingResultSchema,
  providerShippingSourcesSchema, type ProviderShippingEnvelope, type ProviderShippingPending } from "../contracts/widget-checkout-provider-shipping.schemas.js";

const review = (): never => { throw new Error("widget_checkout_provider_shipping_review_required"); };
const timestamp = (value: unknown) => Date.parse(z.iso.datetime({ offset: true }).parse(value));
const nextVersion = (value: number) => value < 2_147_483_647 ? value + 1 : review();

/** Pure planning only. Real repositories must persist revision/event/CAS under
 * canonical fences and return ONLY after known commit. No parsed grant exists. */
export function beginProviderShipping(rawSources: unknown, rawCommand: unknown,
  issuance: { requestId: string; now: string }, rawPrevious?: unknown): ProviderShippingPending {
  const sources = providerShippingSourcesSchema.parse(rawSources), command = providerShippingCommandSchema.parse(rawCommand);
  const previous = rawPrevious === undefined ? undefined : providerShippingEnvelopeSchema.parse(rawPrevious);
  if (sources.persistenceVersion !== command.expectedVersion || previous &&
    (previous.state !== "completed" || previous.requestId === issuance.requestId)) return review();
  const now = timestamp(issuance.now), version = nextVersion(sources.persistenceVersion);
  const pending = providerShippingEnvelopeSchema.parse({ version: 1, origin: "widget_checkout_provider", state: "pending",
    requestId: issuance.requestId, sources: { ...sources, persistenceVersion: version }, persistenceVersion: version,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + DEFAULT_QUOTE_TTL_SECONDS * 1000).toISOString() });
  if (pending.state !== "pending") return review();
  return pending;
}

function pendingCurrent(rawEnvelope: unknown, rawCurrent: unknown, now: string) {
  const envelope = providerShippingEnvelopeSchema.parse(rawEnvelope), current = providerShippingSourcesSchema.parse(rawCurrent);
  const at = timestamp(now);
  if (envelope.state !== "pending" || at < timestamp(envelope.issuedAt)
    || envelope.persistenceVersion !== current.persistenceVersion
    || JSON.stringify(envelope.sources) !== JSON.stringify(current)
    || timestamp(envelope.expiresAt) - timestamp(envelope.issuedAt) !== DEFAULT_QUOTE_TTL_SECONDS * 1000) return review();
  return { envelope, at };
}

export function completeProviderShipping(rawEnvelope: unknown, rawCurrent: unknown, rawResult: unknown, now: string) {
  const { envelope, at } = pendingCurrent(rawEnvelope, rawCurrent, now), result = providerShippingResultSchema.parse(rawResult);
  if (result.requestId !== envelope.requestId || result.mode !== envelope.sources.mode
    || timestamp(envelope.expiresAt) <= at || timestamp(result.expiresAt) <= at
    || timestamp(result.expiresAt) > timestamp(envelope.expiresAt)
    || result.mode === "radius" && (result.evidence.originZip !== envelope.sources.originZip
      || result.evidence.destinationZip !== envelope.sources.destinationZip)
    || result.mode === "carrier" && result.evidence.metadataHash !== envelope.sources.metadataHash) return review();
  const completed = providerShippingEnvelopeSchema.parse({ ...envelope, state: "completed", result,
    finishedAt: new Date(at).toISOString(), persistenceVersion: nextVersion(envelope.persistenceVersion) });
  if (completed.state !== "completed") return review();
  return completed;
}

export function unknownProviderShipping(rawEnvelope: unknown, rawCurrent: unknown, now: string): ProviderShippingEnvelope {
  const { envelope, at } = pendingCurrent(rawEnvelope, rawCurrent, now);
  return providerShippingEnvelopeSchema.parse({ ...envelope, state: "unknown", finishedAt: new Date(at).toISOString(),
    persistenceVersion: nextVersion(envelope.persistenceVersion) });
}
