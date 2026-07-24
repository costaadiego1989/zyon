import { useEffect, useRef, useState } from "react";
import type { CheckoutExperienceSnapshot, CurrencyCode } from "@zyon/shared-types";
import { buildEmptyCompletedExperience } from "./checkout-presentation.js";
import type { VisibleCartState } from "./checkout-presentation.js";
import { emitCheckoutEvent } from "../lib/merchant-checkout-shell.js";
import { safeOrigin } from "../lib/safe-url.js";

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
      const targetOrigin = safeOrigin(storeUrl);
      if (!targetOrigin) {
        console.warn("[aacp] use-order-completion: skipping sensitive postMessage without valid storeUrl");
      } else {
        window.parent?.postMessage(
          {
            type: "aacp:order-completed",
            merchant_id: merchantId,
            session_id: sessionId ?? null,
          },
          targetOrigin,
        );
      }
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
