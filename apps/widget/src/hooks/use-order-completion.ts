import { useEffect, useRef, useState } from "react";
import type { CheckoutExperienceSnapshot, CurrencyCode } from "@zyon/shared-types";
import { buildEmptyCompletedExperience } from "./checkout-presentation.js";
import type { VisibleCartState } from "./checkout-presentation.js";
import { emitCheckoutEvent } from "../lib/merchant-checkout-shell.js";

type UseOrderCompletionInput = {
  checkoutStage: string;
  sessionId?: string;
  merchantId: string;
  /** P2: storeUrl is used as postMessage targetOrigin to prevent leaking
   *  session/tenant identifiers to arbitrary frames. */
  storeUrl?: string;
  activeExperience: CheckoutExperienceSnapshot;
  currency: CurrencyCode;
  visibleItems: VisibleCartState["items"];
  visibleTotals: VisibleCartState["totals"];
  isBuyerSession: boolean;
  syncExperience: (experience: CheckoutExperienceSnapshot) => void;
  resetCart: (currency?: CurrencyCode) => void;
  resetChat: () => void;
  resetPanels: () => void;
  resetPrePayment: () => void;
  clearPersistedSession: () => void;
  loginFromCheckout: (sessionId: string, merchantId: string) => Promise<unknown>;
  refreshBuyerHub: () => Promise<unknown>;
  authSession: { global_user_id?: string } | null;
};

export function useOrderCompletion({
  checkoutStage,
  sessionId,
  merchantId,
  storeUrl,
  activeExperience,
  currency,
  visibleItems,
  visibleTotals,
  isBuyerSession,
  syncExperience,
  resetCart,
  resetChat,
  resetPanels,
  resetPrePayment,
  clearPersistedSession,
  loginFromCheckout,
  refreshBuyerHub,
  authSession,
}: UseOrderCompletionInput) {
  const [completedOrderSnapshot, setCompletedOrderSnapshot] = useState<VisibleCartState | null>(null);
  const orderCompletionHandled = useRef(false);

  // P2: re-arm the completion guard when checkout stage leaves "completed"
  // (e.g. after session/cart reset for a subsequent order in the same mount).
  useEffect(() => {
    if (checkoutStage !== "completed") {
      orderCompletionHandled.current = false;
    }
  }, [checkoutStage]);

  useEffect(() => {
    if (checkoutStage !== "completed" || orderCompletionHandled.current) return;
    orderCompletionHandled.current = true;

    setCompletedOrderSnapshot({
      items: [...visibleItems],
      totals: { ...visibleTotals },
    });

    syncExperience(buildEmptyCompletedExperience(activeExperience, currency));
    resetCart(currency);
    resetChat();
    resetPanels();
    resetPrePayment();
    clearPersistedSession();

    emitCheckoutEvent("order_completed");
    if (typeof window !== "undefined") {
      // P2: restrict targetOrigin to the known storefront origin so session_id
      // and merchant_id are never delivered to arbitrary parent frames.
      // Falls back to the current origin when storeUrl is not configured.
      let targetOrigin = "*";
      if (storeUrl) {
        try {
          targetOrigin = new URL(storeUrl).origin;
        } catch {
          // malformed storeUrl — fall back to wildcard (logged to ease debugging)
          if (typeof console !== "undefined") {
            console.warn("[aacp] use-order-completion: invalid storeUrl for postMessage targetOrigin:", storeUrl);
          }
        }
      }
      window.parent?.postMessage(
        {
          type: "aacp:order-completed",
          merchant_id: merchantId,
          session_id: sessionId ?? null,
        },
        targetOrigin,
      );
    }

    window.setTimeout(() => {
      void loginFromCheckout(sessionId ?? "", merchantId).finally(() => {
        if (isBuyerSession || authSession?.global_user_id) {
          void refreshBuyerHub();
        }
      });
    }, 600);
  }, [
    activeExperience,
    authSession?.global_user_id,
    checkoutStage,
    clearPersistedSession,
    currency,
    isBuyerSession,
    loginFromCheckout,
    merchantId,
    refreshBuyerHub,
    resetCart,
    resetChat,
    resetPanels,
    resetPrePayment,
    sessionId,
    storeUrl,
    syncExperience,
    visibleItems,
    visibleTotals,
  ]);

  return { completedOrderSnapshot };
}
