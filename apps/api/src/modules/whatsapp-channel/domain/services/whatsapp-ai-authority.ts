export interface AiAnchor { checkoutSessionId: string | null; conversationId: string; revision: string }
export interface AiConversationSnapshot extends AiAnchor {
  merchantId: string; configId: string; whatsappSessionId: string; deviceId: string;
  buyerPhone: string; provider: string; accountId: string | null;
  binding: { id: string; epoch: number; mode: "ai" | "waiting_human" | "human" } | null;
}
export interface OriginalAiAuthority extends AiAnchor {
  version: 1; merchantId: string; configId: string; whatsappSessionId: string; inboxId: string;
  bindingId: string | null; epoch: number; deviceId: string; buyerPhone: string; provider: string; accountId: string | null;
}
export interface OwnContextReceipt {
  version: 1; inboxId: string; authority: Readonly<OriginalAiAuthority>;
  from: Readonly<AiAnchor>; to: Readonly<AiAnchor>;
}

const authorityKeys = ["version", "merchantId", "configId", "whatsappSessionId", "inboxId", "bindingId", "epoch",
  "checkoutSessionId", "conversationId", "revision", "deviceId", "buyerPhone", "provider", "accountId"] as const;
const identityKeys = ["merchantId", "configId", "whatsappSessionId", "deviceId", "buyerPhone", "provider", "accountId"] as const;
const anchorKeys = ["checkoutSessionId", "conversationId", "revision"] as const;
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const id = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
const nullableId = (value: unknown): value is string | null => value === null || id(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));

function validAuthority(value: unknown): value is OriginalAiAuthority {
  const row = record(value);
  return !!row && exactKeys(row, authorityKeys) && row.version === 1
    && ["merchantId", "configId", "whatsappSessionId", "inboxId", "conversationId", "deviceId"].every(key => id(row[key]))
    && nullableId(row.checkoutSessionId) && nullableId(row.bindingId) && nullableId(row.accountId)
    && Number.isSafeInteger(row.epoch) && Number(row.epoch) >= 0 && Number(row.epoch) <= 2_147_483_647
    && (row.bindingId !== null || row.epoch === 0) && typeof row.revision === "string" && row.revision.length <= 512
    && typeof row.buyerPhone === "string" && /^\+\d{8,15}$/.test(row.buyerPhone)
    && typeof row.provider === "string" && ["META_CLOUD", "TWILIO", "BUBBLEWHATS"].includes(row.provider);
}
function validAnchor(value: unknown): value is AiAnchor {
  const row = record(value);
  return !!row && exactKeys(row, anchorKeys) && nullableId(row.checkoutSessionId) && id(row.conversationId)
    && typeof row.revision === "string" && row.revision.length <= 512;
}
function sameAnchor(left: AiAnchor, right: AiAnchor): boolean { return anchorKeys.every(key => left[key] === right[key]); }
function sameAuthority(left: OriginalAiAuthority, right: OriginalAiAuthority): boolean { return authorityKeys.every(key => left[key] === right[key]); }
function anchor(value: AiAnchor): Readonly<AiAnchor> {
  return Object.freeze({ checkoutSessionId: value.checkoutSessionId, conversationId: value.conversationId, revision: value.revision });
}

/** Restore only the original versioned server snapshot. There is no fallback
 * to a caller's current epoch or an origin flag in a model/buyer payload. */
export function readAiAuthority(value: unknown): Readonly<OriginalAiAuthority> | undefined {
  return validAuthority(value) ? Object.freeze({ ...value }) : undefined;
}

/** The caller holds the canonical identity/session lock and verified lease.
 * This pure function never creates a binding or supplies that SQL proof. */
export function captureAiAuthority(current: AiConversationSnapshot, inboxId: string): Readonly<OriginalAiAuthority> {
  if (current.binding && current.binding.mode !== "ai") throw new Error("whatsapp_ai_paused");
  const value = readAiAuthority({ version: 1, merchantId: current.merchantId, configId: current.configId, whatsappSessionId: current.whatsappSessionId,
    inboxId, bindingId: current.binding?.id ?? null, epoch: current.binding?.epoch ?? 0, deviceId: current.deviceId,
    buyerPhone: current.buyerPhone, provider: current.provider, accountId: current.accountId,
    checkoutSessionId: current.checkoutSessionId, conversationId: current.conversationId, revision: current.revision });
  if (!value) throw new Error("whatsapp_ai_authority_invalid");
  return value;
}

/** Build only after a successful canonical state CAS, and persist it in that
 * same transaction. Eligibility later requires its persisted copy, not this
 * object in memory. The original authority is deliberately unchanged. */
export function createOwnContextReceipt(original: OriginalAiAuthority, target: AiAnchor): Readonly<OwnContextReceipt> {
  const authority = readAiAuthority(original);
  if (!authority || !validAnchor(target)) throw new Error("whatsapp_ai_context_receipt_invalid");
  return Object.freeze({ version: 1, inboxId: authority.inboxId, authority, from: anchor(authority), to: anchor(target) });
}

export function readOwnContextReceipt(raw: unknown, original: OriginalAiAuthority): Readonly<OwnContextReceipt> | undefined {
  const receipt = record(raw);
  if (!receipt || !exactKeys(receipt, ["version", "inboxId", "authority", "from", "to"]) || receipt.version !== 1
    || receipt.inboxId !== original.inboxId || !validAuthority(receipt.authority) || !sameAuthority(receipt.authority, original)
    || !validAnchor(receipt.from) || !sameAnchor(receipt.from, original) || !validAnchor(receipt.to)) return;
  return createOwnContextReceipt(original, receipt.to);
}

export function matchesAiAuthority(current: AiConversationSnapshot, raw: OriginalAiAuthority, persistedReceipt?: unknown): boolean {
  const original = readAiAuthority(raw);
  if (!original || !identityKeys.every(key => current[key] === original[key])) return false;
  if (original.bindingId === null) {
    if (current.binding !== null || original.epoch !== 0) return false;
  } else if (!current.binding || current.binding.mode !== "ai" || current.binding.id !== original.bindingId || current.binding.epoch !== original.epoch) return false;
  if (persistedReceipt === undefined) return sameAnchor(current, original);
  const receipt = readOwnContextReceipt(persistedReceipt, original);
  if (!receipt) return false;
  return sameAnchor(current, receipt.to);
}
