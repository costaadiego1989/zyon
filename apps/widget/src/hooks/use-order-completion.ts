import { useEffect, useRef, useState } from "react";
import type { CheckoutExperienceSnapshot, CurrencyCode } from "@aacp/shared-types";
import { buildEmptyCompletedExperience } from "./checkout-presentation.js";
import type { VisibleCartState } from "./checkout-presentation.js";
import { emitCheckoutEvent } from "../lib/merchant-checkout-shell.js";

type UseOrderCompletionInput = {
  checkoutStage: string;
  sessionId?: string;
  merchantId: string;
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
      window.parent?.postMessage(
        {
          type: "aacp:order-completed",
          merchant_id: merchantId,
          session_id: sessionId ?? null,
        },
        "*",
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
    syncExperience,
    visibleItems,
    visibleTotals,
  ]);

  return { completedOrderSnapshot };
}
