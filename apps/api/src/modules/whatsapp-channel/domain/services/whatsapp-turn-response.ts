import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { readOwnContextReceipt, readAiAuthority, type OriginalAiAuthority } from "./whatsapp-ai-authority.js";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Shared by normal saves, atomic session application and failure paths. A
 * stale worker must never erase/replace the server's original authority or
 * the receipts committed by a writer/callback. Existing commercial fields
 * remain the response's own payload. No absent legacy token is synthesized. */
export function mergeWhatsAppTurnResponse(previous: Record<string, unknown>, response: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...response };
  let authority: Readonly<OriginalAiAuthority> | undefined;
  for (const source of [previous, response]) {
    if (!Object.hasOwn(source, "aiAuthority")) continue;
    const restored = readAiAuthority(source.aiAuthority);
    if (!restored) throw new Error("whatsapp_ai_authority_invalid");
    if (authority && canonicalJson(restored) !== canonicalJson(authority)) throw new Error("whatsapp_ai_authority_conflict");
    authority = restored;
  }
  if (authority) merged.aiAuthority = authority;
  for (const key of ["ownContextReceipt", "aiEffectReceipt"] as const) {
    let receipt: unknown;
    for (const source of [previous, response]) {
      if (!Object.hasOwn(source, key)) continue;
      if (!authority) throw new Error("whatsapp_ai_authority_required");
      const row = record(source[key]);
      const valid = key === "ownContextReceipt" ? !!readOwnContextReceipt(row, authority) : !!row && Object.keys(row).length === 3
        && row.version === 1 && row.inboxId === authority.inboxId && canonicalJson(row.authority) === canonicalJson(authority);
      if (!valid) throw new Error(key === "ownContextReceipt" ? "whatsapp_ai_context_receipt_invalid" : "whatsapp_ai_effect_receipt_invalid");
      if (receipt && canonicalJson(receipt) !== canonicalJson(row)) throw new Error("whatsapp_ai_context_receipt_conflict");
      receipt = row;
    }
    if (receipt) merged[key] = receipt;
  }
  if (previous.receipts) merged.receipts = previous.receipts;
  const sent = new Map<number, unknown>();
  for (const source of [response, previous]) {
    if (!Array.isArray(source.sent)) continue;
    for (const value of source.sent) {
      const item = record(value);
      if (item && Number.isSafeInteger(item.index)) sent.set(Number(item.index), value);
    }
  }
  if (response.presentation) merged.sent = [...sent.values()];
  if (response.phase === "dispatching" && sent.has(Number(response.dispatchingIndex))) merged.phase = "prepared";
  return merged;
}
