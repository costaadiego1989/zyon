import type { CheckoutSession } from "./checkout-session";
import { CheckoutApiError } from "./checkout-api-error";

/** Signed API wire response; this widget deliberately keeps its transport types local. */
export interface CashbackCheckoutQuote {
  merchantId: string;
  sessionId: string;
  programActive: boolean;
  eligible: boolean;
  reason: string | null;
  availableCents: number;
  maximumRedeemCents: number;
  reservedCents: number;
  estimatedEarnCents: number;
  ruleVersion: number | null;
  fingerprint: string;
  terms: string | null;
}

export function parseCashbackQuote(value: unknown, merchantId: string, sessionId: string): CashbackCheckoutQuote {
  if (typeof value !== "object" || value === null) throw new Error("cashback_quote_invalid");
  const row = value as Record<string, unknown>;
  if (row.merchantId !== merchantId || row.sessionId !== sessionId) throw new Error("cashback_quote_scope_mismatch");
  if ([row.availableCents, row.maximumRedeemCents, row.reservedCents, row.estimatedEarnCents].some(amount => typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)
      || typeof row.programActive !== "boolean" || typeof row.eligible !== "boolean" || typeof row.fingerprint !== "string"
      || row.reason !== null && typeof row.reason !== "string" || row.terms !== null && typeof row.terms !== "string"
      || row.ruleVersion !== null && (!Number.isSafeInteger(row.ruleVersion) || (row.ruleVersion as number) < 1)) throw new Error("cashback_quote_invalid");
  return row as unknown as CashbackCheckoutQuote;
}

export async function requestCashback(api: CheckoutSession, operation: "quote" | "reserve" | "remove", input?: { amountCents?: number; idempotencyKey?: string }, signal?: AbortSignal): Promise<CashbackCheckoutQuote> {
  const sessionId = api.currentSessionId;
  if (!sessionId) throw new Error("session_not_started");
  const capability = api as CheckoutSession & { readonly isPaymentObservation?: boolean };
  if (operation !== "quote" && capability.isPaymentObservation) throw new Error("checkout_payment_observation_only");
  const response = await fetch(`${api.embedApiBaseUrl || api.apiBaseUrl}/embed/cashback/${operation}`, {
    method: "POST", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.authToken}` },
    body: JSON.stringify({ session_id: sessionId, ...(operation === "reserve" ? { amount_cents: input?.amountCents } : {}),
      ...(operation !== "quote" ? { idempotency_key: input?.idempotencyKey } : {}) }),
  });
  if (!response.ok) throw await CheckoutApiError.fromResponse("cashback", response);
  if (api.currentSessionId !== sessionId) throw new Error("checkout_changed");
  return parseCashbackQuote(await response.json(), api.currentMerchantId, sessionId);
}
