import { createHash } from "node:crypto";
import { canonicalJson } from "../../../shared/http/canonical-json.js";
import { whatsappE164 } from "../../whatsapp-channel/domain/services/whatsapp-phone.js";
import { mergeOperatorDelivery, type OperatorOutboxRow } from "../../whatsapp-channel/domain/services/whatsapp-operator-delivery.js";
import type { WhatsAppSupportDelivery } from "@zyon/shared-types";

export const STAFF_ALERT_REQUESTED = "whatsapp.support.case_alert.requested";
export const STAFF_ALERT_PREFIX = "support_case_alert:";
export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 191 && !/[\u0000-\u001f\u007f]/.test(value);
const epoch = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
export function staffAlertId(merchantId: string, ticketId: string, creationEpoch: number): string {
  if (!id(merchantId) || !id(ticketId) || !epoch(creationEpoch)) throw new Error("staff_alert_identity_invalid");
  return STAFF_ALERT_PREFIX + createHash("sha256").update(canonicalJson([merchantId, ticketId, creationEpoch])).digest("hex");
}
export function staffAlertLink(ticketId: string, base = process.env.DASHBOARD_PUBLIC_URL || "https://app.zyon-payments.com.br"): string {
  if (!id(ticketId)) throw new Error("staff_alert_ticket_invalid");
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.search) throw new Error("staff_alert_dashboard_url_invalid");
  url.hash = "whatsapp-seller?tab=conversations&ticketId=" + encodeURIComponent(ticketId);
  return url.toString();
}
export interface StaffAlertAuthority {
  merchantId: string; ticketId: string; bindingId: string; creationEpoch: number;
  configId: string; whatsappSessionId: string; deviceId: string; provider: string;
  recipient: string | null; settingsVersion: number; accountId: string | null; credentialDigest: string | null;
  providerAccountId?: string; sender?: string;
}
export interface StaffAlertProof {
  eventId: string; merchantId: string; alertId: string; ticketId: string; bindingId: string; creationEpoch: number;
  leaseToken: string; payloadDigest: string;
}
export function parseStaffAlertDispatch(input: unknown): Readonly<StaffAlertProof> | undefined {
  const event = object(input), payload = object(event.payload);
  if (event.eventType !== STAFF_ALERT_REQUESTED || event.schemaVersion !== 1 || !id(event.eventId) || !id(event.merchantId) || !id(event.deliveryLeaseToken)
    || !id(payload.ticketId) || !id(payload.bindingId) || !epoch(payload.creationEpoch) || Object.keys(payload).length !== 4
    || payload.alertId !== staffAlertId(event.merchantId, payload.ticketId, payload.creationEpoch)
    || event.correlationId !== payload.alertId || event.causationId !== payload.ticketId) return;
  return Object.freeze({ eventId: event.eventId, merchantId: event.merchantId, alertId: payload.alertId as string, ticketId: payload.ticketId,
    bindingId: payload.bindingId, creationEpoch: payload.creationEpoch, leaseToken: event.deliveryLeaseToken, payloadDigest: canonicalJson(payload) });
}
export function ownsStaffAlertDispatch(proof: StaffAlertProof, row: OperatorOutboxRow | null, now: Date): boolean {
  return !!row && row.eventId === proof.eventId && row.merchantId === proof.merchantId && row.producer === "support"
    && row.eventType === STAFF_ALERT_REQUESTED && row.schemaVersion === 1 && row.correlationId === proof.alertId && row.causationId === proof.ticketId
    && row.status === "processing" && row.leaseToken === proof.leaseToken && row.leaseExpiresAt instanceof Date
    && Number.isFinite(now.getTime()) && row.leaseExpiresAt.getTime() > now.getTime() && canonicalJson(row.payload) === proof.payloadDigest;
}
export type StaffAlertDelivery = WhatsAppSupportDelivery | { status: "unavailable"; revision: number; providerMessageId: null; errorCode?: string };
export type StaffAlertCandidate = Omit<WhatsAppSupportDelivery, "revision"> | { status: "unavailable"; providerMessageId: null; errorCode?: string };
const statuses = new Set(["queued", "accepted", "unavailable", "failed", "unknown", "delivered", "read"]);
export function publicStaffAlert(input: unknown): { status: StaffAlertDelivery["status"]; revision: number } | undefined {
  const row = object(input);
  if (!statuses.has(String(row.status)) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0) return;
  return { status: row.status as StaffAlertDelivery["status"], revision: Number(row.revision) };
}
export function mergeStaffAlert(current: StaffAlertDelivery, incoming: StaffAlertCandidate): StaffAlertDelivery {
  if (current.status === "unavailable") return { ...current };
  if (incoming.status === "unavailable") return current.status === "queued" ? { ...incoming, revision: current.revision + 1 } : { ...current };
  return mergeOperatorDelivery(current, incoming).state;
}
export function staffWindowOpen(inbound: unknown, a: Pick<StaffAlertAuthority, "merchantId" | "configId" | "deviceId" | "provider" | "recipient" | "accountId" | "providerAccountId" | "sender">, now: Date): boolean {
  const row = object(inbound), payload = object(row.payload), account = object(payload.authenticatedAccount), timestamp = payload.timestamp;
  if (!a.recipient || row.merchantId !== a.merchantId || row.configId !== a.configId || row.deviceId !== a.deviceId || row.kind !== "message"
    || payload.ignored === true || payload.merchantId !== a.merchantId || payload.deviceId !== a.deviceId || payload.provider !== a.provider
    || typeof payload.fromNumber !== "string" || whatsappE164(payload.fromNumber) !== a.recipient
    || !Number.isSafeInteger(timestamp) || Number(timestamp) < 0 || !(row.createdAt instanceof Date)) return false;
  if (account.provider !== a.provider || (a.provider === "META_CLOUD" ? !a.accountId || account.accountId !== a.accountId
    : a.provider === "TWILIO" ? !a.providerAccountId || account.accountId !== a.providerAccountId || !a.sender || account.sender !== a.sender : true)) return false;
  const age = now.getTime() - Math.min(Number(timestamp), row.createdAt.getTime());
  return Number.isFinite(age) && row.createdAt.getTime() <= now.getTime() && age >= 0 && age < 24 * 60 * 60 * 1000;
}
export interface StaffTemplate { id: string; revision: number; wabaId: string; language: string; body: string; variableMap: Record<string, string>; contentSid: string }
export function staffTemplateSnapshot(value: unknown, merchantId: string, wabaId: string, now: Date): StaffTemplate | undefined {
  const t = object(value), variables = object(t.metaVariableMap), checked = t.metaLastCheckedAt;
  if (!id(t.id) || t.merchantId !== merchantId || t.type !== "support_case_alert" || t.channel !== "whatsapp" || t.isActive !== true || t.metaStatus !== "approved"
    || t.metaWabaId !== wabaId || t.metaCategory !== "UTILITY" || !id(t.metaLanguage) || !epoch(t.metaRevision) || !id(t.twilioContentSid)
    || typeof t.metaTemplateBody !== "string" || !t.metaTemplateBody.trim() || t.metaTemplateBody.length > 1024
    || !t.metaTemplateBody.includes("{{1}}") || !t.metaTemplateBody.includes("{{2}}") || /[{}]/.test(t.metaTemplateBody.replace(/\{\{[12]\}\}/g, ""))
    || !(checked instanceof Date) || now.getTime() < checked.getTime() || now.getTime() - checked.getTime() >= 15 * 60_000
    || canonicalJson(variables) !== canonicalJson({ "1": "storeName", "2": "dashboardLink" })) return;
  return { id: t.id, revision: t.metaRevision, wabaId, language: t.metaLanguage, body: t.metaTemplateBody,
    variableMap: { "1": "storeName", "2": "dashboardLink" }, contentSid: t.twilioContentSid };
}
