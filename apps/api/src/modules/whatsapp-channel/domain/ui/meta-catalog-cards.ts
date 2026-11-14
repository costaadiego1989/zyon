import { createHash } from "node:crypto";
import type { MetaUiChoice, MetaUiMessage, MetaUiPresentation, MetaUiView, StoreUiAction } from "./meta-ui.types.js";
import { publicProductSummary } from "../../../storefront/domain/services/public-product-summary.js";
import { metaAnimationsFirst } from "./meta-compact-presentation.js";

const safeImage = (input: unknown): string | undefined => {
  try { const url = new URL(String(input)); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
};
export function metaProductRating(product: { rating?: unknown; reviewCount?: unknown }): string {
  const count = product.reviewCount;
  if (count === 0) return "💬 Ainda sem avaliações.";
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) return "⭐ Confira as avaliações nos detalhes.";
  const rating = product.rating;
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating < 1 || rating > 5) return `⭐ ${count} ${count === 1 ? "avaliação" : "avaliações"}. Confira as notas nos detalhes.`;
  return `⭐ *${rating.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/5* · ${count} ${count === 1 ? "avaliação" : "avaliações"}`;
}

/** A card may reuse only the variant and availability supplied by the scoped
 * catalog read. Required options and services always open canonical details. */
export function metaProductCard(product: Record<string, any>, detail: MetaUiChoice): NonNullable<MetaUiView["catalogCards"]>[number] {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const available = variants.filter(v => v.stock !== 0);
  const single = available.length === 1 && typeof available[0].id === "string" && available[0].id;
  const direct = product.inStock === true && variants.length === 1 && single && !product.optionGroups?.length && !product.serviceSchedule && product.source !== "marketplace";
  const primary: MetaUiChoice | undefined = product.inStock === false ? undefined : direct
    ? { label: "🛒 Adicionar", action: { kind: "tool", tool: "add_item_to_cart", args: { variantId: single, quantity: 1, selectedOptionItemIds: [] } } }
    : { label: "Escolher opções", action: detail.action };
  const price = product.priceFormatted || new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(product.price) / 100);
  const summary = typeof product.description === "string" && product.description.trim() ? publicProductSummary(product.description) : "";
  const notices = (Array.isArray(product.ruleNotices) ? product.ruleNotices : []).map(n => typeof n.message === "string" ? n.message : "").filter(Boolean);
  return { kind: "product", name: String(product.name),
    body: [`📦 *${product.name}*\n💰 *${price}*`, metaProductRating(product), summary, product.inStock === false ? "_Indisponível no momento._" : "", ...notices].filter(Boolean).join("\n\n"),
    imageUrl: safeImage(product.image || product.imageUrl || product.image_url || product.images?.[0]),
    choices: primary && direct ? [{ ...detail, label: "Ver detalhes" }, primary] : primary ? [primary] : [{ ...detail, label: "Ver detalhes" }] };
}

/** Each returned catalog batch presents up to ten product cards, each with
 * its own persisted purchase/read controls and an honest displayed count. */
export function presentMetaCatalogCards(view: MetaUiView, revision: string, requestedPage: number,
  options: { native?: boolean; includeMedia?: boolean; navigationOnly?: boolean }, speech: (body: string) => string): MetaUiPresentation | undefined {
  const cards = view.catalogCards;
  if (!cards?.length || view.stage === "checkout" || view.productContext
    || view.blocks.some(b => ["product_card", "post_cart_offer", "product_comparison", "comparison_table"].includes(b.type))) return;
  // Long published restrictions retain the existing full-content navigation;
  // an attractive card must never clip a mandatory notice to fit a button.
  if (cards.some(card => Array.from(speech(card.body)).length > 1024 || card.choices.length < 1 || card.choices.length > 3
    || card.choices.some(choice => Array.from(choice.label).length > 20))) return;
  const category = cards[0]!.kind === "category";
  const pageSize = category ? 3 : 10, totalPages = Math.ceil(cards.length / pageSize);
  const page = Math.max(0, Math.min(Math.floor(requestedPage), totalPages - 1));
  const current = cards.slice(page * pageSize, (page + 1) * pageSize);
  const selections: Record<string, StoreUiAction> = {}, numericSelections: StoreUiAction[] = [];
  const choices = (list: MetaUiChoice[], scope: string) => list.map((choice, index) => {
    const id = "zyon:" + createHash("sha256").update(`${revision}:cards:${page}:${scope}:${index}`).digest("hex").slice(0, 32);
    selections[id] = choice.action; numericSelections.push(choice.action);
    return { type: "reply", reply: { id, title: choice.label } };
  });
  const messages: MetaUiMessage[] = [];
  const start = page * pageSize + 1, end = start + current.length - 1;
  // A search can contain required-condition disclosures: never replace its
  // prose with a generic sales sentence when changing the card presentation.
  if (!options.navigationOnly && page === 0 && view.body) messages.push({ type: "text", text: { body: speech(view.body) } });
  if (!options.navigationOnly && options.includeMedia !== false && page === 0 && view.blocks.some(b => b.type === "commerce_animation"))
    messages.push(...view.media.filter(m => m.type === "sticker" || m.type === "video").slice(0, 1));
  for (const [index, card] of current.entries()) {
    const buttons = choices(card.choices, String(index));
    if (options.native === false) messages.push({ type: "text", text: { body: `${speech(card.body)}\n\n${card.choices.map((choice, offset) => `${numericSelections.length - card.choices.length + offset + 1}. ${choice.label}`).join("\n")}` } });
    else messages.push({ type: "interactive", interactive: { type: "button",
      ...(card.imageUrl && options.includeMedia !== false ? { header: { type: "image", image: { link: card.imageUrl } } } : {}),
      body: { text: speech(card.body) }, action: { buttons } } });
  }
  const navigation: MetaUiChoice[] = [];
  if (page > 0) navigation.push({ label: "Anteriores", action: { kind: "page", page: page - 1 } });
  if (page < totalPages - 1) navigation.push({ label: category ? "Mais categorias" : "Próximos produtos", action: { kind: "page", page: page + 1 } });
  else {
    const cursor = view.choices.find(c => c.action.kind === "tool" && c.action.tool === "search_products" && c.action.args.cursor);
    if (cursor) navigation.push({ ...cursor, label: "Mais produtos" });
  }
  navigation.push({ label: "Menu principal", action: { kind: "message", message: "/atalhos" } });
  const buttons = choices(navigation, "navigation");
  const caption = `${category ? "Categorias" : "Produtos"} ${start} a ${end} de ${cards.length} nesta lista.`;
  if (options.native === false) messages.push({ type: "text", text: { body: `${caption}\n\n${navigation.map((c, index) => `${numericSelections.length - navigation.length + index + 1}. ${c.label}`).join("\n")}` } });
  else messages.push({ type: "interactive", interactive: { type: "button", body: { text: speech(caption) }, action: { buttons } } });
  return { messages: metaAnimationsFirst(messages, view), selections, numericSelections, page, totalPages };
}
