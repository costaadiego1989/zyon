import type { CheckoutSession } from "@/api/checkout-session";

export type CheckoutEventName =
  | "checkout_started"
  | "channel_selected"
  | "cart_viewed"
  | "item_quantity_updated"
  | "item_removed"
  | "shipping_option_selected"
  | "payment_method_selected"
  | "order_completed"
  | "checkout_abandoned"
  // Behavioral triggers (also tracked as events)
  | "idle_30_seconds"
  | "exit_intent_detected"
  | "shipping_objection_detected"
  | "coupon_field_clicked"
  | "payment_failed";

let api: CheckoutSession | null = null;
let sessionId: string | null = null;

export function initTracking(apiInstance: CheckoutSession, session: string) {
  api = apiInstance;
  sessionId = session;
}

export interface TrackEventResult {
  progressive_offer?: {
    stage: string;
    approved_percent: number;
    reason: string;
  };
}

export async function trackEvent(
  event: CheckoutEventName,
  data?: Record<string, unknown>
): Promise<TrackEventResult | undefined> {
  if (!api || !sessionId) return undefined;
  try {
    const res = await fetch(`${api.apiBaseUrl}/embed/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${api.authToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        event,
        metadata: data ?? {},
      }),
    });
    if (res.ok) return (await res.json()) as TrackEventResult;
  } catch {
    // Silent fail — tracking is best-effort
  }
  return undefined;
}

// Abandonment detection
export function setupAbandonmentTracking(): () => void {
  const handler = () => {
    trackEvent("checkout_abandoned", {
      timestamp: new Date().toISOString(),
      url: window.location.href,
    });
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}
