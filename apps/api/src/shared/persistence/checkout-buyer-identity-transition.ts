import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ChatExchangeClaim } from "../../modules/checkout/domain/ports/checkout-session.repository.port.js";
import { CHECKOUT_BUYER_IDENTITY_DETACHMENT_PROTOCOL, checkoutBuyerIdentityDetachmentSchema,
  type CheckoutBuyerIdentityDetachment } from "./checkout-buyer-identity-detachment.js";

const id = z.string().min(1).max(191).refine(value => value.trim() === value && !value.includes("\0"));
const version = z.number().int().positive(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const CHECKOUT_BUYER_IDENTITY_PROTOCOL = "checkout_email_otp_identity_v1";
export const checkoutBuyerIdentityTransitionSchema = z.strictObject({
  protocol: z.literal(CHECKOUT_BUYER_IDENTITY_PROTOCOL),
  merchantId: id, sessionId: id, fromBuyerId: id, toBuyerId: id, fromVersion: version, toVersion: version,
  acceptanceEventIds: z.array(id).min(1).max(200), basisHash: hash, verifiedAt: z.iso.datetime({ offset: true }),
}).superRefine((value, context) => {
  if (value.toVersion !== value.fromVersion + 1 || new Set(value.acceptanceEventIds).size !== value.acceptanceEventIds.length
    || !isDeepStrictEqual(value.acceptanceEventIds, [...value.acceptanceEventIds].sort())) context.addIssue({ code: "custom", message: "identity_transition_invalid" });
});
type Transition = z.output<typeof checkoutBuyerIdentityTransitionSchema> | CheckoutBuyerIdentityDetachment;
type Scope = { merchantId: string; sessionId: string };
type Tx = Pick<Prisma.TransactionClient, "$queryRaw" | "checkoutSession" | "checkoutChatRequest" | "checkoutEvent" | "outboxMessage">;
export const requireCheckoutBuyerIdentityReview = (): never => { throw new Error("checkout_buyer_identity_review_required"); };
const eventIdFor = (value: Transition) => `identity_${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const metadataFor = (value: Transition, eventId: string) => ({ protocol: value.protocol,
  identity_event_id: eventId, from_buyer_id: value.fromBuyerId, to_buyer_id: value.toBuyerId,
  from_version: value.fromVersion, to_version: value.toVersion, acceptance_event_ids: value.acceptanceEventIds, basis_hash: value.basisHash });
const trackedPayloadSchema = z.discriminatedUnion("event_name", [
  z.strictObject({ session_id: id, event_name: z.literal("auth_identity_confirmed"),
    metadata: z.strictObject({ identity_transition: checkoutBuyerIdentityTransitionSchema }) }),
  z.strictObject({ session_id: id, event_name: z.literal("buyer_identity_detached"),
    metadata: z.strictObject({ identity_detachment: checkoutBuyerIdentityDetachmentSchema }) }),
]);
const transitionTime = (value: Transition) => "verifiedAt" in value ? value.verifiedAt : value.detachedAt;

/** Called only by the transaction that verified/consumed the actual challenge.
 * This reference is not a signed client token or an independent financial grant. */
export async function appendCheckoutBuyerIdentityTransition(tx: Tx, raw: Omit<z.input<typeof checkoutBuyerIdentityTransitionSchema>, "protocol">): Promise<void> {
  const value = checkoutBuyerIdentityTransitionSchema.parse({ ...raw, protocol: CHECKOUT_BUYER_IDENTITY_PROTOCOL }), eventId = eventIdFor(value), occurredAt = new Date(value.verifiedAt);
  await tx.checkoutEvent.create({ data: { merchantId: value.merchantId, sessionId: value.sessionId,
    eventName: "auth_identity_confirmed", occurredAt, metadata: metadataFor(value, eventId) } });
  await tx.outboxMessage.create({ data: { eventId, eventType: "checkout.event.tracked", schemaVersion: 1,
    merchantId: value.merchantId, occurredAt, correlationId: value.sessionId, causationId: eventId, producer: "checkout",
    payload: { session_id: value.sessionId, event_name: "auth_identity_confirmed", metadata: { identity_transition: value } }, status: "pending" } });
}

/** Only the dedicated privacy command issues this anonymous detachment. It is
 * deliberately not an OTP result or an authentication event. */
export async function appendCheckoutBuyerIdentityDetachment(tx: Tx, raw: Omit<z.input<typeof checkoutBuyerIdentityDetachmentSchema>, "protocol">): Promise<void> {
  const value = checkoutBuyerIdentityDetachmentSchema.parse({ ...raw, protocol: CHECKOUT_BUYER_IDENTITY_DETACHMENT_PROTOCOL });
  const eventId = eventIdFor(value), occurredAt = new Date(value.detachedAt);
  await tx.checkoutEvent.create({ data: { merchantId: value.merchantId, sessionId: value.sessionId,
    eventName: "buyer_identity_detached", occurredAt, metadata: metadataFor(value, eventId) } });
  await tx.outboxMessage.create({ data: { eventId, eventType: "checkout.event.tracked", schemaVersion: 1,
    merchantId: value.merchantId, occurredAt, correlationId: value.sessionId, causationId: eventId, producer: "checkout",
    payload: { session_id: value.sessionId, event_name: "buyer_identity_detached", metadata: { identity_detachment: value } }, status: "pending" } });
}

/** Exact current processing claim only. A known ID/body bit is never sufficient;
 * current journal scope/hash/conversation/status must all match independently. */
export async function assertCheckoutBuyerIdentityChatClaim(tx: Pick<Tx, "checkoutChatRequest">, scope: Scope,
  claim?: ChatExchangeClaim, conversationId?: string): Promise<void> {
  const rows = z.array(z.object({ id, merchantId: id, sessionId: id, conversationId: id, requestHash: hash,
    status: z.enum(["processing", "unknown"]) })).max(2).parse(await tx.checkoutChatRequest.findMany({
    where: { ...scope, status: { in: ["processing", "unknown"] } }, take: 2,
    select: { id: true, merchantId: true, sessionId: true, conversationId: true, requestHash: true, status: true },
  }));
  if (!rows.length && !claim) return;
  const row = rows[0];
  if (!claim || rows.length !== 1 || !row || row.id !== claim.requestId || row.requestHash !== claim.requestHash
    || row.merchantId !== scope.merchantId || row.sessionId !== scope.sessionId || row.status !== "processing"
    || conversationId !== undefined && row.conversationId !== conversationId) return requireCheckoutBuyerIdentityReview();
}

/** Follow only actual paired immutable events for this acceptance and session.
 * This preserves public P provenance, NOT account/email authentication. A
 * detachment is anonymous; a subsequent actual OTP proves its new account.
 * Never repair or rewrite historical acceptance ownership. */
export async function assertCheckoutBuyerIdentityTransition(tx: Tx, scope: Scope, acceptanceEventId: string,
  fromBuyerId: string, toBuyerId: string, acceptanceVersion: number): Promise<void> {
  if (fromBuyerId === toBuyerId) return;
  const current = z.object({ merchantId: id, sessionId: id, globalUserId: id, version }).parse(
    await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope },
      select: { merchantId: true, sessionId: true, globalUserId: true, version: true } }));
  if (current.merchantId !== scope.merchantId || current.sessionId !== scope.sessionId || current.globalUserId !== toBuyerId)
    return requireCheckoutBuyerIdentityReview();
  const rawRows = await tx.outboxMessage.findMany({ where: { merchantId: scope.merchantId, producer: "checkout", eventType: "checkout.event.tracked",
    AND: [{ OR: [{ payload: { path: ["metadata", "identity_transition", "protocol"], equals: CHECKOUT_BUYER_IDENTITY_PROTOCOL } },
      { payload: { path: ["metadata", "identity_detachment", "protocol"], equals: CHECKOUT_BUYER_IDENTITY_DETACHMENT_PROTOCOL } }] },
      { payload: { path: ["session_id"], equals: scope.sessionId } }] },
    orderBy: [{ occurredAt: "asc" }, { eventId: "asc" }], take: 201 });
  if (rawRows.length > 200) return requireCheckoutBuyerIdentityReview();
  const transitions: Transition[] = [];
  for (const rawRow of rawRows) {
    const parsed = z.object({ eventId: id, merchantId: id, producer: z.literal("checkout"), eventType: z.literal("checkout.event.tracked"),
      schemaVersion: z.literal(1), occurredAt: z.date(), correlationId: id, causationId: id, payload: trackedPayloadSchema }).safeParse(rawRow);
    if (!parsed.success) return requireCheckoutBuyerIdentityReview();
    const row = parsed.data, value = row.payload.event_name === "auth_identity_confirmed"
      ? row.payload.metadata.identity_transition : row.payload.metadata.identity_detachment;
    const eventId = eventIdFor(value);
    if (row.eventId !== eventId || row.causationId !== eventId || row.correlationId !== scope.sessionId || row.merchantId !== scope.merchantId
      || row.payload.session_id !== scope.sessionId || value.merchantId !== scope.merchantId || value.sessionId !== scope.sessionId || row.occurredAt.getTime() !== Date.parse(transitionTime(value))
      || value.toVersion > current.version) return requireCheckoutBuyerIdentityReview();
    const technical = await tx.checkoutEvent.findFirst({ where: { ...scope, eventName: row.payload.event_name, metadata: { equals: metadataFor(value, eventId) } },
      select: { merchantId: true, sessionId: true, eventName: true, occurredAt: true, metadata: true } });
    if (!technical || technical.merchantId !== scope.merchantId || technical.sessionId !== scope.sessionId
      || technical.eventName !== row.payload.event_name || technical.occurredAt.getTime() !== row.occurredAt.getTime()
      || !isDeepStrictEqual(technical.metadata, metadataFor(value, eventId))) return requireCheckoutBuyerIdentityReview();
    if (value.fromBuyerId !== value.toBuyerId && value.acceptanceEventIds.includes(acceptanceEventId)) transitions.push(value);
  }
  let buyer = fromBuyerId, lastVersion = acceptanceVersion;
  const visited = new Set<string>();
  for (let count = 0; count < transitions.length; count++) {
    if (buyer === toBuyerId) return;
    if (visited.has(buyer)) return requireCheckoutBuyerIdentityReview(); visited.add(buyer);
    const next = transitions.filter(value => value.fromBuyerId === buyer && value.fromVersion >= lastVersion);
    if (next.length !== 1) return requireCheckoutBuyerIdentityReview();
    buyer = next[0]!.toBuyerId; lastVersion = next[0]!.toVersion;
  }
  if (buyer !== toBuyerId) return requireCheckoutBuyerIdentityReview();
}
