import { useEffect, useRef, useState } from "react";
import type { SuggestedProduct } from "@zyon/shared-types";

export type PrePaymentStep = "cross_sell" | "coupon_gate" | "coupon_entry" | "payment_method";

type UseCheckoutPrePaymentInput = {
  checkoutStage: string;
  sessionId?: string;
  visibleTotals: { discount: number };
  showCardForm: boolean;
  showCryptoPanel: boolean;
  couponBoxEnabled: boolean;
  suggestedProducts: SuggestedProduct[];
  appendAgentTurn: (text: string, options?: { stream?: boolean }) => void;
};

export function useCheckoutPrePayment({
  checkoutStage,
  sessionId,
  visibleTotals,
  showCardForm,
  showCryptoPanel,
  couponBoxEnabled,
  suggestedProducts,
  appendAgentTurn,
}: UseCheckoutPrePaymentInput) {
  const [crossSellDismissed, setCrossSellDismissed] = useState(false);
  const [couponInputVisible, setCouponInputVisible] = useState(false);
  const [prePaymentStep, setPrePaymentStep] = useState<PrePaymentStep>("cross_sell");
  const couponGatePromptedKey = useRef<string | null>(null);
  const paymentMethodPromptedKey = useRef<string | null>(null);

  const couponGateEnabled =
    checkoutStage === "payment" &&
    couponBoxEnabled &&
    visibleTotals.discount === 0 &&
    !showCardForm &&
    !showCryptoPanel;

  const showCouponBox =
    checkoutStage === "payment" &&
    couponBoxEnabled &&
    visibleTotals.discount === 0 &&
    !showCardForm &&
    !showCryptoPanel &&
    (prePaymentStep === "coupon_entry" || couponInputVisible);

  const showOfferBanner = visibleTotals.discount > 0;

  useEffect(() => {
    if (checkoutStage !== "payment") {
      setPrePaymentStep("cross_sell");
      setCouponInputVisible(false);
      setCrossSellDismissed(false);
      couponGatePromptedKey.current = null;
      paymentMethodPromptedKey.current = null;
      return;
    }

    if (prePaymentStep === "cross_sell" && (crossSellDismissed || suggestedProducts.length === 0)) {
      const nextStep = couponGateEnabled ? "coupon_gate" : "payment_method";
      setPrePaymentStep(nextStep);
      if (nextStep === "coupon_gate") {
        const promptKey = sessionId ?? "payment";
        if (couponGatePromptedKey.current !== promptKey) {
          couponGatePromptedKey.current = promptKey;
          appendAgentTurn("Antes de liberar PIX ou cartao, voce tem algum cupom?", { stream: true });
        }
      } else if (nextStep === "payment_method") {
        const promptKey = sessionId ?? "payment";
        if (paymentMethodPromptedKey.current !== promptKey) {
          paymentMethodPromptedKey.current = promptKey;
          appendAgentTurn("Agora escolha como prefere pagar: PIX, cartao ou crypto.", { stream: true });
        }
      }
      return;
    }

    if (prePaymentStep === "coupon_gate" && !couponGateEnabled) {
      setPrePaymentStep("payment_method");
    }
  }, [
    appendAgentTurn,
    checkoutStage,
    couponGateEnabled,
    crossSellDismissed,
    prePaymentStep,
    sessionId,
    suggestedProducts.length,
  ]);

  function dismissCrossSell(): void {
    setCrossSellDismissed(true);
  }

  function proceedFromCrossSell(appendMessage: (text: string) => void): void {
    dismissCrossSell();
    appendMessage("Perfeito. Vamos finalizar seu pagamento.");
  }

  function resetAfterCompletion(): void {
    setCrossSellDismissed(true);
    setCouponInputVisible(false);
    setPrePaymentStep("cross_sell");
  }

  return {
    prePaymentStep,
    setPrePaymentStep,
    crossSellDismissed,
    couponInputVisible,
    setCouponInputVisible,
    couponGateEnabled,
    showCouponBox,
    showOfferBanner,
    dismissCrossSell,
    proceedFromCrossSell,
    resetAfterCompletion,
  };
}
