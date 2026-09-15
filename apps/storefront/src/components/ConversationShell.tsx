"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { PerimeterBorder } from "../../../widget_v2/src/components/PerimeterBorder";
import { SafeStoreHtml } from "./SafeStoreHtml";
import { useCart } from "@/lib/cart-store";
import { useConversationViewModel, type Message } from "@/lib/viewmodels/useConversationViewModel";
import { getValidBuyer } from "@/lib/buyer-auth";
import BlockRenderer from "./blocks/BlockRenderer";
import RichProductDetailsPanel from "./blocks/RichProductDetailsPanel";
import { BuyerHub } from "./BuyerHub";
import { BuyerHubTrigger } from "./BuyerHubTrigger";
import SupportPanel from "./SupportPanel";
import StoriesRow from "./StoriesRow";
import CheckoutWidgetPanel from "./CheckoutWidgetPanel";
import CheckoutPanel from "./CheckoutPanel";
import WhitelabelBadge from "./WhitelabelBadge";
import BuyerAuthGate from "./BuyerAuthGate";
import CrossSellInterstitial from "./CrossSellInterstitial";
import { PulseAgentOrb } from "./conversation/PulseAgentOrb";
import { THEME_TOKENS, type Theme } from "./conversation/theme-tokens";
import { redirectToCheckout } from "./conversation/checkout-redirect";
import { conversationFetch } from "@/lib/conversation-access";
import { checkoutApi } from "@/lib/api/api-client";
import { useRealtimeVoiceCheckout } from "@/lib/voice/use-realtime-voice-checkout";
import { restoreChannelPreference } from "@/lib/services/conversation.service";
import { RealtimeVoiceComposer } from "./conversation/RealtimeVoiceComposer";

type Channel = "chat" | "voice";
type OneBuyClickState = {
  enabled: boolean;
  status: string;
  shippingPreference: "fastest" | "cheapest";
  paymentPreference: "pix" | "card";
};

type StoreSocialSettings = {
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  youtube?: string;
  googleMaps?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

function renderMarkdownText(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br/>");
  return html;
}

type PresentedVariant = {
  id: string;
  value: string;
  available?: boolean;
};

function normalizeVariantText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsVariantValue(message: string, value: string): boolean {
  const normalizedMessage = normalizeVariantText(message);
  const normalizedValue = normalizeVariantText(value);
  if (!normalizedMessage || !normalizedValue) return false;

  const escapedValue = normalizedValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactValue = new RegExp("(^|\\s)" + escapedValue + "(?=\\s|$)");
  if (exactValue.test(normalizedMessage)) return true;

  const numericValues = value.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numericValues.length !== 1) return false;

  const escapedNumber = numericValues[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactNumber = new RegExp("(^|\\s)" + escapedNumber + "(?=\\s|$)");
  return exactNumber.test(normalizedMessage);
}

function collectProductVariants(blocks: any[]): PresentedVariant[] {
  return blocks.flatMap((block) => {
    if (block?.type === "product_card") return block.data?.variants ?? [];
    if (block?.type === "product_carousel") {
      return (block.data?.products ?? []).flatMap((product: any) => product?.variants ?? []);
    }
    if (block?.type !== "variant_selector" || block.data?.groups?.length !== 1) return [];
    return block.data.groups[0]?.options ?? [];
  }).filter((variant: any): variant is PresentedVariant =>
    typeof variant?.id === "string"
    && typeof variant?.value === "string"
    && (variant.available === undefined || variant.available === true)
    && (variant.stock === undefined || variant.stock > 0),
  );
}

function resolvePresentedVariantId(messages: Message[], buyerText: string): string | undefined {
  const latestCatalogMessage = [...messages]
    .reverse()
    .find((message) => message.role === "agent" && collectProductVariants(message.blocks ?? []).length > 0);

  if (!latestCatalogMessage) return undefined;

  const variants = collectProductVariants(latestCatalogMessage.blocks ?? []);
  const matches = variants
    .filter((variant) => containsVariantValue(buyerText, variant.value));

  if (matches.length === 1) return matches[0].id;

  // "Este produto" is unambiguous only when the latest presentation exposes
  // a single sellable variant. Multiple variants always require a choice.
  const implicitReference = /\b(este|esse|essa|isto|isso|produto|item)\b/i.test(buyerText);
  return implicitReference && variants.length === 1 ? variants[0].id : undefined;
}

function attachPresentedVariantId(text: string, variantId: string | undefined): string {
  return variantId ? `${text.trim()} [variantId:${variantId}]` : text;
}

function renderBuyerMessage(text: string): string {
  // Keep catalog routing metadata in the API/history, outside the visible copy.
  return text.replace(/(?:\s+\[(?:variantId:[A-Za-z0-9_-]{1,191}|optionItemIds:[A-Za-z0-9_,-]+|crossSellPromoId:[A-Za-z0-9_-]{1,191})\])+$/, "");
}

function OneBuyClickToggle({
  placement,
  enabled,
  pending,
  available,
  onToggle,
}: {
  placement: "header" | "mobile-header";
  enabled: boolean;
  pending: boolean;
  available: boolean;
  onToggle: () => void;
}) {
  const compact = placement === "mobile-header";
  return (
    <button
      data-neu="control"
      data-one-buy-click-toggle={placement}
      className={`one-buy-click-toggle one-buy-click-toggle--${placement}`}
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={!available || pending}
      onClick={onToggle}
      title="Ativar compra rápida"
      style={{
        minHeight: "30px",
        width: undefined,
        padding: compact ? "4px 7px" : "4px 9px",
        borderRadius: "999px",
        border: `1px solid ${enabled ? "var(--aacp-accent)" : "var(--aacp-line)"}`,
        background: enabled ? "color-mix(in srgb, var(--aacp-accent) 15%, transparent)" : "var(--aacp-card)",
        color: enabled ? "var(--aacp-fg)" : "var(--aacp-muted)",
        cursor: available ? "pointer" : "wait",
        alignItems: "center",
        justifyContent: undefined,
        gap: "7px",
        flex: "none",
        fontSize: compact ? "9px" : "10px",
        fontWeight: 700,
        opacity: pending ? 0.65 : 1,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "7px" }}>
        <span aria-hidden="true" style={{ width: "14px", height: "8px", padding: "2px", borderRadius: "999px", background: enabled ? "var(--aacp-accent)" : "var(--aacp-line)", display: "flex", justifyContent: enabled ? "flex-end" : "flex-start", alignItems: "center" }}>
          <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--aacp-card)", boxShadow: "0 1px 2px rgba(0,0,0,.24)" }} />
        </span>
        {compact ? "Rápida" : "Compra rápida"}
      </span>
    </button>
  );
}

function StoreSocialLinks({ social }: { social?: StoreSocialSettings }) {
  const links: Array<{ key: keyof StoreSocialSettings; label: string; icon: ReactNode }> = [
    { key: "instagram", label: "Instagram", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg> },
    { key: "facebook", label: "Facebook", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg> },
    { key: "linkedin", label: "LinkedIn", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg> },
    { key: "youtube", label: "YouTube", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.13C5.12 19.56 12 19.56 12 19.56s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z" /><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" /></svg> },
    { key: "googleMaps", label: "Google Maps", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg> },
  ];
  const availableLinks = links.filter((link) => Boolean(social?.[link.key]));

  if (availableLinks.length === 0) return null;

  return (
    <nav className="store-menu__social" aria-label="Redes sociais da loja">
      {availableLinks.map((link) => (
        <a key={link.key} className="store-menu__social-link" href={social?.[link.key]} target="_blank" rel="noopener noreferrer">
          {link.icon}
          <span>{link.label}</span>
        </a>
      ))}
    </nav>
  );
}

export default function ConversationShell({
  storeName,
  logo,
  returnOrderId,
  agentName,
  quickReplies,
  merchantId,
  merchantSlug,
  storeSettings,
  agentGreeting,
  agentAvatarUrl,
  initialStories,
  themeMode,
  showBranding,
  voiceCheckoutEnabled,
  agentMode,
  agentInitialDelaySeconds,
  initialRichProductId,
}: {
  storeName: string;
  logo?: string;
  returnOrderId?: string;
  agentName?: string;
  agentGreeting?: string;
  agentAvatarUrl?: string;
  quickReplies?: string[];
  merchantId?: string;
  merchantSlug?: string;
  initialStories?: any[];
  themeMode?: "dark" | "light" | "grey";
  showBranding?: boolean;
  voiceCheckoutEnabled?: boolean;
  agentMode?: "silent_until_trigger" | "proactive" | "manual_only";
  agentInitialDelaySeconds?: number;
  initialRichProductId?: string;
  storeSettings?: {
    social?: StoreSocialSettings;
    company?: { cnpj?: string; razaoSocial?: string; email?: string; phone?: string; businessHours?: string; address?: { city?: string; state?: string } };
    policies?: { privacy?: string; returns?: string; terms?: string; shipping?: string };
  };
}) {
  const vm = useConversationViewModel({
    storeName,
    merchantId,
    merchantSlug,
    agentName,
    agentGreeting,
    quickReplies,
    returnOrderId,
    themeMode,
    agentMode,
    agentInitialDelaySeconds,
  });
  const {
    mode, channel, theme, messages, input, isLoading,
    conversationId, supportOpen, buyerHubOpen, cartDrawerForceOpen,
    showBuyerAuth, checkoutIntent, policyModal, crossSellPending, preparedCheckout,
    selectChannel, toggleChannel, toggleTheme, ensureConversation, sendMessage,
    handleQuickReply, appendAgentMessage, handleUpdateQuantity, setInput,
    setSupportOpen, setBuyerHubOpen, setShowBuyerAuth, setCheckoutIntent, setPolicyModal,
    setCartDrawerForceOpen, dismissCrossSell, clearPreparedCheckout,
  } = vm;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const presentedProductVariantRef = useRef<string | undefined>(undefined);
  const agent = agentName || "Assistente";
  const { cart } = useCart();
  const realtimeVoice = useRealtimeVoiceCheckout({
    // A product-detail button can start the voice session while the visual
    // conversation is still on chat. This retains the browser user gesture.
    enabled: voiceCheckoutEnabled === true,
    createSession: async () => {
      const activeConversationId = await ensureConversation();
      if (!activeConversationId) throw new Error("conversation_not_ready");
      const response = await conversationFetch(activeConversationId, `${API_BASE}/storefront/conversations/${encodeURIComponent(activeConversationId)}/realtime/session`, { method: "POST" });
      if (!response.ok) {
        const error = new Error("realtime_voice_session_failed") as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      const data = await response.json() as { value?: unknown; expires_at?: unknown };
      if (typeof data.value !== "string") throw new Error("invalid_realtime_voice_session");
      return { value: data.value, ...(typeof data.expires_at === "number" ? { expires_at: data.expires_at } : {}) };
    },
    onCommerceTurn: async (buyerMessage, action) => {
      const selectedVariantId = action === "add_item_to_cart"
        ? presentedProductVariantRef.current ?? resolvePresentedVariantId(messages, buyerMessage)
        : undefined;
      const commerceMessage = action === "add_item_to_cart"
        ? attachPresentedVariantId(`Adicionar ao carrinho: ${buyerMessage}`, selectedVariantId)
        : buyerMessage;
      const result = await sendMessage(commerceMessage);
      return { agentMessage: result?.agentMessage ?? "Não consegui concluir este pedido agora. Pode repetir?", cart: { itemCount: cart.itemCount, total: cart.total } };
    },
    onBeginCheckout: async () => {
      const buyer = getValidBuyer();
      // A visitor can ask to finish immediately after a reload, before the
      // asynchronous one-buy-click state has returned. The locally persisted
      // choice is the same preference the state loader applies to the current
      // conversation, so honor it here instead of showing a redundant login
      // modal. InlineCheckout handles registration itself.
      let quickCheckoutEnabled = oneBuyClickEnabled.current;
      if (!buyer && merchantId) {
        try {
          const savedPreference = localStorage.getItem(`zyon-one-buy-click:${merchantId}`);
          if (savedPreference === "true") quickCheckoutEnabled = true;
          if (savedPreference === "false") quickCheckoutEnabled = false;
        } catch {
          // Storage is optional; the server-backed state above remains valid.
        }
      }
      if (quickCheckoutEnabled) {
        setCheckoutUserId(buyer?.globalUserId ?? "");
        setCheckoutCartRef(cart.cartId ?? undefined);
        setCheckoutPreferences(oneBuyClick?.enabled ? {
          shippingPreference: oneBuyClick.shippingPreference,
          paymentPreference: oneBuyClick.paymentPreference,
        } : undefined);
        setCheckoutOpen(true);
        return { agentMessage: "Abri seu checkout rapido. Voce pode entrar ou concluir o cadastro diretamente na finalizacao." };
      }
      if (!buyer) {
        setShowBuyerAuth(true);
        return { agentMessage: "Para finalizar com segurança, abri o login. Depois da confirmação, seguiremos para o checkout." };
      }
      setCheckoutUserId(buyer.globalUserId);
      setCheckoutCartRef(cart.cartId ?? undefined);
      setCheckoutPreferences(undefined);
      setCheckoutOpen(true);
      return { agentMessage: "Seu checkout foi aberto. Revise os dados e confirme visualmente antes de pagar." };
    },
  });
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutCartRef, setCheckoutCartRef] = useState<string | undefined>(undefined);
  const [checkoutPreferences, setCheckoutPreferences] = useState<Pick<OneBuyClickState, "shippingPreference" | "paymentPreference"> | undefined>(undefined);
  const [oneBuyClick, setOneBuyClick] = useState<OneBuyClickState | null>(null);
  const [oneBuyClickPending, setOneBuyClickPending] = useState(false);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [checkoutUserId, setCheckoutUserId] = useState("");
  const [mounted, setMounted] = useState(false);
  const [welcomeVoiceRequested, setWelcomeVoiceRequested] = useState(false);
  const [richProduct, setRichProduct] = useState<{ productId: string } | null>(() =>
    typeof initialRichProductId === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(initialRichProductId)
      ? { productId: initialRichProductId }
      : null,
  );
  const checkoutInitialChannel = voiceCheckoutEnabled && (channel ?? restoreChannelPreference()) === "voice"
    ? "voice"
    : "chat";
  const openedInitialRichProduct = useRef(false);
  const openedProductMessages = useRef(new Set<string>());
  const promptedProductClose = useRef(new Set<string>());
  const pendingProductCart = useRef<{ variantId: string } | null>(null);
  const openedPreparedActions = useRef(new Set<string>());
  const oneBuyClickEnabled = useRef(false);
  const welcomeVoiceStarted = useRef(false);
  useEffect(() => {
    presentedProductVariantRef.current = undefined;
  }, [richProduct?.productId]);
  useEffect(() => { setMounted(true); }, []);
  const effectiveMode = mounted ? mode : "intro";
  useEffect(() => {
    if (!mounted || voiceCheckoutEnabled !== true || welcomeVoiceStarted.current) return;
    welcomeVoiceStarted.current = true;
    setWelcomeVoiceRequested(true);
    realtimeVoice.start();
  }, [mounted, realtimeVoice.start, voiceCheckoutEnabled]);
  useEffect(() => {
    const requestSummary = (event: Event) => {
      const summary = (event as CustomEvent<{ summary?: unknown }>).detail?.summary;
      if (typeof summary !== "string" || !summary.trim()) return;
      selectChannel("voice");
      realtimeVoice.sendText(`Faça um resumo curto deste produto usando apenas a confirmação do agente comercial: ${summary}`);
    };
    window.addEventListener("zyon:realtime-product-summary", requestSummary);
    return () => window.removeEventListener("zyon:realtime-product-summary", requestSummary);
  }, [realtimeVoice.sendText, selectChannel]);
  useEffect(() => {
    if (voiceCheckoutEnabled !== true && channel === "voice") toggleChannel();
  }, [voiceCheckoutEnabled, channel, toggleChannel]);
  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    const buyer = getValidBuyer();
    const preferenceKey = merchantId ? `zyon-one-buy-click:${merchantId}` : null;
    void checkoutApi.getOneBuyClick(conversationId, buyer?.token).then(async (state) => {
      if (!active) return;
      let visitorChoice: boolean | null = null;
      if (!buyer && preferenceKey) {
        try {
          const saved = localStorage.getItem(preferenceKey);
          visitorChoice = saved === "true" ? true : saved === "false" ? false : null;
        } catch {}
      }
      if (visitorChoice !== null && visitorChoice !== state.enabled) {
        const configured = await checkoutApi.configureOneBuyClick(conversationId, visitorChoice, buyer?.token);
        if (active) setOneBuyClick(configured);
        return;
      }
      if (active) setOneBuyClick(state);
    }).catch(() => {
      if (active) setOneBuyClick(null);
    });
    return () => { active = false; };
  }, [conversationId, merchantId]);
  useEffect(() => {
    oneBuyClickEnabled.current = oneBuyClick?.enabled === true;
  }, [oneBuyClick]);
  const toggleOneBuyClick = async () => {
    if (!conversationId || !oneBuyClick || oneBuyClickPending) return;
    const nextEnabled = !oneBuyClick.enabled;
    oneBuyClickEnabled.current = nextEnabled;
    setOneBuyClickPending(true);
    try {
      const buyer = getValidBuyer();
      const next = await checkoutApi.configureOneBuyClick(conversationId, nextEnabled, buyer?.token);
      setOneBuyClick(next);
      if (!buyer && merchantId) {
        try { localStorage.setItem(`zyon-one-buy-click:${merchantId}`, String(next.enabled)); } catch {}
      }
    } finally {
      setOneBuyClickPending(false);
    }
  };
  useEffect(() => {
    if (!preparedCheckout || openedPreparedActions.current.has(preparedCheckout.actionId)) return;
    if (!oneBuyClick) return;
    if (!oneBuyClickEnabled.current) {
      clearPreparedCheckout();
      return;
    }
    openedPreparedActions.current.add(preparedCheckout.actionId);
    const buyer = getValidBuyer();
    setCheckoutUserId(buyer?.globalUserId ?? "");
    setCheckoutCartRef(preparedCheckout.cartId);
    setCheckoutPreferences({
      shippingPreference: preparedCheckout.shippingPreference,
      paymentPreference: preparedCheckout.paymentPreference,
    });
    setCheckoutOpen(true);
    clearPreparedCheckout();
  }, [preparedCheckout, oneBuyClick, clearPreparedCheckout]);
  useEffect(() => {
    if (!richProduct || openedInitialRichProduct.current) return;
    openedInitialRichProduct.current = true;
    selectChannel("chat");
  }, [richProduct, selectChannel]);
  useEffect(() => {
    const latest = messages.at(-1);
    if (!latest || latest.role !== "agent") return;
    const block = latest.blocks?.find((item) => item.type === "product_content")
      ?? latest.blocks?.find((item) => item.type === "product_card");
    const productId = block?.type === "product_content" ? block.data?.productId : block?.data?.id;
    if (typeof productId !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(productId)) return;
    const key = `${latest.id}:${productId}`;
    if (openedProductMessages.current.has(key)) return;
    if (block?.type === "product_content") {
      openedProductMessages.current.add(key);
      setRichProduct({ productId });
      return;
    }
    // The current agent's get_product_details tool emits product_card. Open
    // its unified product experience when the public API confirms the merchant
    // entitlement and usable purchase data, even without editorial blocks.
    if (!merchantSlug) return;
    const controller = new AbortController();
    fetch(`${API_BASE}/storefront/${encodeURIComponent(merchantSlug)}/products/${encodeURIComponent(productId)}/content`, {
      headers: { Accept: "application/json", "Accept-Language": document.documentElement.lang || "pt-BR" },
      signal: controller.signal,
      cache: "no-store",
    }).then(async (response) => response.ok ? response.json() : null).then((content) => {
      if (controller.signal.aborted) return;
      openedProductMessages.current.add(key);
      if (content && Array.isArray(content.blocks) && (
        (typeof content.purchase?.productName === "string" && Array.isArray(content.purchase?.variants)) ||
        [content.blocks, content.faqs, content.testimonials, content.videos].some((items) => Array.isArray(items) && items.length > 0)
      )) setRichProduct({ productId });
    }).catch(() => {});
    return () => controller.abort();
  }, [messages, merchantSlug]);
  useEffect(() => {
    const onOpenSupport = () => setSupportOpen(true);
    window.addEventListener("zyon:open-support", onOpenSupport);
    return () => window.removeEventListener("zyon:open-support", onOpenSupport);
  }, []);
  useEffect(() => {
    const onVariantSelected = (event: Event) => {
      const detail = (event as CustomEvent<{ productId?: unknown; variantId?: unknown }>).detail;
      if (detail?.productId !== richProduct?.productId) return;
      if (typeof detail?.variantId === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(detail.variantId)) {
        presentedProductVariantRef.current = detail.variantId;
      }
    };
    window.addEventListener("aacp:rich-product-variant-selected", onVariantSelected);
    return () => window.removeEventListener("aacp:rich-product-variant-selected", onVariantSelected);
  }, [richProduct?.productId]);
  useEffect(() => {
    const onOpenBuyerHub = () => setBuyerHubOpen(true);
    window.addEventListener("aacp:open-buyer-hub", onOpenBuyerHub);
    return () => window.removeEventListener("aacp:open-buyer-hub", onOpenBuyerHub);
  }, [setBuyerHubOpen]);
  useEffect(() => {
    const onRichProductAdd = (event: Event) => {
      const detail = (event as CustomEvent<{ variantId?: unknown; optionItemIds?: unknown }>).detail;
      const variantId = detail?.variantId;
      // Do not turn arbitrary browser events into chat markup. Catalog ids are
      // constrained before we hand the command to the existing API-backed path.
      if (typeof variantId !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(variantId)) return;
      const optionItemIds = Array.isArray(detail?.optionItemIds)
        ? detail.optionItemIds.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(id))
        : [];
      const optionTag = optionItemIds.length ? ` [optionItemIds:${optionItemIds.join(",")}]` : "";
      handleQuickReply(`Adicionar produto ao carrinho [variantId:${variantId}]${optionTag}`);
    };
    window.addEventListener("aacp:add-rich-product-to-cart", onRichProductAdd);
    const onRichProductCart = () => { setRichProduct(null); handleQuickReply("Ver carrinho"); };
    window.addEventListener("aacp:open-rich-product-cart", onRichProductCart);
    const onOpenRichProduct = (event: Event) => {
      const productId = (event as CustomEvent<{ productId?: unknown }>).detail?.productId;
      if (typeof productId !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(productId)) return;
      setRichProduct({ productId });
    };
    window.addEventListener("aacp:open-product-content", onOpenRichProduct);
    return () => {
      window.removeEventListener("aacp:add-rich-product-to-cart", onRichProductAdd);
      window.removeEventListener("aacp:open-rich-product-cart", onRichProductCart);
      window.removeEventListener("aacp:open-product-content", onOpenRichProduct);
    };
  }, [handleQuickReply]);
  useEffect(() => {
    if (checkoutIntent) {
      setCheckoutUserId(checkoutIntent);
      setCheckoutCartRef(cart.cartId ?? undefined);
      setCheckoutPreferences(undefined);
      setCheckoutOpen(true);
      setCheckoutIntent(null);
    }
  }, [checkoutIntent, setCheckoutIntent]);
  useEffect(() => {
    const buyerToken = localStorage.getItem("zyon_buyer_token");
    if (buyerToken && !showBuyerAuth && !checkoutUserId) {
      try {
        const payload = JSON.parse(atob(buyerToken.split(".")[1]));
        const globalUserId = payload.sub || payload.globalUserId;
        if (globalUserId) {
          setCheckoutUserId(globalUserId);
        }
      } catch (err) {
        localStorage.removeItem("zyon_buyer_token");
      }
    }
  }, []);
  useEffect(() => {
    if (mode === "chat" && !isLoading) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [mode, isLoading]);
  const trackedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      if (!m.blocks) continue;
      for (const block of m.blocks) {
        const id = `${m.id}::${block.type}`;
        if (trackedIdsRef.current.has(id)) continue;
        trackedIdsRef.current.add(id);
      }
    }
  }, [messages]);
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
    });
  };
  useEffect(() => {
    if (messages.length === 0) return;
    scrollToBottom();
    if (!isLoading && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [messages, isLoading]);
  useEffect(() => {
    const el = threadRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastHeight = el.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (!threadRef.current) return;
      const grew = threadRef.current.scrollHeight > lastHeight;
      lastHeight = threadRef.current.scrollHeight;
      const nearBottom =
        threadRef.current.scrollHeight - threadRef.current.scrollTop - threadRef.current.clientHeight < 240;
      if (grew && nearBottom) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const selectedVariantId = oneBuyClickEnabled.current
      ? resolvePresentedVariantId(messages, input)
      : undefined;
    void sendMessage(attachPresentedVariantId(input, selectedVariantId));
    scrollToBottom();
    setTimeout(() => inputRef.current?.focus(), 100);
  };
  const chatQuickReplies = [
    "Ver Produtos",
    "Encontrar Produto",
    "Categorias",
    "Prazo de Entrega",
    ...(cart.itemCount > 0 ? ["Ver Carrinho", "Aplicar Cupom", "Finalizar Compra"] : []),
    "Trocas e Devoluções",
    "Rastrear Pedido",
    "Meus Dados",
    "Ofertas",
  ];
  const handleProductQuickReply = (option: string) => {
    const pending = pendingProductCart.current;
    if (option === "Adicionar ao carrinho" && pending) {
      pendingProductCart.current = null;
      window.dispatchEvent(new CustomEvent("aacp:add-rich-product-to-cart", { detail: { variantId: pending.variantId } }));
      return;
    }
    handleQuickReply(option);
  };
  return (
    <div id="storefront-chat" className="pulse-widget-shell" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, width: "100%", position: "relative", borderRadius: "19px", padding: "1px" }}>
      <PerimeterBorder radius="19px" />
      {/* Content */}
      <div data-aacp-chat-content style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, width: "100%", borderRadius: "18px", overflow: "hidden", background: "var(--aacp-bg, #08080c)", zIndex: 2 }}>
      <h1 style={{ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
        {storeName} - Loja Online
      </h1>
      <style>{`
        @keyframes orbFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes waveRing { 0%{transform:scale(0.7);opacity:0.5} 100%{transform:scale(1.5);opacity:0} }
        @keyframes eyeBlink { 0%,92%,100%{transform:scaleY(1)} 96%{transform:scaleY(0.12)} }
        @keyframes eyeLookLR { 0%,100%{transform:translateX(-2.5px)} 50%{transform:translateX(2.5px)} }
        @keyframes eyeThinkUp { 0%,80%,100%{transform:translateY(0)} 20%,60%{transform:translateY(-1.5px)} }
        @keyframes bubble-in { from{opacity:0;transform:translateY(8px) scale(.98)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes dot-pulse { 0%,80%,100%{opacity:.3;transform:scale(.65)} 40%{opacity:1;transform:scale(1)} }
        @keyframes pulseDot { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes micPulse { 0%{box-shadow:0 0 0 0 rgba(255,76,108,0.5)} 100%{box-shadow:0 0 0 9px rgba(255,76,108,0)} }
      `}</style>
      {effectiveMode === "chat" && (
        <>
        <header className="conversation-header" style={{ display: "flex", alignItems: "center", gap: "11px", padding: "8px 14px", borderBottom: "1px solid var(--aacp-line)", zIndex: 9, background: "var(--aacp-header-bg, var(--aacp-bg))", flex: "none" }}>
          {logo && !logoError ? (
            <img
              src={logo}
              alt={storeName}
              width={80}
              height={80}
              loading="eager"
              onError={() => setLogoError(true)}
              style={{ maxWidth: "80px", maxHeight: "80px", objectFit: "contain", flex: "none" }}
            />
          ) : (
            <div style={{ width: "34px", height: "34px", borderRadius: "12px", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", color: "var(--aacp-fg)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", overflow: "hidden", fontSize: "13px", fontWeight: 800, letterSpacing: "-.2px" }}>
              {storeName.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "6px" }}>
            <div data-neu="status" className="conversation-header__status" style={{ display: "flex", alignItems: "center", gap: "6px", minHeight: "30px", padding: "4px 10px", borderRadius: "999px", background: "var(--aacp-card)", border: "1px solid var(--aacp-line)" }}>
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--aacp-success)", animation: "pulseDot 2.2s ease-in-out infinite", flex: "none" }} />
              <span className="conversation-header__status-label" style={{ fontSize: "11px", fontWeight: 600, color: "var(--aacp-muted)" }}>Online</span>
            </div>
            {conversationId && (
              <>
                <OneBuyClickToggle
                  placement="header"
                  enabled={oneBuyClick?.enabled ?? false}
                  pending={oneBuyClickPending}
                  available={Boolean(oneBuyClick)}
                  onToggle={() => { void toggleOneBuyClick(); }}
                />
                <OneBuyClickToggle
                  placement="mobile-header"
                  enabled={oneBuyClick?.enabled ?? false}
                  pending={oneBuyClickPending}
                  available={Boolean(oneBuyClick)}
                  onToggle={() => { void toggleOneBuyClick(); }}
                />
              </>
            )}
          </div>
          {voiceCheckoutEnabled ? <button data-neu="control" type="button" onClick={() => { if (channel === "voice") realtimeVoice.stop(); toggleChannel(); if (channel !== "voice") realtimeVoice.start(); }} title={channel === "voice" ? "Mudar para chat" : "Mudar para voz"} style={{ width: "30px", height: "30px", borderRadius: "50%", border: `1px solid ${channel === "voice" ? "var(--aacp-accent)" : "var(--aacp-line)"}`, background: channel === "voice" ? "color-mix(in srgb, var(--aacp-accent) 15%, transparent)" : "var(--aacp-card)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0 }}>
            {channel === "voice" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            )}
          </button> : null}
          <button data-neu="control" type="button" onClick={toggleTheme} title={theme === "dark" ? "Modo claro" : "Modo escuro"} style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="var(--aacp-muted)" strokeWidth="1.8" /><path d="M12 3a9 9 0 0 0 0 18z" fill="var(--aacp-muted)" /></svg>
          </button>

          <BuyerHubTrigger onClick={() => setBuyerHubOpen(!buyerHubOpen)} hasNotifications={false} />
          <button data-neu="control" type="button" onClick={() => setSupportOpen((v) => !v)} title="Suporte" style={{ width: "30px", height: "30px", borderRadius: "50%", border: `1px solid ${supportOpen ? "var(--aacp-accent)" : "var(--aacp-line)"}`, background: supportOpen ? "color-mix(in srgb, var(--aacp-accent) 12%, transparent)" : "var(--aacp-card)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={supportOpen ? "var(--aacp-accent)" : "var(--aacp-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </button>

          {Object.values(storeSettings?.social ?? {}).some(Boolean) && (
            <button
              data-neu="control"
              className="store-menu-trigger"
              type="button"
              aria-label="Abrir mais da loja"
              aria-controls="store-social-menu"
              aria-expanded={storeMenuOpen}
              title="Mais da loja"
              onClick={() => setStoreMenuOpen((open) => !open)}
              style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", color: "var(--aacp-muted)", cursor: "pointer", alignItems: "center", justifyContent: "center", flex: "none", padding: 0 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>
            </button>
          )}

          <nav className="conversation-header__social" aria-label="Ações rápidas" style={{ display: "flex", gap: "6px" }}>
            {storeSettings?.social?.instagram && (
              <a data-neu="control" href={storeSettings.social.instagram} target="_blank" rel="noopener noreferrer" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)", flex: "none", transition: "all 0.15s", cursor: "pointer" }} title="Instagram"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 12%, transparent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.background = "var(--aacp-card)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
              </a>
            )}
            {storeSettings?.social?.facebook && (
              <a data-neu="control" href={storeSettings.social.facebook} target="_blank" rel="noopener noreferrer" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)", flex: "none", transition: "all 0.15s", cursor: "pointer" }} title="Facebook"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 12%, transparent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.background = "var(--aacp-card)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
              </a>
            )}
            {storeSettings?.social?.linkedin && (
              <a data-neu="control" href={storeSettings.social.linkedin} target="_blank" rel="noopener noreferrer" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)", flex: "none", transition: "all 0.15s", cursor: "pointer" }} title="LinkedIn"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 12%, transparent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.background = "var(--aacp-card)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg>
              </a>
            )}
            {storeSettings?.social?.youtube && (
              <a data-neu="control" href={storeSettings.social.youtube} target="_blank" rel="noopener noreferrer" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)", flex: "none", transition: "all 0.15s", cursor: "pointer" }} title="YouTube"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 12%, transparent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.background = "var(--aacp-card)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.13C5.12 19.56 12 19.56 12 19.56s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z" /><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" /></svg>
              </a>
            )}
            {storeSettings?.social?.googleMaps && (
              <a data-neu="control" href={storeSettings.social.googleMaps} target="_blank" rel="noopener noreferrer" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)", flex: "none", transition: "all 0.15s", cursor: "pointer" }} title="Google Maps"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 12%, transparent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.background = "var(--aacp-card)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
              </a>
            )}
          </nav>
        </header>
        {storeMenuOpen && (
          <>
            <button className="store-menu-backdrop" type="button" aria-label="Fechar mais da loja" onClick={() => setStoreMenuOpen(false)} />
            <aside id="store-social-menu" className="store-menu" role="dialog" aria-label="Mais da loja">
              <div className="store-menu__title">Acompanhe a loja</div>
              <StoreSocialLinks social={storeSettings?.social} />
            </aside>
          </>
        )}
        {/* Stories Row */}
        {merchantSlug && <StoriesRow merchantSlug={merchantSlug} initialCategories={initialStories} />}
        </>
      )}
      {effectiveMode === "intro" ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "28px 24px", overflowY: "auto" }}>
          <div style={{ maxWidth: "520px", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <div style={{ position: "absolute", top: "-50px", left: "50%", transform: "translateX(-50%)", width: "220px", height: "220px", borderRadius: "50%", background: "var(--aacp-accent, #0f766e)", filter: "blur(80px)", opacity: 0.22, pointerEvents: "none" }} />
            <div style={{ width: "min(100%, 520px)", display: "flex", justifyContent: "center", alignItems: "center", margin: "0 auto 18px", position: "relative", zIndex: 1 }}>
              <PulseAgentOrb size={96} avatarUrl={agentAvatarUrl} />
            </div>

            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", lineHeight: 1.45, letterSpacing: "2px", textTransform: "uppercase", color: "var(--aacp-muted)", marginBottom: "6px" }}>
              Gerente de vendas da {storeName}
            </div>
            <div style={{ fontSize: "27px", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "10px" }}>
              Oi, eu sou a {agent}.
            </div>
            <div style={{ fontSize: "13.5px", lineHeight: 1.55, color: "var(--aacp-muted)", maxWidth: "100%", marginBottom: "22px" }}>
              Eu cuido da sua compra do início ao fim. Acho a melhor opção, aplico promoções, organizo a entrega e finalizo o pagamento com você, passo a passo.
            </div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--aacp-muted)", marginBottom: "11px" }}>
              {voiceCheckoutEnabled ? "Comece sua compra por voz" : "Como você prefere comprar?"}
            </div>
            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              <button data-neu="choice" type="button" onClick={() => { realtimeVoice.stop(); selectChannel("chat"); }} style={{ order: 2, flex: 1, cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", borderRadius: "16px", padding: "15px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: "9px", color: "var(--aacp-fg)" }}>
                <span style={{ width: "38px", height: "38px", borderRadius: "11px", background: "var(--aacp-accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
                </span>
                <span style={{ fontSize: "13.5px", fontWeight: 600 }}>Por chat</span>
                <span style={{ fontSize: "10.5px", color: "var(--aacp-muted)", lineHeight: 1.3 }}>Converse digitando</span>
              </button>
              {voiceCheckoutEnabled ? <button data-neu="choice" type="button" onClick={() => { selectChannel("voice"); realtimeVoice.start(); }} style={{ order: 1, flex: 1, cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--aacp-accent)", background: "color-mix(in srgb, var(--aacp-accent) 8%, transparent)", borderRadius: "16px", padding: "15px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: "9px", position: "relative", overflow: "hidden", color: "var(--aacp-fg)" }}>
                <span style={{ position: "absolute", top: "9px", right: "9px", fontFamily: "'Space Mono', monospace", fontSize: "7.5px", letterSpacing: ".5px", color: "var(--aacp-accent-text, var(--aacp-accent))", border: "1px solid var(--aacp-accent)", borderRadius: "5px", padding: "1px 4px" }}>IA</span>
                <span style={{ width: "38px", height: "38px", borderRadius: "11px", background: "var(--aacp-accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                </span>
                <span style={{ fontSize: "13.5px", fontWeight: 600 }}>Começar por voz</span>
                <span style={{ fontSize: "10.5px", color: "var(--aacp-muted)", lineHeight: 1.3 }}>Fale com a {agent}</span>
              </button> : null}
            </div>
            {voiceCheckoutEnabled && welcomeVoiceRequested ? <div role="status" aria-live="polite" style={{ minHeight: "18px", marginTop: "12px", color: "var(--aacp-muted)", fontSize: "10.5px" }}>
              {realtimeVoice.connecting ? "Preparando saudação por voz..." : realtimeVoice.speaking ? `${agent} está falando...` : realtimeVoice.hint}
            </div> : null}
            {!voiceCheckoutEnabled ? <span style={{ fontSize: "10.5px", color: "var(--aacp-muted)", marginTop: "10px" }}>Compra por voz disponível a partir do plano Growth.</span> : null}
          </div>
        </div>
      ) : (
        <>
          <main ref={threadRef} role="main" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "14px", minHeight: 0, scrollBehavior: "smooth", msOverflowStyle: "none", scrollbarWidth: "none" }}>
            {/* Welcome state — no messages yet */}
            {messages.length === 0 && !isLoading && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "16px 20px", textAlign: "center" }}>
                <PulseAgentOrb size={56} avatarUrl={agentAvatarUrl} />
                <div style={{ marginTop: "4px", maxWidth: "100%", width: "100%" }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--aacp-fg)", lineHeight: 1.3, letterSpacing: "-0.3px", fontFamily: "var(--aacp-font-display, var(--aacp-font))" }}>Olá! Sou {agent} 👋</div>
                  <div style={{ fontSize: "13px", color: "var(--aacp-muted)", marginTop: "8px", lineHeight: 1.5, maxWidth: "380px", marginLeft: "auto", marginRight: "auto", fontFamily: "var(--aacp-font)", whiteSpace: "pre-line" }}>
                    {agentGreeting || "A partir de agora serei sua assistente de vendas e irei te ajudar a encontrar produtos, aplicar cupons, calcular frete e finalizar sua compra. Vamos começar!"}
                  </div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--aacp-accent-text, var(--aacp-accent, #0f766e))", marginTop: "14px" }}>
                    Selecione uma opção abaixo ou digite algo
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", marginTop: "10px", paddingBottom: "8px", width: "100%" }}>
                  {(quickReplies ?? chatQuickReplies).map((label) => (
                    <button data-neu="control" key={label} type="button" onClick={() => handleQuickReply(label)} style={{ padding: "7px 14px", borderRadius: "999px", border: "1px solid var(--aacp-line)", background: "transparent", color: "var(--aacp-muted)", fontSize: "11.5px", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s", fontFamily: "var(--aacp-font)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}
                    >{label}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => {
              if (m.role === "agent") {
                const hasProductCard = m.blocks?.some((b) => b.type === "product_card");
                const hasOnlyBlocks = !m.text && m.blocks?.length;
                // Wide block types stretch the message to the full chat width even
                // when they arrive alongside agent text (e.g. "aqui estão as promoções" + carousel).
                const hasWideBlock = m.blocks?.some((b) =>
                  b.type === "product_carousel" ||
                  b.type === "coupon_list" ||
                  b.type === "category_carousel" ||
                  b.type === "marketplace_products" ||
                  b.type === "product_content"
                );
                const isFullWidth = hasOnlyBlocks || hasProductCard || hasWideBlock;
                if (hasProductCard) {
                  const cardBlock = m.blocks!.find((b) => b.type === "product_card")!;
                  const otherBlocks = (m.blocks ?? []).filter((b) => b.type !== "product_card");
                  return (
                    <div key={m.id} style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px", animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
                      {/* Agent narration above the card — keeps the conversation immersive (A/B tone) */}
                      {m.text && (
                        <SafeStoreHtml material="message"
                          style={{ padding: "12px 16px", borderRadius: "18px", fontSize: "13.5px", lineHeight: 1.55, whiteSpace: "pre-wrap", background: "var(--aacp-card)", color: "var(--aacp-fg)", wordWrap: "break-word", border: "1px solid var(--aacp-line)", alignSelf: "flex-start", maxWidth: "min(82%, 520px)" }}
                          html={renderMarkdownText(m.text)}
                          config={{ ALLOWED_TAGS: ["strong", "em", "br"] }}
                        />
                      )}
                      <BlockRenderer block={cardBlock} merchantSlug={merchantSlug} onQuickReply={handleProductQuickReply} />
                      {otherBlocks.map((block, idx) => (
                        <div key={idx} style={{ maxWidth: "100%" }}>
                          <BlockRenderer block={block} merchantSlug={merchantSlug} onQuickReply={handleProductQuickReply} />
                        </div>
                      ))}
                    </div>
                  );
                }
                return (
                  <div key={m.id} style={{ display: "flex", gap: "9px", alignItems: "flex-start", maxWidth: isFullWidth ? "100%" : "min(82%, 520px)", alignSelf: "flex-start", animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both", width: isFullWidth ? "100%" : undefined }}>
                    {/* Per-message agent orb — use the animated PulseAgentOrb (float +
                        ring + blinking eyes) so it moves like the widget, instead of a
                        static gradient dot. */}
                    <div style={{ flex: "none", marginTop: "4px" }}>
                      <PulseAgentOrb size={26} avatarUrl={agentAvatarUrl} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, minWidth: 0 }}>
                      {m.text && <SafeStoreHtml material="message" style={{ boxShadow: "var(--aacp-neu-message)", padding: "12px 16px", borderRadius: "18px", fontSize: "13.5px", lineHeight: 1.55, whiteSpace: "pre-wrap", background: "var(--aacp-card)", color: "var(--aacp-fg)", wordWrap: "break-word", border: "1px solid var(--aacp-line)" }} html={renderMarkdownText(m.text)} config={{ ALLOWED_TAGS: ["strong", "em", "br"] }} />}
                      {m.blocks?.map((block, idx) => (
                        <div key={idx} style={{ maxWidth: "100%" }}>
                          <BlockRenderer block={block} merchantSlug={merchantSlug} onQuickReply={handleProductQuickReply} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              } else {
                return (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: "6px", maxWidth: "min(76%, 480px)", alignSelf: "flex-end", animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
                    {m.text && <div data-neu="message" data-speaker="buyer" style={{ padding: "11px 14px", borderRadius: "18px", fontSize: "13.5px", lineHeight: 1.5, fontWeight: 500, whiteSpace: "pre-wrap", background: "var(--aacp-accent)", color: "#fff", boxShadow: "var(--aacp-neu-message)", wordWrap: "break-word" }}>{renderBuyerMessage(m.text)}</div>}
                  </div>
                );
              }
            })}
            {isLoading && (
              <div style={{ display: "flex", gap: "9px", alignItems: "flex-end", alignSelf: "flex-start", animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
                {/* Thinking orb — branded avatar when set, else CSS orb with eyes looking up */}
                {agentAvatarUrl ? (
                  <img src={agentAvatarUrl} alt="" style={{ width: "28px", height: "28px", borderRadius: "50%", objectFit: "cover", flex: "none" }} />
                ) : (
                  <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: `radial-gradient(120% 120% at 30% 25%, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0) 42%), var(--aacp-accent)`, flex: "none", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: "2.2px" }}>
                    {/* Left eye — looking up */}
                    <span style={{ width: "2.5px", height: "3.5px", borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px rgba(0,0,0,0.12)", animation: "eyeThinkUp 2s ease-in-out infinite", flex: "none" }} />
                    {/* Right eye — looking up */}
                    <span style={{ width: "2.5px", height: "3.5px", borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px rgba(0,0,0,0.12)", animation: "eyeThinkUp 2s ease-in-out infinite", animationDelay: "0.1s", flex: "none" }} />
                  </div>
                )}
                {/* 3-dot bubble */}
                <div data-neu="message" style={{ padding: "10px 14px", borderRadius: "18px", background: "var(--aacp-card)", border: "1px solid var(--aacp-line)", display: "flex", gap: "3px", alignItems: "center" }}>
                  <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--aacp-muted)", animation: "dot-pulse 1.2s infinite", animationDelay: "0s" }} />
                  <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--aacp-muted)", animation: "dot-pulse 1.2s infinite", animationDelay: "0.2s" }} />
                  <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--aacp-muted)", animation: "dot-pulse 1.2s infinite", animationDelay: "0.4s" }} />
                </div>
              </div>
            )}
          </main>
          {/* Composer / Voice indicator */}
          <div style={{ padding: "9px 14px 14px", flex: "none" }}>
            {channel === "voice" ? <RealtimeVoiceComposer voice={realtimeVoice} /> : (
              <form data-neu="inset" data-aacp-composer-frame onSubmit={handleSubmit} style={{ display: "flex", alignItems: "center", gap: "9px", padding: "9px 9px 9px 15px", background: "var(--aacp-inset-bg)", border: "1px solid var(--aacp-line)", borderRadius: "14px", transition: "border-color 0.2s ease, box-shadow 0.2s ease" }}>
                <PerimeterBorder radius="14px" variant="input" />
                <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={isLoading ? "Aguarde..." : "Escreva sua mensagem…"} aria-label="Mensagem" disabled={isLoading} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--aacp-fg)", fontSize: "13px", padding: 0, fontFamily: "inherit" }} />
                <button data-neu="send" type="submit" disabled={!input.trim() || isLoading} aria-label="Enviar mensagem" style={{ width: "36px", height: "36px", borderRadius: "10px", border: "none", cursor: !input.trim() || isLoading ? "not-allowed" : "pointer", background: "var(--aacp-accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </form>
            )}
          </div>
        </>
      )}
      {/* Footer — CNPJ + policies */}
      {effectiveMode === "chat" && storeSettings?.company?.cnpj && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--aacp-line)", background: "var(--aacp-bg)", display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", flexWrap: "wrap", flex: "none" }}>
          <span style={{ fontSize: "9px", color: "var(--aacp-muted)", fontFamily: "'Space Mono', monospace", letterSpacing: "0.5px" }}>
            {storeSettings.company.razaoSocial && `${storeSettings.company.razaoSocial} · `}CNPJ {storeSettings.company.cnpj}
          </span>
          {storeSettings?.policies?.privacy && (
            <button data-neu="text" type="button" onClick={() => setPolicyModal({ title: "Política de Privacidade", content: storeSettings.policies!.privacy || "" })} style={{ fontSize: "9px", color: "var(--aacp-muted)", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>Privacidade</button>
          )}
          {storeSettings?.policies?.returns && (
            <button data-neu="text" type="button" onClick={() => setPolicyModal({ title: "Trocas e Devoluções", content: storeSettings.policies!.returns || "" })} style={{ fontSize: "9px", color: "var(--aacp-muted)", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>Devoluções</button>
          )}
          {storeSettings?.policies?.terms && (
            <button data-neu="text" type="button" onClick={() => setPolicyModal({ title: "Termos de Uso", content: storeSettings.policies!.terms || "" })} style={{ fontSize: "9px", color: "var(--aacp-muted)", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>Termos</button>
          )}
          {storeSettings?.policies?.shipping && (
            <button data-neu="text" type="button" onClick={() => setPolicyModal({ title: "Política de Envio", content: storeSettings.policies!.shipping || "" })} style={{ fontSize: "9px", color: "var(--aacp-muted)", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>Envio</button>
          )}
        </div>
      )}
      {/* Whitelabel badge — free-plan merchants, both chat and intro modes */}
      <WhitelabelBadge show={showBranding} />
      {/* Policy Modal */}
      {policyModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "20px" }} onClick={() => setPolicyModal(null)}>
          <div data-neu="surface" style={{ background: "var(--aacp-panel-bg)", borderRadius: "16px", border: "1px solid var(--aacp-line)", maxWidth: "520px", width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both" }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--aacp-line)", flex: "none" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--aacp-fg)" }}>{policyModal.title}</h2>
              <button data-neu="icon" type="button" aria-label="Fechar política" onClick={() => setPolicyModal(null)} style={{ width: "32px", height: "32px", borderRadius: "50%", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px", color: "var(--aacp-fg)", fontSize: "13px", lineHeight: 1.6 }}>
              {policyModal.content ? (
                <SafeStoreHtml html={policyModal.content} style={{ wordWrap: "break-word" }} />
              ) : (
                <p style={{ color: "var(--aacp-muted)" }}>Política não configurada</p>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Support FAB + Panel — only in chat mode */}
      {effectiveMode === "chat" && (
        <>
          <SupportPanel open={supportOpen} onClose={() => setSupportOpen(false)} merchantId={merchantId} agentName={agentName} />
        </>
      )}
      {/* Native Cart — FAB + lateral drawer, no iframe */}
      {effectiveMode === "chat" && (
        <CheckoutWidgetPanel
          merchantId={merchantId}
          onCheckout={async () => {
            const buyer = getValidBuyer();
            if (!buyer) {
              setShowBuyerAuth(true);
              return;
            }
            setCheckoutUserId(buyer.globalUserId);
            setCheckoutCartRef(cart.cartId ?? undefined);
            setCheckoutPreferences(undefined);
            setCheckoutOpen(true);
          }}
          onViewCart={() => setCartDrawerForceOpen(true)}
          onUpdateQty={handleUpdateQuantity}
          onRemoveItem={(variantId) => handleUpdateQuantity(variantId, 0)}
          forceOpen={cartDrawerForceOpen}
          suppressAutoOpen={Boolean(crossSellPending) || Boolean(richProduct)}
        />
      )}
      {/* Cross-sell interstitial — shows before the cart drawer after add-to-cart */}
      <CrossSellInterstitial
        data={crossSellPending}
        onClose={dismissCrossSell}
        onViewCart={() => {
          dismissCrossSell();
          setCartDrawerForceOpen(true);
        }}
        onAddItem={(id, name, promoId, couponCode) => {
          dismissCrossSell();
          const tags = `[variantId:${id}]${promoId ? `[crossSellPromoId:${promoId}]` : ""}`;
          handleQuickReply(`Adicionar ${name} ao carrinho ${tags}`);
          if (couponCode) {
            setTimeout(() => handleQuickReply(`Aplicar cupom ${couponCode}`), 400);
          }
        }}
      />
      {/* Buyer Hub Panel */}
      <BuyerHub isOpen={buyerHubOpen} onClose={() => setBuyerHubOpen(false)} merchantId={merchantId} onToggleTheme={toggleTheme} />
      {/* Buyer Auth Gate */}
      {showBuyerAuth && (
        <BuyerAuthGate
          merchantId={merchantId}
          merchantName={storeName}
          onComplete={async (globalUserId) => {
            setShowBuyerAuth(false);
            if (merchantId && conversationId) {
              const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
              conversationFetch(conversationId, `${API_BASE}/storefront/conversations/${encodeURIComponent(conversationId)}/events`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ merchant_id: merchantId, event: "login_completed", metadata: { timestamp: new Date().toISOString() } }),
              }).catch(() => {});
            }
            setCheckoutUserId(globalUserId);
            setCheckoutCartRef(cart.cartId ?? undefined);
            setCheckoutPreferences(undefined);
            setCheckoutOpen(true);
          }}
          onCancel={() => setShowBuyerAuth(false)}
        />
      )}
      {/* Inline Checkout Panel — replaces redirect to widget app */}
      {checkoutOpen && merchantId && (
        <CheckoutPanel
          merchantId={merchantId}
          globalUserId={checkoutUserId}
          cartRef={checkoutCartRef}
          oneBuyClickPreferences={checkoutPreferences}
          initialChannel={checkoutInitialChannel}
          theme={theme}
          onClose={() => setCheckoutOpen(false)}
        />
      )}
      </div>{/* end content wrapper */}
      {richProduct ? <RichProductDetailsPanel key={richProduct.productId} productId={richProduct.productId} merchantSlug={merchantSlug} suspended={buyerHubOpen || cartDrawerForceOpen || showBuyerAuth || checkoutOpen} onProductResolved={({ productId, defaultVariantId }) => {
        if (richProduct.productId === productId && typeof defaultVariantId === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(defaultVariantId)) {
          presentedProductVariantRef.current = defaultVariantId;
        }
      }} onClose={({ productId, productName, defaultVariantId, cartAdded }) => {
        setRichProduct(null);
        if (cartAdded || !productName || !defaultVariantId || promptedProductClose.current.has(productId)) return;
        promptedProductClose.current.add(productId);
        pendingProductCart.current = { variantId: defaultVariantId };
        appendAgentMessage({
          text: `Olá, gostou de ${productName}? Vamos adicioná-lo agora ao seu carrinho?`,
          blocks: [{ type: "quick_replies", data: { options: ["Adicionar ao carrinho"] } }],
        });
      }} /> : null}
    </div>
  );
}
