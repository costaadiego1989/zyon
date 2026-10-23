import { isDeepStrictEqual } from "node:util";
import { parseWidgetCheckoutPaymentAuthority, type WidgetCheckoutPaymentAuthority } from "./widget-checkout-payment-authority.schemas.js";

type Scope = { id: string; merchantId: string; sessionId: string; amountCents: number; currency: string; method: string;
  amountBreakdown?: unknown; creation?: unknown };
const privateKeys = ["widgetCheckoutAuthority", "widget_checkout_authority", "_widgetCrossSellAcceptance", "widgetCheckoutScope"] as const;
const conflict = (): never => { throw new Error("payment_widget_checkout_authority_conflict"); };

export function assertNoPaymentWidgetCheckoutAuthorityInProviderInput(raw: unknown): void {
  try { if (raw && typeof raw === "object" && privateKeys.some(key => key in raw)) return conflict(); }
  catch { return conflict(); }
}

/** Stored sibling only; a parsed object grants neither new admission nor an
 * own-journal exception. Those require actual scoped persistence under fences. */
export function readPaymentWidgetCheckoutAuthority(scope: Scope): WidgetCheckoutPaymentAuthority | undefined {
  try {
    const creation = scope.creation;
    if (!creation || typeof creation !== "object") return undefined;
    const present = "widgetCheckoutAuthority" in creation;
    const authority = Object.getOwnPropertyDescriptor(creation, "widgetCheckoutAuthority"), inputField = Object.getOwnPropertyDescriptor(creation, "input");
    if (present && (!authority?.enumerable || !("value" in authority) || !inputField?.enumerable || !("value" in inputField))) return conflict();
    const input: unknown = present ? inputField!.value : "input" in creation ? creation.input : undefined;
    assertNoPaymentWidgetCheckoutAuthorityInProviderInput(input);
    if (!present) return undefined;
    const value = parseWidgetCheckoutPaymentAuthority(authority!.value);
    if (value.paymentId !== scope.id || value.merchantId !== scope.merchantId || value.checkoutSessionId !== scope.sessionId
      || value.amountCents !== scope.amountCents || value.currency !== scope.currency || value.method !== scope.method
      || !isDeepStrictEqual(value.amountBreakdown, scope.amountBreakdown) || !input || typeof input !== "object") return conflict();
    if (["merchantId", "sessionId", "amountCents", "currency", "method"].some(key => Reflect.get(input, key) !== Reflect.get(scope, key))
      || Reflect.get(input, "intentId") !== scope.id) return conflict();
    return value;
  } catch { return conflict(); }
}

export function assertSamePaymentWidgetCheckoutAuthority(current: Scope, next: Scope): void {
  if (!isDeepStrictEqual(readPaymentWidgetCheckoutAuthority(current), readPaymentWidgetCheckoutAuthority(next))) return conflict();
}
