import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { OtpService } from "../../../checkout/application/services/otp.service.js";
import { checkoutAddressRegistrationSchema } from "../../../checkout/domain/services/checkout-explicit-address.schema.js";
import { checkoutEmailOtpDeliveryScopeSchema, checkoutEmailOtpIssueRequestSchema, checkoutEmailOtpIssueAcknowledgementSchema,
  checkoutEmailOtpDeliveryRequestSchema, checkoutEmailOtpDeliveryClaimSchema, checkoutEmailOtpDeliveryCompletionSchema,
  checkoutEmailOtpDeliveryAcknowledgementSchema } from "../../../checkout/domain/services/checkout-email-otp-delivery.schemas.js";
import { appendCheckoutEmailOtpDelivery, inspectCheckoutEmailOtpDelivery, claimCheckoutEmailOtpDelivery,
  completeCheckoutEmailOtpDelivery, invalidatePendingCheckoutEmailOtpDelivery } from "../../../checkout/infrastructure/prisma/checkout-email-otp-outbox.js";
import { widgetCrossSellCheckoutReceiptSchema } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";
import { widgetCheckoutRevisionContextHash, widgetCheckoutRevisionMetadata, widgetCheckoutRevisionEventName } from "./widget-cross-sell-checkout-revision.js";

type Scope = z.infer<typeof checkoutEmailOtpDeliveryScopeSchema>;
type Receipt = z.infer<typeof widgetCrossSellCheckoutReceiptSchema>;
export interface WidgetCheckoutOtpCurrent {
  stored: { id: string; merchantId: string; sessionId: string; version: number; strategyContextVersion: number; globalUserId: string;
    customer?: Record<string, unknown> | null; shipping?: unknown; shippingOptions?: unknown; paymentMethod?: unknown };
  cart: Record<string, unknown>; receipt: Receipt; quote: { quotedAt: string };
}
export interface WidgetCheckoutOtpCompletionCurrent {
  stored: { merchantId: string; sessionId: string; version: number }; receipt: Receipt; now: Date;
}
const review = (): never => { throw new Error("cross_sell_quote_review_required"); };
const trackingKeys = ["otp_delivery_id", "otp_delivery_email", "otp_issued_at"] as const;
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const trackedSchema = z.object({ otp_delivery_id: z.uuid(), otp_delivery_email: emailSchema,
  otp_issued_at: z.iso.datetime({ offset: true }), otp_expires_at: z.iso.datetime({ offset: true }), otp_code: z.string().regex(/^[1-9]\d{5}$/) });
const hasTracking = (customer: Record<string, unknown> | null | undefined) => trackingKeys.some(key => customer?.[key] !== undefined);

function scopeOf(rawScope: unknown, current: { stored: { merchantId: string; sessionId: string }; receipt: Receipt }): Scope {
  const scope = checkoutEmailOtpDeliveryScopeSchema.parse(rawScope);
  if (current.stored.merchantId !== scope.merchantId || current.stored.sessionId !== scope.sessionId
    || current.receipt.quote.merchantId !== scope.merchantId || current.receipt.quote.sessionId !== scope.sessionId) return review();
  return scope;
}
function nowOf(current: WidgetCheckoutOtpCurrent) {
  const time = Date.parse(current.quote.quotedAt);
  if (!Number.isFinite(time)) return review();
  return new Date(time);
}
async function trackedReference(tx: Prisma.TransactionClient, scope: Scope, current: Pick<WidgetCheckoutOtpCurrent, "stored" | "receipt">) {
  const customer = trackedSchema.safeParse(current.stored.customer), email = emailSchema.safeParse(current.stored.customer?.email);
  if (!customer.success || !email.success || customer.data.otp_delivery_email !== email.data) return review();
  try {
    const inspected = await inspectCheckoutEmailOtpDelivery(tx, scope, customer.data.otp_delivery_id, current.receipt.eventId);
    if (inspected.reference.issuedAt !== customer.data.otp_issued_at || inspected.reference.expiresAt !== customer.data.otp_expires_at) return review();
    return { ...inspected, email: email.data, customer: customer.data };
  } catch { return review(); }
}
const ack = (scope: Scope, deliveryId: string, persistenceVersion: number, status: "pending" | "sent" | "unknown" | "cancelled") =>
  checkoutEmailOtpDeliveryAcknowledgementSchema.parse({ version: 1, ...scope, deliveryId, persistenceVersion, status });

/** Caller MUST pass prepareAccepted's result in the SAME real transaction.
 * No generic save, detached read grant, provider, retry or financial mutation. */
export async function requestWidgetCheckoutEmailOtp(tx: Prisma.TransactionClient, rawScope: unknown, rawRequest: unknown, current: WidgetCheckoutOtpCurrent) {
  const scope = scopeOf(rawScope, current), request = checkoutEmailOtpIssueRequestSchema.parse(rawRequest);
  const { stored, cart, receipt } = current, now = nowOf(current), previous = stored.customer;
  const email = emailSchema.safeParse(previous?.email);
  if (stored.version !== request.expectedVersion || stored.version >= 2_147_483_647 || stored.strategyContextVersion >= 2_147_483_647
    || !checkoutAddressRegistrationSchema.safeParse(previous).success || !email.success || previous?.email_verified === true) return review();
  if (hasTracking(previous)) {
    const inspected = await trackedReference(tx, scope, current);
    if (["otp_sending", "otp_unknown"].includes(inspected.row.status)) return review();
    if (request.action === "issue" && inspected.row.status !== "otp_cancelled" && Date.parse(inspected.reference.expiresAt) > now.getTime())
      return checkoutEmailOtpIssueAcknowledgementSchema.parse(ack(scope, inspected.reference.deliveryId, stored.version, "pending"));
    await invalidatePendingCheckoutEmailOtpDelivery(tx, inspected.reference);
  } else if (typeof previous?.otp_code === "string" && previous.otp_code.length > 0) {
    const deadline = typeof previous.otp_expires_at === "string" ? Date.parse(previous.otp_expires_at) : NaN;
    if (!/^\d{6}$/.test(previous.otp_code) || !Number.isFinite(deadline)
      || request.action === "issue" && deadline > now.getTime()) return review();
  }
  const deliveryId = randomUUID(), issuedAt = now.toISOString(), expiresAt = new Date(now.getTime() + 600_000).toISOString();
  const customer = { ...previous, otp_code: new OtpService().generateCode(), otp_expires_at: expiresAt,
    otp_delivery_id: deliveryId, otp_delivery_email: email.data, otp_issued_at: issuedAt };
  const next = { ...stored, customer };
  const nextReceipt = widgetCrossSellCheckoutReceiptSchema.parse({ ...receipt, revision: {
    eventId: randomUUID(), previousEventId: receipt.revision?.eventId ?? receipt.eventId,
    persistenceVersion: stored.version + 1, revisedAt: issuedAt, contextHash: widgetCheckoutRevisionContextHash(next), operation: "email_otp_issue",
  } });
  await appendCheckoutEmailOtpDelivery(tx, { ...scope, deliveryId, acceptanceEventId: receipt.eventId, issuedAt, expiresAt });
  const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, version: stored.version }, data: {
    customer: customer as Prisma.InputJsonObject, cart: { ...cart, _widgetCrossSellAcceptance: nextReceipt } as Prisma.InputJsonValue,
    updatedAt: now,
  } });
  if (saved.count !== 1) return review();
  const actual=await tx.checkoutSession.findUnique({where:{merchantId_sessionId:scope}});
  const parsed=z.object({_widgetCrossSellAcceptance:widgetCrossSellCheckoutReceiptSchema}).safeParse(actual?.cart);
  if(!actual||actual.id!==stored.id||actual.merchantId!==scope.merchantId||actual.sessionId!==scope.sessionId
    ||actual.globalUserId!==stored.globalUserId||actual.version!==stored.version+1||actual.strategyContextVersion!==stored.strategyContextVersion
    ||!parsed.success||!isDeepStrictEqual(parsed.data._widgetCrossSellAcceptance,nextReceipt))return review();
  await tx.checkoutEvent.create({ data: { id: nextReceipt.revision!.eventId, ...scope, occurredAt: now,
    eventName: widgetCheckoutRevisionEventName(nextReceipt), metadata: widgetCheckoutRevisionMetadata(nextReceipt) } });
  return checkoutEmailOtpIssueAcknowledgementSchema.parse(ack(scope, deliveryId, stored.version + 1, "pending"));
}

/** Current email/challenge/receipt/version are checked under the accepted fence.
 * Credentials may leave this function only after the CALLER transaction commits. */
export async function claimWidgetCheckoutEmailOtpDelivery(tx: Prisma.TransactionClient, rawScope: unknown, rawRequest: unknown, current: WidgetCheckoutOtpCurrent) {
  const scope = scopeOf(rawScope, current), request = checkoutEmailOtpDeliveryRequestSchema.parse(rawRequest), now = nowOf(current);
  if (current.stored.version !== request.expectedVersion || current.stored.customer?.email_verified === true) return review();
  const inspected = await trackedReference(tx, scope, current);
  if (request.deliveryId !== inspected.reference.deliveryId) return review();
  const claimed = await claimCheckoutEmailOtpDelivery(tx, inspected.reference, now);
  if (claimed.status !== "claimed") return checkoutEmailOtpDeliveryClaimSchema.parse({ kind: "settled", ...ack(scope, request.deliveryId, current.stored.version, claimed.status) });
  return checkoutEmailOtpDeliveryClaimSchema.parse({ kind: "claimed", version: 1, ...scope, deliveryId: request.deliveryId,
    persistenceVersion: current.stored.version, claimToken: claimed.claimToken, email: inspected.email,
    code: inspected.customer.otp_code, expiresAt: inspected.reference.expiresAt });
}

/** Independent from current prices/contact: record only the old scoped send's
 * outcome. Never promote identity or mutate customer/revision/cart/version. */
export async function completeWidgetCheckoutEmailOtpDelivery(tx: Prisma.TransactionClient, rawScope: unknown, rawRequest: unknown, current: WidgetCheckoutOtpCompletionCurrent) {
  const scope = scopeOf(rawScope, current), request = checkoutEmailOtpDeliveryCompletionSchema.parse(rawRequest);
  const inspected = await inspectCheckoutEmailOtpDelivery(tx, scope, request.deliveryId, current.receipt.eventId);
  const status = await completeCheckoutEmailOtpDelivery(tx, inspected.reference, request.claimToken, request.outcome, current.now);
  return ack(scope, request.deliveryId, current.stored.version, status);
}

/** A lost provider ACK does not invalidate possession of the correct current
 * code. Origin + current UUID/email + TTL policy + durable attempt still apply.
 * Legacy challenges without tracking retain the independent legacy OTP policy. */
export async function requireWidgetCheckoutEmailOtpAttemptForVerify(tx: Prisma.TransactionClient, rawScope: unknown, current: WidgetCheckoutOtpCurrent) {
  const scope = scopeOf(rawScope, current);
  if (!hasTracking(current.stored.customer)) return;
  const inspected = await trackedReference(tx, scope, current);
  if (!["otp_sending", "otp_sent", "otp_unknown"].includes(inspected.row.status)) return review();
}

/** Contact correction is permitted to leave a previous uncertain attempt intact.
 * Root clears the customer tracking/code fields atomically with identity change. */
export async function invalidatePendingWidgetCheckoutEmailOtpForChangedEmail(tx: Prisma.TransactionClient, rawScope: unknown, current: WidgetCheckoutOtpCurrent) {
  const scope = scopeOf(rawScope, current);
  if (!hasTracking(current.stored.customer)) return;
  const inspected = await trackedReference(tx, scope, current);
  if (inspected.row.status === "otp_pending") await invalidatePendingCheckoutEmailOtpDelivery(tx, inspected.reference);
}
