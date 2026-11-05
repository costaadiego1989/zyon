import type { MetaUiView, StoreUiAction, WhatsAppConversationState } from "./meta-ui.types.js";

const publicProductBlocks = new Set(["product_card", "reviews", "review_submission", "product_questions", "question_submission", "buyer_product_questions", "product_content"]);
export function metaProductContext(view?: MetaUiView): MetaUiView["productContext"] {
  if (!view || view.stage === "checkout") return undefined;
  if (view.productContext) return view.productContext;
  const contexts = view.blocks.flatMap(block => {
    if (!publicProductBlocks.has(block.type)) return [];
    const data = block.data as Record<string, any>;
    const id = block.type === "product_card" ? data.id : data.productId;
    return typeof id === "string" && id ? [{ productId: id, name: String(data.productName ?? data.name ?? "Produto") }] : [];
  });
  return contexts.length && contexts.every(c => c.productId === contexts[0]!.productId) ? contexts[0] : undefined;
}

const purchase = (action: StoreUiAction) => action.kind === "tool" && ["add_item_to_cart", "accept_cross_sell_offer"].includes(action.tool);
const identity = (action: StoreUiAction) => action.kind === "tool"
  ? JSON.stringify([action.tool, Object.entries(action.args).sort(([a], [b]) => a.localeCompare(b))]) : JSON.stringify(action);

/** Keep only a purchase already admitted by the product/offer UI. The cart or
 * offer authority revalidates price, stock and consent when it is selected. */
export function withMetaProductNavigation(view: MetaUiView, source: MetaUiView | undefined,
  state: WhatsAppConversationState, requestedProductId?: string): MetaUiView {
  if (view.stage === "checkout" || state.stage === "checkout" || view.blocks.some(b => b.type === "buyer_hub_actions")) return view;
  // A fresh product/offer result replaces the old admission, including when
  // stock disappeared or a different variant/options selection is required.
  if (view.blocks.some(b => b.type === "product_card" || b.type === "post_cart_offer")) return view;
  const own = metaProductContext(view), parent = metaProductContext(source);
  const productId = requestedProductId ?? own?.productId;
  if (!productId || own && own.productId !== productId) return view;
  const same = parent?.productId === productId;
  const context = same ? { ...parent!, ...own, ...(parent!.offerId ? { offerId: parent!.offerId } : {}) }
    : own ?? { productId, name: "Produto" };
  const offer = state.postCartOffer;
  const activeOffer = context?.offerId && offer?.id === context.offerId && offer.productId === productId
    && offer.cartId === state.conversationId && offer.status === "pending" && offer.expiresAt > Date.now();
  const admitted = same ? source!.choices.filter(c => {
    if (!purchase(c.action) || c.action.kind !== "tool") return false;
    if (c.action.tool === "accept_cross_sell_offer") return !!activeOffer && c.action.args.offerId === context.offerId;
    if (context.offerId) return false;
    if (state.selectedProductId === productId && state.selectedVariantId && c.action.args.variantId !== state.selectedVariantId) return false;
    return true;
  }) : [];
  // Never replace an offer with a full-price direct add or reuse a different
  // product's variant. Variant/options selection stays in the canonical detail.
  const choices = [...view.choices];
  for (const choice of admitted) if (!choices.some(c => identity(c.action) === identity(choice.action))) choices.push(choice);
  const hasPurchase = choices.some(c => purchase(c.action));
  if (!hasPurchase && !choices.some(c => c.action.kind === "tool" && c.action.tool === "get_product_details" && c.action.args.productId === productId)) {
    choices.push({ label: "Escolher opções", action: { kind: "tool", tool: "get_product_details", args: { productId } } });
  }
  const primaryAction = same && source?.primaryAction && admitted.some(c => identity(c.action) === identity(source.primaryAction!.action)) ? source.primaryAction : view.primaryAction;
  return { ...view, productContext: context, choices, primaryAction };
}
