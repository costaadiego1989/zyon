import type { CommerceTurnResult, Message, CrossSellInterstitialData, ProductCrossSellPlacement, ConversationAttachment } from "@/lib/viewmodels/useConversationViewModel/types";
import { narrateStorefrontBlock, trackFunnelEvent } from "@/lib/services/conversation.service";
import { checkoutApi } from "@/lib/api/api-client";
import { getValidBuyer } from "@/lib/buyer-auth";
import { ConversationSessionExpiredError, ensureConversationAccess } from "@/lib/conversation-access";
import type { StorefrontReadUiAction } from "@zyon/shared-types";
import { cloneStorefrontReadUiAction } from "@/lib/storefront-read-ui-action";
import { parseSuggestedReadActions } from "@/lib/storefront-suggested-read-actions";
import type { CartLineSelection } from "@/lib/cart-line-selection";
import type { ConversationStart } from "@/lib/scoped-conversation";

export interface SendMessageParams {
  trimmed: string;
  attachment?: ConversationAttachment;
  uiAction?: StorefrontReadUiAction;
  voiceTurnToken?: string;
  conversationId: string | null;
  setConversationId: (id: string) => void;
  clearCart: () => void;
  merchantId: string | null;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  cartId: string | null | undefined;
  variantId: string | undefined;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setHistory: (value: any[] | ((prev: any[]) => any[])) => void;
  setIsLoading: (value: boolean) => void;
  setInput: (value: string) => void;
  setCrossSellPending: (data: CrossSellInterstitialData | null) => void;
  setProductCrossSell: (data: ProductCrossSellPlacement | null) => void;
  updateFromBlocks: (blocks: any[]) => void;
  /** Conversation lifecycle, independent of the mutable cart snapshot. */
  isCurrent?: () => boolean;
  /** Captured, one-use cart projection capability; missing means deny. */
  applyCartProjection?: (blocks: any[]) => boolean;
  noteActivity: (merchantId: string) => void;
  onCheckoutPrepared: (action: {
    actionId: string;
    cartId: string;
    shippingPreference: "fastest" | "cheapest";
    paymentPreference: "pix" | "card";
  }) => void;
}

export async function handleSendMessage(params: SendMessageParams): Promise<CommerceTurnResult | null> {
  const uiAction = params.uiAction === undefined ? undefined : cloneStorefrontReadUiAction(params.uiAction);
  const {
    trimmed,
    attachment,
    conversationId,
    merchantId,
    history,
    cartId,
    variantId,
    noteActivity,
  } = params;
  const isCurrent = params.isCurrent ?? (() => true);
  const setMessages: SendMessageParams["setMessages"] = (updater) => {
    if (isCurrent()) params.setMessages((previous) => isCurrent() ? updater(previous) : previous);
  };
  const setHistory: SendMessageParams["setHistory"] = (value) => {
    if (isCurrent()) params.setHistory((previous) => isCurrent()
      ? (typeof value === "function" ? value(previous) : value) : previous);
  };
  const setIsLoading = (value: boolean) => { if (isCurrent()) params.setIsLoading(value); };
  const setInput = (value: string) => { if (isCurrent()) params.setInput(value); };
  const setCrossSellPending: SendMessageParams["setCrossSellPending"] = (value) => { if (isCurrent()) params.setCrossSellPending(value); };
  const setProductCrossSell: SendMessageParams["setProductCrossSell"] = (value) => { if (isCurrent()) params.setProductCrossSell(value); };

  if ((!trimmed && !attachment) || !merchantId || !isCurrent()) return null;

  try {
    let convId = conversationId;
    if ((!convId && (cartId || history.length || params.voiceTurnToken))
      || (cartId && convId && cartId !== convId)) {
      // A proof, cart or previous turn cannot migrate to a newly created
      // identity. Only explicit owner-backed recovery may resolve this state.
      throw new ConversationSessionExpiredError();
    }
    if (!convId && merchantId) {
      const startData = await checkoutApi.create({ merchantId });
      if (!isCurrent()) return null;
      if (startData?.conversation_id) {
        convId = startData.conversation_id;
        params.setConversationId(startData.conversation_id);
      }
    }
    if (!isCurrent()) return null;
    if (!convId) return null;
    // Renew the original identity before consuming the buyer's draft. A failed
    // preflight must not append an unsent turn, reset a cart or move a voice proof.
    // Empty-session replacement belongs to the shared owner, not this handler.
    await ensureConversationAccess(convId);
    if (!isCurrent()) return null;
    noteActivity(merchantId);
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text: trimmed,
      attachment: attachment ? { kind: attachment.kind, name: attachment.name } : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    const newHistory = [...history, { role: "user" as const, content: trimmed }];
    setHistory(newHistory);
    if (convId && merchantId) {
      const requestOptions = {
        merchantId,
        cartId: cartId || undefined,
        history: newHistory,
        variantId: variantId || undefined,
        attachment,
        uiAction,
        voiceTurnToken: params.voiceTurnToken,
        token: getValidBuyer()?.token,
      };
      // Expiry/uncertainty never creates another identity or resends a possibly
      // mutating turn. Explicit recovery must preserve the original reference.
      const data = await checkoutApi.sendMessage(convId, trimmed, requestOptions);
      if (!isCurrent()) return null;

      if (data) {
        if (data.conversation_id !== undefined && data.conversation_id !== convId) {
          throw new Error("conversation_response_mismatch");
        }
        const responseBlocks = Array.isArray(data.blocks) ? [...data.blocks] : [];
        // Evaluate once: our accepted cart_summary changes the cart version but
        // must not invalidate this response's transcript or prepared checkout.
        const projectionAccepted = params.applyCartProjection?.(responseBlocks) === true;
        if (!isCurrent()) return null;
        const blocks = projectionAccepted ? responseBlocks : responseBlocks.filter((block: any) =>
          !["cart_summary", "checkout_prepared", "cross_sell"].includes(block?.type));
        if (data.suggested_next?.length) {
          blocks.push({ type: "quick_replies", data: { options: data.suggested_next } });
        }
        const suggestedActions = data.conversation_id === convId ? parseSuggestedReadActions(data.suggested_actions) : null;
        if (suggestedActions?.items.length) {
          blocks.push({ type: "quick_replies", data: { options: [], suggestedActions } });
        }
        const preparedCheckout = blocks.find((block: any) => block.type === "checkout_prepared")?.data;
        if (
          isCurrent()
          && typeof preparedCheckout?.actionId === "string"
          && typeof preparedCheckout?.cartId === "string"
          && (preparedCheckout?.shippingPreference === "fastest" || preparedCheckout?.shippingPreference === "cheapest")
          && (preparedCheckout?.paymentPreference === "pix" || preparedCheckout?.paymentPreference === "card")
        ) {
          params.onCheckoutPrepared(preparedCheckout);
        }

        const crossSellBlock = blocks.find((b: any) => b.type === "cross_sell" && b.data?.products?.length);
        const cartGrew = blocks.some((b: any) => b.type === "cart_summary");
        const crossSellMode = (crossSellBlock?.data as any)?.displayMode ?? "interstitial";
        const productBlock = blocks.find((b: any) => b.type === "product_content" || b.type === "product_card");
        const productId = productBlock?.type === "product_content" ? productBlock.data?.productId : productBlock?.data?.id;
        const isProductDetailOffer = typeof productId === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(productId);
        if (crossSellBlock && isProductDetailOffer) {
          // `pre_cart` is the product-detail touchpoint. Keep its offer with
          // the product instead of covering the details with a global sheet.
          setProductCrossSell({ productId, data: crossSellBlock.data as CrossSellInterstitialData });
          const idx = blocks.indexOf(crossSellBlock);
          if (idx !== -1) blocks.splice(idx, 1);
        } else if (crossSellBlock && (cartGrew || crossSellMode === "modal")) {
          // Gap B fix: honor the merchant's configured display mode.
          // Cart and checkout offers use the configured overlay when appropriate.
          // Product-detail offers are rendered in the product panel above.
          // interstitial/modal -> overlay sheet (setCrossSellPending, remove inline block).
          // inline/banner -> keep the block in the thread so BlockRenderer renders
          // it inline (the CrossSellBlock reads displayMode to style banner vs inline).
          if (crossSellMode === "interstitial" || crossSellMode === "modal") {
            setCrossSellPending(crossSellBlock.data as CrossSellInterstitialData);
            const idx = blocks.indexOf(crossSellBlock);
            if (idx !== -1) blocks.splice(idx, 1);
          }
          // else: leave the cross_sell block inline; BlockRenderer -> CrossSellBlock handles it.
        }
        if (isCurrent() && conversationId && merchantId) {
          const hasCart = blocks.some((b: any) => b.type === "cart_summary");
          const hasProducts = blocks.some((b: any) => ["product_carousel", "product_card", "marketplace_products"].includes(b.type));
          if (hasCart) {
            trackFunnelEvent(merchantId, conversationId, "add_to_cart");
          } else if (hasProducts) {
            trackFunnelEvent(merchantId, conversationId, "product_viewed");
          }
        }
        const hasVisualBlock = blocks.some((b: any) =>
          ["product_carousel", "product_card", "cart_summary", "category_carousel", "product_comparison", "wishlist", "shipping_options", "marketplace_products"].includes(b.type)
        );
        let agentText = data.message || undefined;
        if (!agentText && hasVisualBlock) {
          const firstVisual = blocks.find((b: any) =>
            ["product_carousel", "product_card", "cart_summary", "category_carousel", "product_comparison", "wishlist", "shipping_options", "marketplace_products", "cross_sell"].includes(b.type)
          );
          agentText = narrateStorefrontBlock(firstVisual?.type);
        }
        const agentMsg: Message = {
          id: `a-${Date.now()}`,
          role: "agent",
          text: agentText,
          blocks,
        };
        setMessages((prev) => [...prev, agentMsg]);
        setHistory((prev) => [...prev, { role: "assistant", content: data.message }]);
        setIsLoading(false);
        return { agentMessage: agentText || "Atualizei sua compra. Posso continuar?", blocks };
      } else {
        setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "agent", text: "Não consegui confirmar o resultado da solicitação. Verifique o carrinho antes de enviar outra ação." }]);
      }
    } else {
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "agent", text: `Entendi, "${trimmed}". Deixa eu verificar para você...` }]);
    }
  } catch (error) {
    if (!isCurrent()) return null;
    const text = error instanceof ConversationSessionExpiredError
      ? "A sessão precisa ser validada. Sua solicitação não foi reenviada automaticamente. Verifique o carrinho antes de continuar."
      : "Não consegui confirmar o resultado da solicitação. Verifique o carrinho antes de enviar outra ação.";
    setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "agent", text }]);
  }
  setIsLoading(false);
  return null;
}

export interface QuickReplyParams {
  budgetModeEnabled?: boolean;
  option: string;
  uiAction?: StorefrontReadUiAction;
  cartItemCount: number;
  merchantId: string | null;
  conversationId: string | null;
  sendMessage: (text: string, attachment?: ConversationAttachment, uiAction?: StorefrontReadUiAction) => Promise<CommerceTurnResult | null>;
  setCartDrawerForceOpen: (value: boolean) => void;
  setCheckoutIntent: (value: string | null) => void;
  setShowBuyerAuth: (value: boolean) => void;
}

export function handleQuickReply(params: QuickReplyParams) {
  const { option, cartItemCount, merchantId, conversationId, sendMessage, setCartDrawerForceOpen, setCheckoutIntent, setShowBuyerAuth } = params;

  if (params.uiAction !== undefined) {
    const uiAction = cloneStorefrontReadUiAction(params.uiAction);
    void sendMessage(option, undefined, uiAction).catch((err) => {
      console.error("[conversation] quick-reply sendMessage failed:", err);
    });
    return;
  }

  const lower = option.trim().toLowerCase();
  if (lower === "meus dados") {
    window.dispatchEvent(new Event("aacp:open-buyer-hub"));
    return;
  }
  if (lower === "ver carrinho" || lower === "ver meu carrinho") {
    setCartDrawerForceOpen(true);
    setTimeout(() => setCartDrawerForceOpen(false), 100);
    return;
  }
  if (lower === "solicitar orçamento" || lower === "solicitar cotação" || (params.budgetModeEnabled && (lower === "finalizar compra" || lower === "finalizar pedido"))) {
    setCartDrawerForceOpen(true);
    setTimeout(() => setCartDrawerForceOpen(false), 100);
    return;
  }
  if (lower === "finalizar compra" || lower === "finalizar pedido") {
    setCartDrawerForceOpen(true);
    setTimeout(() => setCartDrawerForceOpen(false), 100);
    if (merchantId && conversationId) {
      trackFunnelEvent(merchantId, conversationId, "checkout_intent");
    }
    const buyer = getValidBuyer();
    if (buyer) {
      setCheckoutIntent(buyer.globalUserId);
    } else {
      setShowBuyerAuth(true);
    }
    return;
  }
  if (lower === "aplicar cupom" && cartItemCount === 0) {
    void sendMessage("Quero aplicar um cupom de desconto").catch((err) => {
      console.error("[conversation] coupon sendMessage failed:", err);
    });
    return;
  }
  void sendMessage(option).catch((err) => {
    console.error("[conversation] quick-reply sendMessage failed:", err);
  });
}

export interface UpdateQuantityParams {
  variantId: string;
  quantity: number;
  cartId: string | null;
  merchantId: string | null;
  selection?: CartLineSelection;
  updateItemQuantity: (variantId: string, quantity: number, selection?: CartLineSelection) => Promise<void>;
}

export async function handleUpdateQuantity(params: UpdateQuantityParams) {
  const { variantId, quantity, cartId, merchantId, updateItemQuantity, selection } = params;

  if (!cartId || !merchantId) return;
  try {
    await updateItemQuantity(variantId, quantity, selection);
  } catch (err) {
    console.error("[cart] server sync failed:", err);
  }
}

export interface InitConversationParams {
  merchantId: string | undefined;
  conversationId: string | null;
  cartId: string | null | undefined;
  setConversationId: (id: string) => void;
  captureFromConversationStart: (data: { conversation_id: string; experiment: any }) => void;
  setExperimentGreeting: (message: string, suggestedNext?: string[]) => void;
  isCurrent?: () => boolean;
  ensureConversation?: () => Promise<ConversationStart>;
}

export async function initConversation(params: InitConversationParams) {
  const { merchantId, conversationId, cartId, setConversationId, captureFromConversationStart, setExperimentGreeting } = params;
  const isCurrent = params.isCurrent ?? (() => true);

  if (!merchantId || conversationId || !isCurrent()) return;
  try {
    const data = params.ensureConversation ? await params.ensureConversation() : await checkoutApi.create({ merchantId });
    if (!isCurrent() || !data?.conversation_id) return;

    const convId = data.conversation_id;
    setConversationId(convId);
    if (!isCurrent()) return;
    try {
      sessionStorage.setItem("zyon_conversation_id", convId);
    } catch {}
    captureFromConversationStart({ conversation_id: convId, experiment: data.experiment || null });
    trackFunnelEvent(merchantId, convId, "conversation_started");

    if (!data.experiment?.system_prompt) return;
    checkoutApi
      .sendMessage(convId, "olá", { merchantId, cartId: cartId || undefined, history: [] })
      .then((greetingData) => {
        if (isCurrent() && greetingData?.message) setExperimentGreeting(greetingData.message, greetingData.suggested_next);
      })
      .catch(() => {});
  } catch {}
}

export { handleFireNudge } from "./conversation-nudge.handlers";
export type { FireNudgeParams } from "./conversation-nudge.handlers";
