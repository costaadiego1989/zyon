import type { CheckoutSession } from "@/api/checkout-session";

export type CheckoutEventName =
  | "checkout_started"
  | "channel_selected"
  | "cart_viewed"
  | "item_quantity_updated"
  | "item_removed"
  | "shipping_selected"
  | "payment_method_selected"
  | "payment_intent_created"
  | "payment_confirmed"
  | "order_completed"
  | "checkout_abandoned";

let api: CheckoutSession | null = null;
let sessionId: string | null = null;

export function initTracking(apiInstance: CheckoutSession, session: string) {
  api = apiInstance;
  sessionId = session;
}

export async function trackEvent(
  event: CheckoutEventName,
  data?: Record<string, unknown>
): Promise<void> {
  if (!api || !sessionId) return;
  try {
    // Fire and forget — tracking should never block UI
    void fetch(`${api.apiBaseUrl}/embed/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${api.authToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        event_name: event,
        event_data: data ?? {},
      }),
    });
  } catch {
    // Silent fail — tracking is best-effort
  }
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
