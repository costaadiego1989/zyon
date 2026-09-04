import type { Message, CrossSellInterstitialData } from "@/lib/viewmodels/useConversationViewModel/types";
import { narrateStorefrontBlock, trackFunnelEvent } from "@/lib/services/conversation.service";
import { checkoutApi, cartApi } from "@/lib/api/api-client";
import { getValidBuyer } from "@/lib/buyer-auth";

export interface SendMessageParams {
  trimmed: string;
  conversationId: string | null;
  merchantId: string | null;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  cartId: string | null | undefined;
  variantId: string | undefined;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setHistory: (value: any[] | ((prev: any[]) => any[])) => void;
  setIsLoading: (value: boolean) => void;
  setInput: (value: string) => void;
  setCrossSellPending: (data: CrossSellInterstitialData | null) => void;
  updateFromBlocks: (blocks: any[]) => void;
  noteActivity: (merchantId: string) => void;
}

export async function handleSendMessage(params: SendMessageParams) {
  const {
    trimmed,
    conversationId,
    merchantId,
    history,
    cartId,
    variantId,
    setMessages,
    setHistory,
    setIsLoading,
    setInput,
    setCrossSellPending,
    updateFromBlocks,
    noteActivity,
  } = params;

  if (!trimmed) return;
  if (merchantId) noteActivity(merchantId);

  const userMsg: Message = { id: `u-${Date.now()}`, role: "user", text: trimmed };
  setMessages((prev) => [...prev, userMsg]);
  setInput("");
  setIsLoading(true);
  const newHistory = [...history, { role: "user" as const, content: trimmed }];
  setHistory(newHistory);

  try {
    let convId = conversationId;
    if (!convId && merchantId) {
      const startData = await checkoutApi.create({ merchantId });
      if (startData?.conversation_id) {
        convId = startData.conversation_id;
      }
    }
    if (convId && merchantId) {
      const data = await checkoutApi.sendMessage(convId, trimmed, {
        merchantId,
        cartId: cartId || undefined,
        history: newHistory,
        variantId: variantId || undefined,
        token: getValidBuyer()?.token,
      });

      if (data) {
        const blocks = data.blocks ?? [];
        if (data.suggested_next?.length) {
          blocks.push({ type: "quick_replies", data: { options: data.suggested_next } });
        }
        updateFromBlocks(blocks);

        const crossSellBlock = blocks.find((b: any) => b.type === "cross_sell" && b.data?.products?.length);
        const cartGrew = blocks.some((b: any) => b.type === "cart_summary");
        if (crossSellBlock && cartGrew) {
          // Gap B fix: honor the merchant's configured display mode.
          // interstitial/modal -> overlay sheet (setCrossSellPending, remove inline block).
          // inline/banner -> keep the block in the thread so BlockRenderer renders
          // it inline (the CrossSellBlock reads displayMode to style banner vs inline).
          const mode = (crossSellBlock.data as any)?.displayMode ?? "interstitial";
          if (mode === "interstitial" || mode === "modal") {
            setCrossSellPending(crossSellBlock.data as CrossSellInterstitialData);
            const idx = blocks.indexOf(crossSellBlock);
            if (idx !== -1) blocks.splice(idx, 1);
          }
          // else: leave the cross_sell block inline; BlockRenderer -> CrossSellBlock handles it.
        }
        if (conversationId && merchantId) {
          const hasCart = blocks.some((b: any) => b.type === "cart_summary");
          const hasProducts = blocks.some((b: any) => ["product_carousel", "product_card", "marketplace_products"].includes(b.type));
          if (hasCart) {
            trackFunnelEvent(merchantId, conversationId, "add_to_cart");
          } else if (hasProducts) {
            trackFunnelEvent(merchantId, conversationId, "product_viewed");
          }
        }
        const hasVisualBlock = blocks.some((b: any) =>
          ["product_carousel", "product_card", "cart_summary", "category_carousel", "product_comparison", "shipping_options", "marketplace_products"].includes(b.type)
        );
        let agentText = data.message || undefined;
        if (!agentText && hasVisualBlock) {
          const firstVisual = blocks.find((b: any) =>
            ["product_carousel", "product_card", "cart_summary", "category_carousel", "product_comparison", "shipping_options", "marketplace_products", "cross_sell"].includes(b.type)
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
      } else {
        setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "agent", text: "Desculpe, houve um erro. Tente novamente." }]);
      }
    } else {
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "agent", text: `Entendi, "${trimmed}". Deixa eu verificar para você...` }]);
    }
  } catch {
    setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "agent", text: "Não consegui conectar ao servidor. Verifique sua conexão." }]);
  }
  setIsLoading(false);
}

export interface QuickReplyParams {
  option: string;
  cartItemCount: number;
  merchantId: string | null;
  conversationId: string | null;
  sendMessage: (text: string) => Promise<void>;
  setCartDrawerForceOpen: (value: boolean) => void;
  setCheckoutIntent: (value: string | null) => void;
  setShowBuyerAuth: (value: boolean) => void;
}

export function handleQuickReply(params: QuickReplyParams) {
  const { option, cartItemCount, merchantId, conversationId, sendMessage, setCartDrawerForceOpen, setCheckoutIntent, setShowBuyerAuth } = params;

  const lower = option.toLowerCase();
  if (lower === "ver carrinho" || lower === "ver meu carrinho") {
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
  updateItemQuantity: (variantId: string, quantity: number) => void;
}

export function handleUpdateQuantity(params: UpdateQuantityParams) {
  const { variantId, quantity, cartId, merchantId, updateItemQuantity } = params;

  updateItemQuantity(variantId, quantity);
  if (cartId && merchantId) {
    cartApi.updateItem(cartId, variantId, quantity, merchantId).catch((err) => {
      console.error("[cart] server sync failed:", err);
    });
  }
}

export interface InitConversationParams {
  merchantId: string | undefined;
  conversationId: string | null;
  cartId: string | null | undefined;
  setConversationId: (id: string) => void;
  captureFromConversationStart: (data: { conversation_id: string; experiment: any }) => void;
  setExperimentGreeting: (message: string, suggestedNext?: string[]) => void;
}

export async function initConversation(params: InitConversationParams) {
  const { merchantId, conversationId, cartId, setConversationId, captureFromConversationStart, setExperimentGreeting } = params;

  if (!merchantId || conversationId) return;
  try {
    const data = await checkoutApi.create({ merchantId });
    if (!data?.conversation_id) return;

    const convId = data.conversation_id;
    setConversationId(convId);
    try {
      sessionStorage.setItem("zyon_conversation_id", convId);
    } catch {}
    captureFromConversationStart({ conversation_id: convId, experiment: data.experiment || null });
    trackFunnelEvent(merchantId, convId, "conversation_started");

    if (!data.experiment?.system_prompt) return;
    checkoutApi
      .sendMessage(convId, "olá", { merchantId, cartId: cartId || undefined, history: [] })
      .then((greetingData) => {
        if (greetingData?.message) setExperimentGreeting(greetingData.message, greetingData.suggested_next);
      })
      .catch(() => {});
  } catch {}
}

export interface StartListeningParams {
  recognitionRef: { current: any };
  setListening: (value: boolean) => void;
  sendMessage: (text: string) => Promise<void>;
}

export function startVoiceRecognition(params: StartListeningParams) {
  const { recognitionRef, setListening, sendMessage } = params;
  if (typeof window === "undefined") return;
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!SR) return;
  const r = new SR();
  r.lang = "pt-BR";
  r.continuous = false;
  r.maxAlternatives = 1;
  recognitionRef.current = r;
  r.onresult = (e: any) => {
    const transcript = e.results[0]?.[0]?.transcript;
    if (transcript) {
      setListening(false);
      void sendMessage(transcript).catch((err) => {
        console.error("[conversation] voice sendMessage failed:", err);
      });
    }
  };
  r.onerror = () => setListening(false);
  r.onend = () => setListening(false);
  r.start();
  setListening(true);
}

export function stopVoiceRecognition(recognitionRef: { current: any }, setListening: (value: boolean) => void) {
  recognitionRef.current?.abort();
  setListening(false);
}

export { handleFireNudge } from "./conversation-nudge.handlers";
export type { FireNudgeParams } from "./conversation-nudge.handlers";
