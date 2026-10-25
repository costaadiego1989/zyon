/**
 * Storefront quick replies — stage-based and context-intelligent suggestions.
 *
 * Generates deterministic quick-reply suggestions based on conversation stage,
 * last tool used, and current context (cart state, shipping options).
 * Stage actions remain deterministic. Discovery uses bounded, validated answer
 * choices emitted together with the agent's question, not unrelated actions.
 */

import type { StoreQuickRepliesConfig } from "@zyon/shared-types";
import { DEFAULT_STORE_QUICK_REPLIES } from "../defaults/store-quick-replies.defaults.js";
import { isBroadShoppingRequest, isUnspecifiedShoppingRequest, parseSalesDiscoveryQuestion, type SalesDiscoveryQuestion } from "./sales-discovery.js";
import { storefrontPresentationContextSchema, storefrontQuickReplyConfigSchema, storefrontQuickReplyMapSchema,
  storefrontQuickReplyListSchema, storefrontQuickReplyCartSchema, type StorefrontPresentationContext, type StorefrontStage } from "../contracts/storefront-presentation.schemas.js";
import { storefrontToolArgumentSchemas } from "../contracts/storefront-tool.schemas.js";

export interface StorefrontCartState {
  items: Array<{ variantId: string; name: string; quantity: number }>;
  total: number;
  itemCount: number;
  couponCode?: string | null;
}

export interface StorefrontShippingOption {
  carrier: string;
  name: string;
  price: number;
  days: number;
}

export type StoreStage = StorefrontStage | "discovery";
type StorefrontDiscoveryPresentation = { discoveryQuestion?: SalesDiscoveryQuestion; assistantMessage?: string; hasBlocks?: boolean };

const CART_MUTATIONS = new Set(["add_item_to_cart", "add_catalog_items", "update_cart_item", "remove_cart_item", "clear_cart",
  "apply_coupon", "remove_coupon", "create_checkout_session"]);
const REVIEW_REPLIES = ["Ver Carrinho", "Continuar Comprando"];

function structuredPresentation(value: unknown, lastTool?: string | null): { stage: StoreStage; review: boolean; context?: StorefrontPresentationContext } {
  const parsed = storefrontPresentationContextSchema.safeParse(value);
  if (!parsed.success) return { stage: "welcome", review: CART_MUTATIONS.has(lastTool ?? "") };
  return { ...structuredStage(parsed.data, lastTool), context: parsed.data };
}

function structuredStage(context: StorefrontPresentationContext, lastTool?: string | null): { stage: StoreStage; review: boolean } {
  const blocks = context.blocks;
  const cart = blocks.find(block => block.type === "cart_summary" && block.data.cartId === context.cartId);
  const nonemptyCart = cart?.type === "cart_summary" && cart.data.items.length > 0 && cart.data.itemCount > 0;
  const outcomes = blocks.filter(block => block.type === "cart_add_result");
  if (outcomes.some(block => block.data.status !== "succeeded")) return { stage: "welcome", review: true };
  if (CART_MUTATIONS.has(lastTool ?? "")) {
    const confirmedAdd = (lastTool === "add_item_to_cart" || lastTool === "add_catalog_items") && nonemptyCart
      && outcomes.length > 0 && outcomes.every(outcome => cart.data.items.some(item => item.variantId === outcome.data.variantId));
    const prepared = lastTool === "create_checkout_session" && blocks.some(block => block.type === "checkout_prepared");
    if (!confirmedAdd && !prepared) return { stage: "welcome", review: true };
    return { stage: "added_to_cart", review: false };
  }
  // Successful projections outrank both raw text and the classifier's proposed intent.
  const blockStages = [
    ["product_comparison", "compare"], ["product_card", "product_detail"], ["reviews", "reviews"],
    ["wishlist", "wishlist"], ["coupon_list", "promotions"], ["category_carousel", "categories"],
    ["product_carousel", "browsing"],
  ] as const;
  for (const [type, stage] of blockStages) if (blocks.some(block => block.type === type)) return { stage, review: false };
  if (cart?.type === "cart_summary") return { stage: nonemptyCart ? "added_to_cart" : "welcome", review: false };
  const toolStages: Partial<Record<string, StoreStage>> = {
    get_product_questions: "questions", create_question: "questions", create_review: "reviews",
    get_store_policies: "support", get_buyer_profile: "support", get_faq: "support", escalate_to_human: "support",
    track_order: "post_purchase", get_invoice: "post_purchase", cancel_order: "post_purchase",
  };
  if (lastTool && Object.hasOwn(toolStages, lastTool)) return { stage: toolStages[lastTool]!, review: false };
  if (context.source !== "structured") return { stage: "welcome", review: false };
  const intentStages: Partial<Record<NonNullable<StorefrontPresentationContext["intent"]>, StoreStage>> = {
    PRODUCT_SEARCH: "browsing", RECOMMEND_PERSONALIZED: "browsing", ADD_CART: "browsing",
    COMPARE_PRODUCTS: "compare", NEGOTIATE_PRICE: "browsing", ORDER_STATUS: "post_purchase", RETURN_REQUEST: "support",
    GREETING: "welcome", COMPLEX_QUESTION: "welcome",
  };
  return { stage: context.intent ? intentStages[context.intent] ?? "welcome" : "welcome", review: false };
}

function normalizeStructuredConfig(value: unknown): StoreQuickRepliesConfig {
  const array = storefrontQuickReplyConfigSchema.safeParse(value);
  if (array.success) return array.data;
  const map = storefrontQuickReplyMapSchema.safeParse(value);
  if (!map.success) return DEFAULT_STORE_QUICK_REPLIES;
  return { ...DEFAULT_STORE_QUICK_REPLIES, stages: DEFAULT_STORE_QUICK_REPLIES.stages.map(stage => ({ ...stage,
    replies: Object.hasOwn(map.data, stage.stage) ? map.data[stage.stage as StorefrontStage]! : stage.replies })) };
}

/** Accept both the dashboard's stage-array configuration and the persisted map shape. */
export function normalizeStoreQuickRepliesConfig(value: unknown): StoreQuickRepliesConfig {
  if (isQuickRepliesConfig(value)) return value;
  const stored = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    ...DEFAULT_STORE_QUICK_REPLIES,
    stages: DEFAULT_STORE_QUICK_REPLIES.stages.map((stage) => {
      const replies = stored[stage.stage];
      return Array.isArray(replies) && replies.every((reply) => typeof reply === "string")
        ? { ...stage, replies }
        : stage;
    }),
  };
}

function isQuickRepliesConfig(value: unknown): value is StoreQuickRepliesConfig {
  return Boolean(value && typeof value === "object" && Array.isArray((value as StoreQuickRepliesConfig).stages));
}

/**
 * Detect conversation stage from the last tool that was executed.
 * Maps tool names to semantic stages for better UX flows.
 */
export function detectStoreStage(lastToolUsed: string | null | undefined, context?: { cartItemCount?: number; userMessage?: string; presentation?: StorefrontPresentationContext }): StoreStage {
  if (context?.presentation !== undefined) return structuredPresentation(context.presentation, lastToolUsed).stage;
  // If no tool was called, try to infer stage from user message
  if (!lastToolUsed && context?.userMessage) {
    const msg = context.userMessage.toLowerCase().trim();
    // Saying "comprar" is intent, not evidence that a cart action succeeded.
    if (isUnspecifiedShoppingRequest(msg) || isBroadShoppingRequest(msg)) return "discovery";
    if (/filtrar|filtro|ordenar|por pre[cç]o|avalia[cç][aã]o|mais vendidos|novidades|frete gr[aá]tis|desconto|limpar filtro/i.test(msg)) return "filter";
    if (/categorias?|segmento/i.test(msg)) return "categories";
    if (/rastrear|tracking|nota fiscal|cancelar pedido/i.test(msg)) return "post_purchase";
    if (/suporte|ajuda|falar com|humano|problema|reportar/i.test(msg)) return "support";
    if (/troca|devolu[cç][aã]o|garantia|pol[ií]tica/i.test(msg)) return "support";
    if (/detalh|saber mais|informa[cç]|especifica/i.test(msg)) return "product_detail";
    if (/avalia[cç]|review/i.test(msg)) return "reviews";
    if (/d[uú]vida|pergunt/i.test(msg)) return "questions";
    if (/compar/i.test(msg)) return "compare";
    if (/desejo|wishlist/i.test(msg)) return "wishlist";
    if (/prazo|entrega|frete|cep|envio/i.test(msg)) return "browsing";
    if (/ver produto|buscar|encontrar|produto|oferta|promo/i.test(msg)) return "browsing";
    if (/meus dados|perfil|conta/i.test(msg)) return "support";
    return "welcome";
  }
  if (!lastToolUsed) return "welcome";

  const toolToStage: Record<string, StoreStage> = {
    // Browsing / catalog
    search_products: "browsing",
    list_products: "browsing",
    get_daily_deals: "browsing",
    get_similar_products: "browsing",
    // Product detail
    get_product: "product_detail",
    get_product_details: "product_detail",
    get_product_availability: "product_detail",
    // Reviews
    get_reviews: "reviews",
    create_review: "reviews",
    // Questions
    get_product_questions: "questions",
    create_question: "questions",
    // Comparison
    compare_products: "compare",
    // Wishlist
    get_wishlist: "wishlist",
    add_to_wishlist: "wishlist",
    remove_from_wishlist: "wishlist",
    // Cart & checkout
    add_item_to_cart: "added_to_cart",
    remove_cart_item: "added_to_cart",
    update_cart_item: "added_to_cart",
    clear_cart: "added_to_cart",
    get_cart: context?.cartItemCount ? "added_to_cart" : "welcome",
    quote_shipping: "added_to_cart",
    apply_coupon: "added_to_cart",
    remove_coupon: "added_to_cart",
    list_promotions: "promotions",
    create_checkout_session: "added_to_cart",
    // Categories
    list_categories: "categories",
    // Post-purchase
    track_order: "post_purchase",
    get_order_status: "post_purchase",
    get_invoice: "post_purchase",
    cancel_order: "post_purchase",
    // Support
    get_store_policies: "support",
    get_buyer_profile: "support",
    get_faq: "support",
    escalate_to_human: "support",
  };

  return toolToStage[lastToolUsed] ?? "welcome";
}

/**
 * Generate smart quick-reply suggestions based on stage, tool context, and merchant config.
 *
 * @param lastToolUsed Name of the tool that was just executed
 * @param config Merchant's custom quick replies config (loaded from storeSettings)
 * @param cartState Current cart state (items, total, coupon)
 * @param shippingOptions Available shipping options (if quote_shipping was called)
 * @returns Array of quick-reply strings matching the stage
 */
export function storefrontQuickReplies(
  lastToolUsed: string | null | undefined,
  config?: StoreQuickRepliesConfig | null,
  cartState?: StorefrontCartState,
  shippingOptions?: StorefrontShippingOption[],
  userMessage?: string,
  listedCouponCodes?: string[],
  presentationOrResponse?: StorefrontPresentationContext | StorefrontDiscoveryPresentation,
  discoveryResponse?: StorefrontDiscoveryPresentation,
): string[] {
  const presentation = presentationOrResponse && "mode" in presentationOrResponse ? presentationOrResponse : undefined;
  const response = discoveryResponse ?? (presentationOrResponse && !("mode" in presentationOrResponse) ? presentationOrResponse : undefined);
  const structured = presentation !== undefined;
  const state = structured ? structuredPresentation(presentation, lastToolUsed) : undefined;
  if (state?.review) return [...REVIEW_REPLIES];
  const scopedBlocks = state?.context?.blocks ?? [];
  const cartSnapshot = structured ? storefrontQuickReplyCartSchema.safeParse(cartState) : undefined;
  const currentCart = structured ? cartSnapshot?.success ? cartSnapshot.data : undefined : cartState;
  const cfg = structured ? normalizeStructuredConfig(config) : normalizeStoreQuickRepliesConfig(config);
  const stage = state?.stage ?? detectStoreStage(lastToolUsed, { cartItemCount: cartState?.itemCount, userMessage });
  const bounded = (replies: string[]): string[] => {
    if (!structured) return replies;
    const parsed = storefrontQuickReplyListSchema.safeParse(replies);
    return parsed.success ? [...new Set(parsed.data)] : [...DEFAULT_STORE_QUICK_REPLIES.fallback];
  };
  if (response?.discoveryQuestion) {
    const question = parseSalesDiscoveryQuestion({ question: response.discoveryQuestion.question, replies: response.discoveryQuestion.replies });
    if (question) return bounded(question.replies);
  }
  // Published clarification choices must not become stale merchant/cart actions.
  if (!lastToolUsed && !response?.hasBlocks && response?.assistantMessage?.includes("?")) return [];
  if (stage === "discovery" || lastToolUsed === "ask_product_preferences"
    || (!lastToolUsed && userMessage && (isUnspecifiedShoppingRequest(userMessage) || isBroadShoppingRequest(userMessage)))) return [];

  // For shipping stage, inject dynamic carrier options if available
  const quoted = scopedBlocks.find(block => block.type === "shipping_options");
  const currentShipping = structured ? quoted?.type === "shipping_options" ? quoted.data.options : undefined : shippingOptions;
  if (lastToolUsed === "quote_shipping" && currentShipping?.length) {
    return bounded(currentShipping
      .map(o => {
        const days = o.days ? ` (${o.days} dias)` : "";
        const price = formatMoney(o.price);
        return `${o.name}${days} - ${price}`;
      })
      .slice(0, 5));
  }

  // Promotions stage: offer to APPLY the listed coupon(s) — the previous mapping
  // fell through to generic cart replies ("Produtos Semelhantes" etc.) that had
  // nothing to do with the coupon just shown. When a coupon isn't yet applied,
  // lead with a concrete "Aplicar cupom <CODE>" (parsed deterministically on send).
  if (stage === "promotions") {
    const coupons = scopedBlocks.find(block => block.type === "coupon_list");
    const codes = structured ? coupons?.type === "coupon_list"
      ? coupons.data.coupons.map(coupon => coupon.code).filter(code => storefrontToolArgumentSchemas.apply_coupon.shape.couponCode.safeParse(code).success && code.trim().length > 0)
      : [] : (listedCouponCodes ?? []).filter(Boolean);
    const notApplied = codes.filter((c) => c.toUpperCase() !== (currentCart?.couponCode ?? "").toUpperCase());
    const replies = notApplied.slice(0, 2).map((c) => `Aplicar cupom ${c}`);
    replies.push("Ver Carrinho");
    const projectedCart = scopedBlocks.find(block => block.type === "cart_summary" && block.data.cartId === state?.context?.cartId);
    const cartItemCount = currentCart?.itemCount ?? (projectedCart?.type === "cart_summary" && projectedCart.data.items.length > 0 ? projectedCart.data.itemCount : 0);
    if (cartItemCount > 0) replies.push("Finalizar Compra");
    else replies.push("Ver Produtos");
    return bounded([...new Set(replies)].slice(0, 5));
  }

  // Find stage configuration
  const stageConfig = cfg.stages.find(s => s.stage === stage);
  if (!stageConfig) return bounded([...cfg.fallback]);

  return bounded([...stageConfig.replies]);
}

/**
 * Format price in BRL currency for display.
 * Quick helper; production code should use centralized formatting.
 */
function formatMoney(valueCents: number): string {
  const valueReal = valueCents / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valueReal);
}

// Legacy adapter for backward compatibility (deprecated)
export function storefrontQuickRepliesLegacy(
  lastToolUsed: string | undefined,
  cartState?: StorefrontCartState,
  shippingOptions?: StorefrontShippingOption[]
): string[] {
  return storefrontQuickReplies(lastToolUsed, null, cartState, shippingOptions);
}
