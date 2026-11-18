import type { TenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { authorizeWhatsAppOperator, WhatsAppOperatorAuthorizationError, type WhatsAppOperatorTicket } from "./whatsapp-operator-authorization.js";
import type { HandoffScope, HandoffState } from "./whatsapp-handoff-state.js";
import { whatsappE164 } from "./whatsapp-phone.js";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";

export const WHATSAPP_RESUME_REQUESTED = "whatsapp.support.resume.requested";
// Sender adapters use text verbatim. Fix formatting before intent/digest,
// never after the final request-start fence or differently during replay.
export const WHATSAPP_RESUME_TEXT = "🤖 *Atendimento humano concluído*\n\nA assistente virtual está disponível novamente.\nSeu carrinho continua preservado.";
export const whatsappResumeDeliveryId = (bindingId: string, epoch: number) => `support_resume:${bindingId}:${epoch}`;
export type WhatsAppCloseStatus = "closed" | "resolved";
export interface WhatsAppClosePlan {
  replay: boolean; previousEpoch: number; epoch: number; status: WhatsAppCloseStatus;
}
const validId = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 191;
const validEpoch = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;

/** Pure candidate only. Exact replay still requires the original durable
 * human_resume command/message/outbox proof inside the retained locks. */
export function prepareWhatsAppClose(scope: HandoffScope, binding: Readonly<HandoffState> | null,
  ticket: WhatsAppOperatorTicket, principal: TenantPrincipal, expectedEpoch: number, status: WhatsAppCloseStatus): Readonly<WhatsAppClosePlan> {
  if (principal.kind !== "human" || !["owner", "admin", "staff"].includes(principal.role) || principal.tenantId !== scope.merchantId)
    throw new WhatsAppOperatorAuthorizationError("forbidden", "human_operator_required");
  if (!validEpoch(expectedEpoch) || !["closed", "resolved"].includes(status))
    throw new WhatsAppOperatorAuthorizationError("conflict", "whatsapp_handoff_epoch_conflict");
  if (!binding || ![scope.merchantId, scope.configId, scope.whatsappSessionId, binding.id, ticket.id, principal.userId].every(validId) || !validEpoch(binding.epoch)
    || binding.merchantId !== scope.merchantId || binding.configId !== scope.configId || binding.whatsappSessionId !== scope.whatsappSessionId
    || binding.ticketId !== ticket.id || ticket.merchantId !== scope.merchantId || ticket.sessionId !== scope.whatsappSessionId || ticket.source !== "whatsapp" || ticket.mergedIntoId !== null)
    throw new WhatsAppOperatorAuthorizationError("not_found", "whatsapp_case_not_found");
  if (binding.mode === "ai" && ticket.status === status && binding.assignedOperatorId === null
    && ticket.assignedTo === principal.userId && Number.isSafeInteger(binding.epoch) && binding.epoch > 0
    && (expectedEpoch === binding.epoch || expectedEpoch === binding.epoch - 1))
    return Object.freeze({ replay: true, previousEpoch: binding.epoch - 1, epoch: binding.epoch, status });
  authorizeWhatsAppOperator(scope, binding, ticket, principal);
  if (expectedEpoch !== binding.epoch || binding.epoch === 2_147_483_647)
    throw new WhatsAppOperatorAuthorizationError("conflict", "whatsapp_handoff_epoch_conflict");
  return Object.freeze({ replay: false, previousEpoch: binding.epoch, epoch: binding.epoch + 1, status });
}

/** This is not an operator message authority or an AI/webhook turn. */
export interface WhatsAppResumeAuthority extends HandoffScope {
  bindingId: string; ticketId: string; operatorId: string; previousEpoch: number; epoch: number;
  deviceId: string; provider: string; recipient: string | null; accountId: string | null;
  identityStatus: "available" | "unavailable";
}
/** Unavailable is a durable no-start disposition, not permission to adopt a
 * newly connected account when the same intent is later delivered/replayed. */
export function initialResumeDelivery(identityStatus: WhatsAppResumeAuthority["identityStatus"]) {
  return Object.freeze({ status: identityStatus === "available" ? "queued" as const : "failed" as const,
    revision: 0, providerMessageId: null,
    ...(identityStatus === "unavailable" ? { errorCode: "channel_identity_unavailable" } : {}) });
}
export interface WhatsAppResumeDispatch {
  eventId: string; leaseToken: string; merchantId: string; deliveryId: string; messageId: string;
  ticketId: string; bindingId: string; previousEpoch: number; epoch: number; payloadDigest: string;
}
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;
/** Only the new durable resume purpose is recognized here. A human operator
 * message event, AI turn or body-supplied epoch never becomes this authority. */
export function parseResumeDispatch(input: unknown): Readonly<WhatsAppResumeDispatch> | undefined {
  const event = record(input), payload = record(event?.payload);
  if (!event || !payload || event.eventType !== WHATSAPP_RESUME_REQUESTED || event.schemaVersion !== 1
    || !validId(event.eventId) || !validId(event.merchantId) || !validId(event.deliveryLeaseToken)
    || !validId(payload.messageId) || !validId(payload.ticketId) || !validId(payload.bindingId)
    || Object.keys(payload).length !== 5 || !["messageId", "ticketId", "bindingId", "previousEpoch", "epoch"].every(key => Object.hasOwn(payload, key))
    || !validEpoch(payload.previousEpoch) || !validEpoch(payload.epoch) || payload.epoch !== payload.previousEpoch + 1
    || event.correlationId !== whatsappResumeDeliveryId(payload.bindingId, payload.epoch) || event.causationId !== payload.messageId) return;
  return Object.freeze({ eventId: event.eventId, leaseToken: event.deliveryLeaseToken, merchantId: event.merchantId,
    deliveryId: event.correlationId, messageId: payload.messageId, ticketId: payload.ticketId, bindingId: payload.bindingId,
    previousEpoch: payload.previousEpoch, epoch: payload.epoch, payloadDigest: canonicalJson(payload) });
}
export interface ResumeOutboxRow {
  eventId: string; eventType: string; merchantId: string; schemaVersion: number; correlationId: string; causationId: string;
  producer: string; payload: unknown; status: string; leaseToken: string | null; leaseExpiresAt: Date | null;
}
export function ownsResumeDispatch(proof: WhatsAppResumeDispatch, row: ResumeOutboxRow | null, now: Date): boolean {
  return Boolean(row && row.eventId === proof.eventId && row.eventType === WHATSAPP_RESUME_REQUESTED && row.schemaVersion === 1
    && row.merchantId === proof.merchantId && row.producer === "support" && row.correlationId === proof.deliveryId && row.causationId === proof.messageId
    && row.status === "processing" && row.leaseToken === proof.leaseToken && row.leaseExpiresAt instanceof Date
    && Number.isFinite(now.getTime()) && row.leaseExpiresAt.getTime() > now.getTime() && canonicalJson(row.payload) === proof.payloadDigest);
}

/** New handoff/claim, renewal, wrong config or old closed ticket never gains
 * resumed-notice authority. The actual dispatcher must call this at both
 * preparation and synchronous request initiation while retaining the locks. */
export function currentResumeCase(authority: Readonly<WhatsAppResumeAuthority>, binding: Readonly<HandoffState> | null,
  ticket: WhatsAppOperatorTicket, session: { id: string; merchantId: string; deviceId: string; status: string; buyerPhone: string }): boolean {
  return Boolean(authority.identityStatus === "available" && validId(authority.accountId) && typeof authority.recipient === "string"
    && whatsappE164(authority.recipient) === authority.recipient
    && validEpoch(authority.previousEpoch) && validEpoch(authority.epoch) && binding && binding.id === authority.bindingId && binding.merchantId === authority.merchantId && binding.configId === authority.configId
    && binding.whatsappSessionId === authority.whatsappSessionId && binding.ticketId === authority.ticketId && binding.mode === "ai"
    && binding.epoch === authority.epoch && binding.assignedOperatorId === null && authority.epoch === authority.previousEpoch + 1
    && ticket.id === authority.ticketId && ticket.merchantId === authority.merchantId && ticket.sessionId === authority.whatsappSessionId
    && ticket.source === "whatsapp" && ticket.mergedIntoId === null && ["closed", "resolved"].includes(ticket.status)
    && ticket.assignedTo === authority.operatorId && session.id === authority.whatsappSessionId && session.merchantId === authority.merchantId && session.deviceId === authority.deviceId
    && session.status === "active" && whatsappE164(session.buyerPhone) === authority.recipient);
}
