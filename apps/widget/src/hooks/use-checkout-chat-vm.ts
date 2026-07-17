import { useMemo } from "react";
import type { ShippingQuote, SuggestedProduct } from "@zyon/shared-types";
import type { WidgetConfig } from "../lib/widget-types.js";
import { stageNarrative } from "./checkout-presentation.js";
import { useCheckoutChat } from "./use-checkout-chat.js";
import type { CheckoutSessionState } from "./use-checkout-session.js";
import type { useCheckoutPanels } from "./use-checkout-panels.js";
import type { useCheckoutPrePayment } from "./use-checkout-pre-payment.js";

export type CheckoutChatVMDeps = {
  config: WidgetConfig;
  sessionState: CheckoutSessionState;
  panels: ReturnType<typeof useCheckoutPanels>;
  prePayment: ReturnType<typeof useCheckoutPrePayment>;
};

/**
 * Chat-layer sub-VM: wires useCheckoutChat, derives stage fields, and
 * encapsulates addSuggestedProduct / submitCoupon / tapShippingOption / retry
 * business logic that previously lived in the monolithic VM.
 */
export function useCheckoutChatVM(deps: CheckoutChatVMDeps) {
  const { config, sessionState, panels, prePayment } = deps;

  const chatState = useCheckoutChat(config, sessionState, {
    purchaseChannel: panels.purchaseChannel,
  });

  const { checkoutStage, composerLocked, streamingTurnKey, awaitingAgentPlayback } = chatState;
  const offer = chatState.lastChat?.authorized_offer;
  const currentMissingField = chatState.lastChat?.missing_fields?.[0];
  const stageNote = stageNarrative(checkoutStage, currentMissingField);

  const shippingOptions: ShippingQuote[] = useMemo(
    () => chatState.lastChat?.experience?.shippingOptions ?? [],
    [chatState.lastChat?.experience?.shippingOptions],
  );

  // --- actions -----------------------------------------------------------

  async function addSuggestedProduct(product: SuggestedProduct): Promise<boolean> {
    const { session, networkError } = sessionState;
    if (!session || networkError || chatState.busy) return false;

    let added = false;
    let agentAlreadyReplied = false;

    if (chatState.isCartEmpty && product.sku) {
      added = config.mode === "embed" ? await chatState.addCatalogProduct(product) : false;
      agentAlreadyReplied = added;
    } else if (config.mode === "embed" && product.suggestion_id) {
      added = await chatState.acceptCrossSell(product);
      agentAlreadyReplied = added;
      if (!added && product.sku) {
        added = await chatState.addCatalogProduct(product);
        agentAlreadyReplied = added;
      }
    } else if (config.mode === "embed" && product.sku) {
      added = await chatState.addCatalogProduct(product);
      agentAlreadyReplied = added;
    }

    if (!added) {
      await chatState.sendMessageWithOverride(`Quero adicionar: ${product.name}`);
      added = !sessionState.networkError;
      agentAlreadyReplied = added;
    }

    if (added) {
      prePayment.dismissCrossSell();
      if (!agentAlreadyReplied) {
        chatState.appendAgentTurn(`Perfeito! ${product.name} foi adicionado ao seu pedido.`, {
          stream: true,
        });
      }
    } else {
      sessionState.setNetworkError?.("Falha ao adicionar o produto. Tente novamente em instantes.");
    }
    return added;
  }

  function proceedFromCrossSell(): void {
    prePayment.proceedFromCrossSell((text) =>
      chatState.appendAgentTurn(text, { stream: true }),
    );
  }

  async function submitCoupon(): Promise<void> {
    const applied = await chatState.submitCoupon();
    if (!applied) return;
    prePayment.setCouponInputVisible(false);
    prePayment.setPrePaymentStep("payment_method");
    chatState.appendAgentTurn("Desconto aplicado. Agora escolha PIX, cartao ou crypto para concluir.", {
      stream: true,
    });
  }

  async function tapShippingOption(option: ShippingQuote): Promise<void> {
    const { session, networkError } = sessionState;
    if (!session || networkError || chatState.busy) return;
    // Note: applyShipping must be called by the consumer (VM orchestrator)
    // because it belongs to the cart sub-state, not chat.
    await chatState.sendMessageWithOverride(option.method || "Selecionar frete");
  }

  function retryStartCheckout(): void {
    chatState.retryChat();
  }

  return {
    chatState,
    checkoutStage,
    composerLocked,
    streamingTurnKey,
    awaitingAgentPlayback,
    offer,
    currentMissingField,
    stageNote,
    shippingOptions,
    addSuggestedProduct,
    proceedFromCrossSell,
    submitCoupon,
    tapShippingOption,
    retryStartCheckout,
  };
}
