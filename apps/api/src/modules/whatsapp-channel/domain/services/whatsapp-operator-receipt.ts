import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import type { WhatsAppChannelConfigEntity } from "../ports/whatsapp-config-repository.port.js";
import { twilioAuthorityAccountId } from "./connected-twilio-credentials.js";
import { whatsappE164 } from "./whatsapp-phone.js";

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\s\u0000-\u001f\u007f]/.test(value);
const accountSid = (value: unknown): value is string => typeof value === "string" && /^AC[0-9a-fA-F]{32}$/.test(value);
const correlation = (value: unknown): value is string => id(value) && value.startsWith("support_message:") && value.length > "support_message:".length;
export interface OperatorReceipt {
  provider: "META_CLOUD" | "TWILIO"; providerAccountId: string; providerMessageId: string;
  status: "accepted" | "delivered" | "read" | "failed"; correlationId?: string; recipient?: string; sender?: string;
}
export function parseMetaOperatorReceipt(providerAccountId: unknown, input: unknown): OperatorReceipt | undefined {
  const row = object(input); if (!row || !id(providerAccountId) || !id(row.id)) return;
  const status = row.status === "sent" ? "accepted" : row.status;
  if (status !== "accepted" && status !== "delivered" && status !== "read" && status !== "failed") return;
  if (row.biz_opaque_callback_data !== undefined && !correlation(row.biz_opaque_callback_data)) return;
  const recipient = row.recipient_id === undefined ? undefined : typeof row.recipient_id === "string" ? whatsappE164(row.recipient_id) : null;
  if (recipient === null) return;
  return { provider: "META_CLOUD", providerAccountId, providerMessageId: row.id, status,
    ...(row.biz_opaque_callback_data !== undefined ? { correlationId: row.biz_opaque_callback_data as string } : {}), ...(recipient ? { recipient } : {}) };
}
/** The existing signature validator's contract is a complete flat form. Never
 * coerce arrays, drop unknown signed fields or treat query fields as form data. */
export function readTwilioReceiptForm(input: unknown): Record<string, string> | undefined {
  const row = object(input); if (!row) return;
  const entries = Object.entries(row); if (entries.length === 0 || entries.length > 64) return;
  let size = 0;
  for (const [key, value] of entries) {
    if (!id(key) || key.length > 128 || typeof value !== "string" || value.length > 8192 || /[\u0000]/.test(value)) return;
    size += key.length + value.length; if (size > 65_536) return;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}
function twilioNumber(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("whatsapp:+")) return;
  const raw = value.slice("whatsapp:".length), number = whatsappE164(raw); return number === raw ? number : undefined;
}
export function parseTwilioOperatorReceipt(input: unknown): OperatorReceipt | undefined {
  const row = readTwilioReceiptForm(input); if (!row || !accountSid(row.AccountSid)
    || !/^(SM|MM)[0-9a-fA-F]{32}$/.test(row.MessageSid ?? "") || row.ChannelPrefix !== undefined && row.ChannelPrefix !== "whatsapp") return;
  const status = ["queued", "accepted", "sending", "sent"].includes(row.MessageStatus) ? "accepted" : row.MessageStatus === "undelivered" ? "failed" : row.MessageStatus;
  if (status !== "accepted" && status !== "delivered" && status !== "read" && status !== "failed") return;
  const recipient = row.To === undefined ? undefined : twilioNumber(row.To), sender = row.From === undefined ? undefined : twilioNumber(row.From);
  if (row.To !== undefined && !recipient || row.From !== undefined && !sender) return;
  return { provider: "TWILIO", providerAccountId: row.AccountSid, providerMessageId: row.MessageSid, status,
    ...(recipient ? { recipient } : {}), ...(sender ? { sender } : {}) };
}
export interface OriginalOperatorAttempt {
  attemptToken: string; outboxEventId: string; outboxLeaseToken: string; credentialDigest: string;
  providerAccountId?: string; sender?: string;
}
export function readOriginalOperatorAttempt(response: unknown, processingToken: string): Readonly<OriginalOperatorAttempt> | undefined {
  const row = object(response), attempt = object(row?.submission);
  if (!row || !attempt || !id(attempt.attemptToken) || attempt.attemptToken !== processingToken
    || !id(attempt.outboxEventId) || attempt.outboxEventId !== row.outboxEventId || !id(attempt.outboxLeaseToken)
    || typeof attempt.credentialDigest !== "string" || !/^[0-9a-f]{64}$/.test(attempt.credentialDigest)
    || typeof attempt.phase !== "string" || !["preparing", "started", "accepted", "delivered", "read", "failed", "unknown"].includes(attempt.phase)
    || attempt.requestInvoked !== undefined && attempt.requestInvoked !== true
    || attempt.phase !== "preparing" && attempt.phase !== "started" && attempt.requestInvoked !== true
    || attempt.commitUnknown !== undefined && typeof attempt.commitUnknown !== "boolean"
    || attempt.providerAccountId !== undefined && !id(attempt.providerAccountId)
    || attempt.sender !== undefined && (typeof attempt.sender !== "string" || whatsappE164(attempt.sender) !== attempt.sender)) return;
  return Object.freeze({ attemptToken: attempt.attemptToken, outboxEventId: attempt.outboxEventId, outboxLeaseToken: attempt.outboxLeaseToken,
    credentialDigest: attempt.credentialDigest, ...(typeof attempt.providerAccountId === "string" ? { providerAccountId: attempt.providerAccountId } : {}),
    ...(typeof attempt.sender === "string" ? { sender: attempt.sender } : {}) });
}
export function operatorReceiptAccountMatches(original: { provider: string; accountId: string; recipient: string }, attempt: OriginalOperatorAttempt,
  config: WhatsAppChannelConfigEntity, receipt: OperatorReceipt): boolean {
  if (original.provider !== receipt.provider || config.provider !== receipt.provider || receipt.recipient !== undefined && receipt.recipient !== original.recipient
    || attempt.providerAccountId !== undefined && attempt.providerAccountId !== receipt.providerAccountId) return false;
  if (receipt.provider === "META_CLOUD") return original.accountId === receipt.providerAccountId;
  const account = /^twilio:account:(AC[0-9a-fA-F]{32}):[0-9a-f]{64}$/.exec(original.accountId)?.[1];
  if (!account || account !== receipt.providerAccountId) return false;
  let sender = attempt.sender;
  if (!sender) {
    // Older attempts did not store the sender separately. Exact original
    // credential identity can prove it; a rotated/current config cannot fill it.
    const c = config.credentials;
    const digest = createHash("sha256").update(canonicalJson({ provider: "TWILIO", accountSid: c.accountSid,
      authToken: c.authToken, senderId: c.senderId, whatsappNumber: config.whatsappNumber })).digest("hex");
    if (twilioAuthorityAccountId(config) !== original.accountId || digest !== attempt.credentialDigest) return false;
    sender = twilioNumber(c.senderId);
  }
  return !!sender && (receipt.sender === undefined || receipt.sender === sender);
}
