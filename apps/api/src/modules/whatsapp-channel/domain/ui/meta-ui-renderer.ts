import { createHash } from "node:crypto";
import type { MetaUiChoice, MetaUiMessage, MetaUiPresentation, MetaUiView, StoreUiAction, WhatsAppStructuredResponse } from "./meta-ui.types.js";
import { serviceSlotLabel } from "../../../catalog/domain/services/service-schedule.js";
import { metaStoreQuickReplyAction } from "./meta-store-actions.js";
import { commercialNoticesSchema } from "../../../storefront/domain/contracts/commercial-notice.schemas.js";
import { receiptSummaryLines } from "../../../notifications/domain/paid-order-receipt.js";
import { publicProductSummary } from "../../../storefront/domain/services/public-product-summary.js";
import { metaProductComparison } from "./meta-product-comparison.js";
import { metaProductContext } from "./meta-product-navigation.js";
import { checkoutTone } from "../../../checkout/domain/services/checkout-collection-copy.js";
import { compactMetaPresentation, metaCatalogCopy } from "./meta-compact-presentation.js";

const object = (value: unknown): Record<string, any> => value && typeof value === "object" ? value as Record<string, any> : {};
const items = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.map(object) : [];
const value = (input: unknown): string => typeof input === "string" ? input : input == null ? "" : String(input);
const money = (amount: unknown): string => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(amount) || 0);
const concise = (text: string, limit: number): string => Array.from(text).slice(0, limit).join("");
const productRowTitle = (name: string): string => {
  if (Array.from(name).length <= 24) return name;
  const [base, ...rest] = name.split(" — ");
  const suffix = rest.join(" — ").trim();
  // A color suffix is a variation, never the identity of the whole product.
  const colorOnly = /^(?:pret[oa]|branc[oa]|azul|verde|vermelh[oa]|cinza|rosa|prata|dourad[oa]|bege)$/i.test(suffix);
  const product = suffix && !colorOnly ? suffix : base!.trim();
  if (Array.from(product).length <= 24) return product;
  const words = product.split(/\s+/);
  let modelIndex = -1;
  words.forEach((word, index) => { if (/^(?=[\p{L}\d-]*\p{L})(?=[\p{L}\d-]*\d)[\p{L}]+\d{2,}[\p{L}\d-]*$/u.test(word)) modelIndex = index; });
  if (modelIndex > 0) {
    const model = words[modelIndex]!;
    const prefix = words.slice(0, Math.min(2, modelIndex)).join(" ");
    const label = `${prefix} ${model}`;
    if (Array.from(label).length <= 24) return label;
    const shorter = `${words[0]} ${model}`;
    if (Array.from(shorter).length <= 24) return shorter;
  }
  const prefix = concise(product, 23);
  const boundary = prefix.lastIndexOf(" ");
  return boundary > 0 ? prefix.slice(0, boundary) : concise(product, 24);
};
const variantTitle = (variant: Record<string, any>): string => {
  const attribute = value(variant.name);
  const choice = value(variant.value || variant.sku || variant.id);
  return attribute && attribute !== "SKU" && variant.value
    ? `${attribute.charAt(0).toLocaleUpperCase("pt-BR")}${attribute.slice(1)}: ${choice}` : choice;
};
const tool = (name: string, args: Record<string, unknown>): StoreUiAction => ({ kind: "tool", tool: name, args });
// PostgreSQL JSONB may reorder object keys. Menu identity is defined by action
// values, so a persisted/reloaded view must not duplicate its fixed shortcuts.
const actionKey = (action: StoreUiAction): string => JSON.stringify(action, (_key, entry) =>
  entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const safeLink = (input: unknown): string | undefined => {
  try { const url = new URL(value(input)); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
};
const paragraphs = (text: string, max = 3500): string[] => {
  const result: string[] = []; let remaining = text.trim();
  while (remaining.length > max) { const split = remaining.lastIndexOf("\n", max); const end = split > max / 2 ? split : max; result.push(remaining.slice(0, end)); remaining = remaining.slice(end).trim(); }
  if (remaining) result.push(remaining); return result;
};
export const formatMetaText = (text: string): string => text
  .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
  .replace(/<\s*(strong|b)\b[^>]*>([\s\S]*?)<\/\s*\1\s*>/gi, "*$2*")
  .replace(/<\s*(em|i)\b[^>]*>([\s\S]*?)<\/\s*\1\s*>/gi, "_$2_")
  .replace(/<\s*br\s*\/?\s*>/gi, "\n").replace(/<\/\s*(p|div|h[1-6]|li)\s*>/gi, "\n")
  .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/\*\*([^*]+)\*\*/g, "*$1*").replace(/__([^_]+)__/g, "*$1*")
  .replace(/^#{1,6}\s+(.+)$/gm, "*$1*").replace(/~~([^~]+)~~/g, "~$1~")
  .replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g, "$1: $2");

/** Prose rhythm only. Codes, URLs and structured list lines keep their bytes. */
export const formatMetaConversation = (text: string): string => formatMetaText(text)
  .replace(/\r\n/g, "\n").split(/\n{2,}/).map(paragraph => {
    if (paragraph.length < 180 || paragraph.includes("\n") || /https?:\/\/|000201|```/.test(paragraph)) return paragraph;
    return paragraph.replace(/([.!?])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/g, "$1\n\n");
  }).join("\n\n").trim();

/** Presentation is applied only to prose; payment payloads remain separate. */
export function formatMetaSpeech(text: string): string {
  if (/^\s*000201\S+\s*$/.test(text)) return text;
  const icons: Record<string, string> = {
    "descrição": "📝", "informações do produto": "ℹ️", "perguntas sobre o produto": "💬",
    "avaliações": "⭐", "comparação de produtos": "🔎", "confirme sua conta": "🔐",
    "converse à vontade": "💬", "resumo do pedido": "🧾", "resumo da compra": "🧾", "seu pedido": "🧾",
    "pagamento por pix": "💠", "pagamento seguro": "🔒", "confira o cep": "📍",
  };
  const content = formatMetaConversation(text)
    .replace(/^(\*([^*\n]+)\*)$/gm, (line, heading, label: string) => icons[label.toLocaleLowerCase("pt-BR")] ? `${icons[label.toLocaleLowerCase("pt-BR")]} ${heading}` : line)
    .replace(/^((?:Subtotal|Produtos):)/gm, "🛍️ $1").replace(/^(Frete:)/gm, "🚚 $1")
    .replace(/^(Descontos?:)/gm, "🏷️ $1").replace(/^(Taxa de serviço:)/gm, "ℹ️ $1")
    .replace(/^(\*Total (?:a pagar|parcial|do pagamento):)/gm, "💳 $1")
    .replace(/^(\*[^*\n]+\*)\n(?=\*R\$)/gm, "📦 $1\n");
  return content.startsWith("🤖") ? content : `🤖 ${content}`;
}

/** Channel presentation only: all commercial values and actions come from the store. */
export function buildMetaUiView(response: WhatsAppStructuredResponse, options: { selectionOnly?: boolean; cartEditing?: boolean } = {}): MetaUiView {
  const view: MetaUiView = { stage: response.state.stage, title: response.merchantName || "Sua loja", body: response.agentMessage, choices: [], media: [], blocks: response.blocks, quickReplies: response.quickReplies };
  const cartJustAdded = response.blocks.some(block => block.type === "cart_add_result" && object(block.data).status === "succeeded");
  const narratedOffer = response.state.postCartOffer?.status === "pending"
    && typeof response.state.postCartOffer.id === "string" && response.state.postCartOffer.id.length > 0
    && typeof response.state.postCartOffer.sourceVariantId === "string" && response.state.postCartOffer.sourceVariantId.length > 0
    && response.blocks.some(block => block.type === "post_cart_offer" && object(block.data).offerId === response.state.postCartOffer?.id)
    && response.blocks.some(block => block.type === "cart_add_result" && object(block.data).status === "succeeded"
      && object(block.data).variantId === response.state.postCartOffer?.sourceVariantId);
  const redundantIntro = response.blocks.some(block => ["cart_summary", "wishlist"].includes(block.type))
    && /^(?:Este é o seu carrinho:|Seu carrinho:|Sua lista de desejos:|Confira sua lista de desejos:)$/.test(response.agentMessage.trim());
  const redundantAdd = cartJustAdded && /^Produto adicionado ao carrinho\.?$/.test(response.agentMessage.trim());
  const text: string[] = redundantIntro || redundantAdd ? [] : [formatMetaConversation(metaCatalogCopy(response.agentMessage, response.blocks))];
  const selectionText: string[] = [];
  const fullDescriptions: string[] = [];
  const add = (label: string, action: StoreUiAction, description?: string) => view.choices.push({ label, action, description });
  const photo = (url: unknown, caption?: string) => { const link = safeLink(url); if (link && !view.media.some(m => m.type === "image" && m.media.link === link)) view.media.push({ type: "image", media: { link, caption: caption ? concise(caption, 1024) : undefined } }); };
  const productChoice = (p: Record<string, any>) => {
    const price = p.priceFormatted || money(Number(p.price) / 100);
    add(value(p.name), tool("get_product_details", { productId: p.productId || p.id }), [price, p.sellerName, p.inStock === false ? "Indisponível" : ""].filter(Boolean).join(" · "));
    view.choices.at(-1)!.summary = typeof p.description === "string" && p.description.trim() ? publicProductSummary(p.description) : undefined;
    const link = safeLink(p.image || p.imageUrl || p.image_url || p.images?.[0]);
    if (link) view.choices.at(-1)!.image = { link, caption: concise(`*${value(p.name)}*\n💰 ${price}\n\n${publicProductSummary(p.description)}${p.inStock === false ? "\n_Indisponível_" : ""}`, 1024) };
  };
  const contentProductLink = (productId: unknown, label: unknown, adding: boolean) => {
    const id = value(productId);
    // The product card owns admission, variants, options and schedule. A rich
    // content CTA for that product must not create a competing shopping action.
    if (adding && response.blocks.some(b => b.type === "product_card" && object(b.data).id === id)) return;
    if (id) add(adding ? "Escolher produto" : value(label || "Ver produto"), tool("get_product_details", { productId: id }));
  };
  for (const block of response.blocks) {
    const d = object(block.data);
    switch (block.type) {
      case "text": case "message": text.push(value(d.text || d.content)); break;
      case "commerce_animation": case "payment_paid_animation": case "welcome_animation": {
        const link = safeLink(d.url);
        if (link) view.media.push({ type: new URL(link).pathname.endsWith(".webp") ? "sticker" : "video", media: { link } });
        break;
      }
      case "form_field": text.push(`Informe ${value(d.label || d.field)}:`); break;
      case "address_confirmation": text.push(`*Confira a entrega*\n${value(d.formatted)}\n\n_O endereço está correto?_`); add("Sim", { kind: "message", message: "Sim" }); add("Corrigir endereço", { kind: "message", message: "Não" }); break;
      case "payment_method_switch": case "payment_methods":
        items(d.methods).forEach(m => add(value(m.label), d.nativePayment && d.fingerprint
          ? tool("create_payment", { method: m.key, fingerprint: d.fingerprint }) : { kind: "message", message: value(m.label) }, value(m.sub)));
        if (d.nativePayment && d.couponAllowed) add("Usar cupom", tool("edit_checkout", { section: "coupon", fingerprint: d.fingerprint }));
        break;
      case "checkout_edit_actions":
        items(d.methods).forEach(m => add(value(m.label), tool("create_payment", { method: m.key, fingerprint: d.fingerprint }), value(m.sub)));
        add("Trocar pagamento", tool("edit_checkout", { section: "payment", fingerprint: d.fingerprint }));
        if (d.couponAllowed) add("Usar cupom", tool("edit_checkout", { section: "coupon", fingerprint: d.fingerprint }));
        break;
      case "checkout_edit_confirmation":
        add("Confirmar troca", tool("confirm_checkout_edit", { section: d.section, fingerprint: d.fingerprint, intentId: d.intentId }));
        add("Manter pagamento", tool("cancel_checkout_edit", {}));
        break;
      case "coupon_entry": add("Cancelar cupom", tool("cancel_coupon_entry", {})); break;
      case "payment_actions": add("Gerar Pix", tool("create_payment", { method: "pix", fingerprint: d.fingerprint })); break;
      case "coupon_input": text.push("Qual é o código do cupom?"); break;
      case "offer_coupon": text.push(value(d.message || d.description || d.label)); add("Aplicar oferta", { kind: "message", message: "Aplicar oferta" }); break;
      case "stripe_card": case "hosted_card_payment": text.push("Pague com cartão pelo checkout seguro da loja."); break;
      case "boleto_payment": if (safeLink(d.ticket_url || d.url)) text.push(`Boleto: ${safeLink(d.ticket_url || d.url)}`); break;
      case "pix_payment": if (d.copy_paste || d.qrCodeCopyPaste) view.media.push({ type: "text", text: { body: value(d.copy_paste || d.qrCodeCopyPaste) } }); break;
      case "crypto_chain_select": add("Polygon", { kind: "message", message: "Polygon" }); add("Base", { kind: "message", message: "Base" }); break;
      case "crypto_payment": text.push("Conecte sua carteira pelo checkout seguro para concluir o pagamento."); break;
      case "checkout_price_review": text.push("Os valores do pedido mudaram. Confira e confirme o novo total no checkout seguro."); break;
      case "lead_capture": text.push("Informe seus dados para continuar. Você também pode usar o formulário no checkout seguro."); break;
      case "order_summary": text.push("*Resumo do pedido*", items(d.items).map(i => `- ${value(i.quantity)}× ${value(i.name)} — *${money(i.line_total ?? i.price)}*`).join("\n")); break;
      case "wishlist":
        if (items(d.items).length) text.push("♡ *Seus favoritos*\nAbra um produto para ver os detalhes ou use as opções da lista.");
        items(d.items).forEach(p => { productChoice(p); if (p.id) add(`Remover: ${value(p.name)}`, tool("remove_from_wishlist", { productId: p.id })); });
        break;
      case "post_cart_offer": {
        const offer = response.state.postCartOffer;
        if (offer && typeof offer.id === "string" && offer.id.length > 0 && offer.id === d.offerId && offer.status === "pending" && offer.expiresAt > Date.now()) {
          const cart = object(response.blocks.find(b => b.type === "cart_summary")?.data);
          const units = items(cart.items).reduce((n, i) => n + Number(i.quantity || 0), 0);
          view.offerPresentation = { confirmation: `✅ *${offer.addedName}* adicionado ao carrinho.${units ? `\n${units} ${units === 1 ? "unidade" : "unidades"} · *${money(cart.total)}*` : ""}`,
            body: response.agentMessage, imageUrl: safeLink(d.imageUrl) };
          add("Adicionar", tool("accept_cross_sell_offer", { offerId: d.offerId }), "Adicionar uma unidade recomendada");
          view.productContext = { productId: offer.productId, name: value(d.name), offerId: offer.id };
          view.primaryAction = { label: "🛒 Adicionar", action: tool("accept_cross_sell_offer", { offerId: offer.id }),
            body: `💡 *Recomendação para sua compra*\n📦 *${value(d.name)}*\n\nGostou? Adicione uma unidade ao seu carrinho.` };
          add("Ver detalhes", tool("cross_sell_offer_details", { offerId: d.offerId }));
          add("Não, obrigado", tool("decline_cross_sell_offer", { offerId: d.offerId }), "Manter apenas os itens escolhidos");
        }
        break;
      }
      case "product_carousel": case "marketplace_products": case "cross_sell":
        items(d.products ?? d.items).forEach(productChoice);
        if (d.nextCursor) add("Mais produtos", tool("search_products", { query: d.query || "*", categoryId: d.categoryId, cursor: d.nextCursor, ...(d.criteria ? { criteria: d.criteria } : {}) }));
        break;
      case "product_card": {
        view.productContext = { productId: value(d.id), name: value(d.name) };
        if (d.sellerName) { const seller = `Vendido por: ${value(d.sellerName)}`; text.push(seller); selectionText.push(seller); }
        const retailerId = response.state.catalogRetailerIds?.[value(d.variants?.[0]?.id)] ?? response.state.catalogRetailerIds?.[value(d.sku ?? d.variants?.[0]?.sku)];
        if (response.state.catalogId && retailerId && response.state.catalogPrices?.[retailerId] === Number(d.variants?.[0]?.price ?? d.price) && items(d.variants).length <= 1 && !items(d.optionGroups).length && !d.serviceSchedule) view.media.push({ type: "interactive", interactive: {
          type: "product", body: { text: concise(`${value(d.name)}\n\n${publicProductSummary(d.description)}`, 1024) }, action: { catalog_id: response.state.catalogId, product_retailer_id: retailerId } } });
        const variants = items(d.variants).filter(v => ["digital", "service"].includes(d.productType) || v.stock !== 0);
        const remembered = response.state.selectedProductId === d.id ? response.state.selectedVariantId : undefined;
        const selected = variants.find(v => v.id === remembered)?.id;
        const variantId = remembered ? selected : (variants.length === 1 ? value(variants[0].id) : undefined);
        const selectedVariant = variants.find(v => v.id === variantId);
        const price = selectedVariant?.priceFormatted || (selectedVariant?.price != null ? money(Number(selectedVariant.price) / 100) : d.priceFormatted || money(Number(d.price) / 100));
        const heading = `*${value(d.name)}*\n*${price}*${d.inStock === false ? "\n_Indisponível_" : ""}`;
        text.push(heading); selectionText.push(heading);
        text.push(`📄 *Descrição*\n${publicProductSummary(d.description)}`);
        if (Array.from(value(d.description)).length > 200) {
          const full = formatMetaText(value(d.description));
          fullDescriptions.push(full);
          if (!options.selectionOnly) add("Ler descrição completa", tool("show_content", { text: full }));
        }
        if (Number(d.reviewCount) > 0 && d.rating != null) text.push(`*Avaliações*\n${Number(d.rating).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} / 5 · ${value(d.reviewCount)} avaliação(ões)`);
        if (!(response.state.catalogId && retailerId && response.state.catalogPrices?.[retailerId] === Number(d.variants?.[0]?.price ?? d.price) && items(d.variants).length <= 1 && !items(d.optionGroups).length && !d.serviceSchedule)) photo(selectedVariant?.image || d.image || d.images?.[0], `*${value(d.name)}*\n*${price}*`);
        if (selectedVariant && selected) { const selectedLabel = `_Selecionado: ${variantTitle(selectedVariant)}_`; text.push(selectedLabel); selectionText.push(selectedLabel); }
        else if (variants.length === 1 && selectedVariant?.name && selectedVariant.name !== "SKU" && selectedVariant.value) {
          const selectedLabel = `*${value(selectedVariant.name)}:* ${value(selectedVariant.value)}`;
          text.push(selectedLabel); selectionText.push(selectedLabel);
        }
        const groups = items(d.optionGroups); const chosen = response.state.selectedOptionItemIds ?? [];
        const pending = groups.find(g => (g.required || Number(g.minSelections) > 0) && items(g.items).filter(i => chosen.includes(value(i.id))).length < Number(g.minSelections ?? 1));
        const editing = groups.find(g => g.id === response.state.selectedOptionGroupId) ?? pending;
        const schedule = object(d.serviceSchedule);
        const slot = items(schedule.slots).find(s => s.slotId === response.state.selectedServiceSlotId && s.selectable !== false);
        if (d.serviceSchedule && !slot) {
          text.push("Escolha um horário disponível:");
          selectionText.push("Escolha um horário disponível:");
          items(schedule.slots).filter(s => s.selectable !== false).forEach(s => add(serviceSlotLabel(s as any), { kind: "slot", productId: value(d.id), slotId: value(s.slotId) }));
        } else if (slot) { const selectedLabel = `Horário escolhido: ${serviceSlotLabel(slot as any)}`; text.push(selectedLabel); selectionText.push(selectedLabel); }
        if (editing) {
          text.push(`Escolha ${value(editing.name)}:`);
          selectionText.push(`Escolha ${value(editing.name)}:`);
          items(editing.items).forEach(i => add(`${chosen.includes(value(i.id)) ? "✓ " : ""}${value(i.name)}`, { kind: "option", productId: value(d.id), groupId: value(editing.id), itemId: value(i.id) }, i.priceModifierInCents ? money(Number(i.priceModifierInCents) / 100) : undefined));
          if (!pending) add("Confirmar adicionais", { kind: "option_group", productId: value(d.id) });
        } else if (variantId && d.inStock !== false && (!d.serviceSchedule || slot)) {
          const action = tool("add_item_to_cart", { variantId, quantity: 1, selectedOptionItemIds: chosen, selectedServiceSlotId: slot?.slotId });
          add("Adicionar ao carrinho", action);
          view.primaryAction = { label: "🛒 Adicionar", action, body: concise(`📦 *${value(d.name)}*\n\nAdicione 1 unidade do produto selecionado ao seu carrinho.`, 1000) };
        }
        groups.forEach(g => { if (g.id !== editing?.id) add(`Personalizar ${value(g.name)}`, { kind: "option_group", productId: value(d.id), groupId: value(g.id) }); });
        const selectedOptions = groups.flatMap(g => items(g.items).filter(i => chosen.includes(value(i.id))).map(i => `${value(g.name)}: ${value(i.name)}${i.priceModifierInCents ? ` (+${money(Number(i.priceModifierInCents) / 100)})` : ""}`));
        if (selectedOptions.length) { text.push(selectedOptions.join("\n")); selectionText.push(selectedOptions.join("\n")); }
        if (variants.length > 1 || remembered && !selected) variants.forEach(v => add(`${v.id === selected ? "✓ " : ""}${variantTitle(v)}`, { kind: "variant", productId: value(d.id), variantId: value(v.id) }, v.priceFormatted));
        if (Array.isArray(d.images) && d.images.length > 1) add("Ver fotos", tool("product_gallery", { productId: d.id, images: d.images }));
        add("Salvar nos favoritos", tool("add_to_wishlist", { productId: d.id }));
        items(d.ruleNotices).forEach(n => { text.push(value(n.message)); selectionText.push(value(n.message)); });
        break;
      }
      case "category_carousel":
        items(d.categories).forEach(c => add(value(c.name), tool("search_products", { query: "*", categoryId: c.id }), c.productCount == null ? undefined : `${c.productCount} produtos`)); break;
      case "variant_selector":
        items(d.groups).forEach(g => items(g.options).filter(o => o.available !== false).forEach(o => add(`${value(g.name)}: ${value(o.value)}`, { kind: "variant", productId: value(d.productId), variantId: value(o.id) }))); break;
      case "cart_summary":
        view.cartEditing = options.cartEditing === true;
        text.push("🛒 *Seu carrinho*");
        if (!items(d.items).length) text.push("Seu carrinho está vazio. Escolha um produto para começar.");
        if (!cartJustAdded && response.state.catalogId) {
          const retailerIds = [...new Set(items(d.items).flatMap(item => {
            const retailerId = response.state.catalogRetailerIds?.[value(item.variantId)];
            const priceCents = Math.round(Number(item.price) * 100);
            return retailerId && Number.isSafeInteger(priceCents) && priceCents > 0
              && response.state.catalogPrices?.[retailerId] === priceCents
              && !items(item.selectedOptions).length && !item.selectedServiceSlotId
              ? [retailerId] : [];
          }))];
          if (retailerIds.length) view.media.push({ type: "interactive", interactive: {
            type: "product_list", header: { type: "text", text: "Produtos no carrinho" },
            body: { text: `🛒 Confira as fotos dos seus itens${retailerIds.length < items(d.items).length || retailerIds.length > 30 ? " disponíveis nesta lista" : ""}. Para editar as quantidades da compra atual, use as opções da conversa.\n\nEnviar um carrinho pelo catálogo adiciona as unidades selecionadas à sua compra.${retailerIds.length > 30 ? "\n\nEsta lista mostra os primeiros 30 produtos. O resumo da conversa contém todos os itens." : ""}` },
            action: { catalog_id: response.state.catalogId, sections: [{ title: "Itens da sua compra", product_items: retailerIds.slice(0, 30).map(id => ({ product_retailer_id: id })) }] },
          } });
        }
        items(d.items).forEach((i, index) => {
          text.push(`${i.quantity}× *${value(i.productName || i.name)}*${i.variantLabel ? ` · ${value(i.variantLabel)}` : ""} — ${money(i.subtotal)}`);
          items(i.selectedOptions).forEach(o => text.push(`${value(o.groupName)}: ${value(o.itemName)}`));
          if (i.selectedServiceSlotId) text.push(`Agendamento: ${value(i.selectedServiceSlotId)}`);
          const selector = { ...(i.optionItemIds === undefined ? {} : { optionItemIds: i.optionItemIds }), ...(i.serviceSlotId === undefined ? {} : { serviceSlotId: i.serviceSlotId }) };
          const description = `${value(i.productName || i.name)}${i.variantLabel ? ` · ${value(i.variantLabel)}` : ""} · ${i.quantity} un.`;
          if (options.cartEditing) {
            add(`Editar item ${index + 1}`, tool("edit_cart_item", { variantId: i.variantId, quantity: i.quantity, ...selector }), description);
            add(`Remover item ${index + 1}`, tool("remove_cart_item", { variantId: i.variantId, ...selector }), description);
          }
        });
        if (items(d.items).length) text.push(`${d.discount ? `Subtotal: ${money(d.subtotal)}\nDescontos: −${money(d.discount)}\n` : ""}*Total: ${money(d.total)}*\n_Frete e taxas no próximo passo._`);
        if (d.freeShipping) text.push("Frete grátis aplicado.");
        {
          const notices = commercialNoticesSchema.safeParse(d.commercialNotices);
          if (notices.success) for (const notice of notices.data) text.push(notice.message);
        }
        if (items(d.items).length && !options.cartEditing) { add("Finalizar pedido", tool("checkout", {})); add("Editar itens", { kind: "cart_edit_items" }); }
        if (options.cartEditing) add("Meu carrinho", tool("get_cart", {}));
        add("Continuar comprando", tool("search_products", { query: "*" }));
        break;
      case "cart_add_result":
        if (d.status === "succeeded" && narratedOffer && d.variantId === response.state.postCartOffer?.sourceVariantId) break;
        text.push(d.status === "succeeded" ? "✅ *Item adicionado ao carrinho*" : d.status === "unknown" ? "_A inclusão está sendo verificada._" : "Não foi possível adicionar este item."); break;
      case "shipping_options":
        if (items(d.options).length && !/\*(?:Entrega do seu pedido|Opções de entrega)\*/i.test(response.agentMessage))
          text.push("🚚 *Opções de entrega*\nCompare o valor e o prazo antes de escolher.");
        items(d.options).forEach((o, index) => {
          const carrier = value(o.carrier), name = value(o.name);
          const label = carrier.startsWith("melhor-envio-") || carrier.startsWith("own_delivery_")
            ? name : [carrier, name].filter(Boolean).join(" ");
          const eta = o.estimatedUnit === "minutes" && Number.isInteger(o.estimatedValue) && o.estimatedValue > 0
            ? ` · ${o.estimatedValue} minutos` : o.days != null ? ` · ${o.days} dias úteis` : "";
          text.push(`${index + 1}. *${label || "Frete"}*\n💰 ${Number(o.price) === 0 ? "Grátis" : o.priceFormatted || money(o.price)}${eta}`);
          add(label || "Frete", { kind: "message", message: value(o.responseLabel) || `Escolho o frete ${label || "disponível"}` }, `${Number(o.price) === 0 ? "Grátis · benefício da loja" : o.priceFormatted || money(o.price)}${eta}`);
        }); break;
      case "shipping_quote_retry": add("Calcular novamente", tool("checkout_shipping_retry", {})); break;
      case "shipping_quote_input": text.push("Qual é o CEP para calcular a entrega?"); break;
      case "checkout_redirect":
        if (safeLink(d.url)) {
          const instruction = d.purpose === "card" ? "Seu pedido e endereço já estão preenchidos. Abra o pagamento seguro para informar os dados do cartão."
            : d.purpose === "crypto" ? "Seu pedido e endereço já estão preenchidos. Abra o pagamento para conectar sua carteira e concluir."
              : "Este provedor exige seu documento. Informe-o somente no formulário seguro; seu pedido será mantido.";
          view.media.push({ type: "interactive", interactive: { type: "cta_url", body: { text: `🤖 🔒 *${d.purpose === "card" ? "Pagamento com cartão" : d.purpose === "crypto" ? "Pagamento com cripto" : "Dados protegidos"}*\n\n${instruction}` }, action: { name: "cta_url", parameters: { display_text: d.purpose === "card" ? "Pagar com cartão" : d.purpose === "crypto" ? "Pagar com cripto" : "Preencher documento", url: safeLink(d.url) } } } });
        } break;
      case "checkout_prepared": add("Continuar checkout", tool("checkout", { actionId: d.actionId, cartId: d.cartId })); break;
      case "order_confirmation":
        text.push(`🧾 *Pedido ${value(d.orderId)}*\n` + (d.paidReceipt
          ? receiptSummaryLines(d.paidReceipt).map(line => line.startsWith("Total pago:") ? `✅ *${line}*` : line).join("\n")
          : `*Valor do pedido: ${money(d.total)}*`));
        items(d.items).forEach(i => text.push(`${i.quantity}× ${value(i.productName)} — ${money(i.price)}`));
        if (d.estimatedDelivery) text.push(`Previsão: ${value(d.estimatedDelivery)}`); break;
      case "comparison_table": case "product_comparison":
        metaProductComparison(items(d.products)).forEach(body => view.media.push({ type: "text", text: { body } }));
        items(d.products).forEach(productChoice); break;
      case "reviews":
        text.push(`⭐ *Avaliações*\n📦 *${value(d.productName)}*\n\n${Number(d.totalReviews) > 0
          ? `📊 *${d.filter === "positive" ? "Positivas" : d.filter === "negative" ? "Negativas" : "Publicadas"}:* ${value(d.totalReviews)} · Média: *${Number(d.averageRating).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} / 5*\n_Da mais recente para a mais antiga._`
          : "Ainda não há avaliações publicadas para este produto. Você pode continuar explorando ou adicionar ao carrinho quando escolher suas opções."}`);
        items(d.reviews).forEach(r => text.push(`👤 *${value(r.author)}*\n⭐ *${value(r.rating)} / 5*${/^\d{4}-\d{2}-\d{2}$/.test(value(r.date)) ? ` · 📅 ${value(r.date).split("-").reverse().join("/")}` : ""}\n\n${value(r.text)}`));
        if (d.productId) {
          add("Todas as avaliações", tool("get_reviews", { productId: d.productId }));
          add("Positivas", tool("get_reviews", { productId: d.productId, filter: "positive" }));
          add("Negativas", tool("get_reviews", { productId: d.productId, filter: "negative" }));
          add("Ordenar por Recentes", tool("get_reviews", { productId: d.productId, filter: "recent" }));
        }
        if (d.nextCursor) add("Mais avaliações", tool("get_reviews", { productId: d.productId, filter: d.filter, cursor: d.nextCursor })); break;
      case "review_submission":
        text.push("📝 *Avaliação enviada*\n⏳ Ela aguarda a moderação da loja para ser publicada.");
        add("Todas as avaliações", tool("get_reviews", { productId: d.productId }));
        add("Positivas", tool("get_reviews", { productId: d.productId, filter: "positive" }));
        add("Negativas", tool("get_reviews", { productId: d.productId, filter: "negative" }));
        add("Ordenar por Recentes", tool("get_reviews", { productId: d.productId, filter: "recent" })); break;
      case "product_questions":
        text.push(`💬 *Perguntas públicas respondidas*\n📦 *${value(d.productName)}*`);
        items(d.questions).forEach(q => text.push(`❓ *${value(q.question)}*\n💡 ${value(q.answer)}`));
        add("Fazer Pergunta", tool("ask_product_question", { productId: d.productId }));
        add("Ver Respondidas", tool("get_product_questions", { productId: d.productId, filter: "answered" }));
        add("Minhas Perguntas", tool("get_product_questions", { productId: d.productId, filter: "mine" })); break;
      case "question_submission":
        text.push(`📨 *Pergunta encaminhada*\n🎫 Protocolo: *${value(d.ticketId)}*\n⏳ Acompanhe a resposta pelo atendimento da loja.`);
        add("Ver Respondidas", tool("get_product_questions", { productId: d.productId, filter: "answered" }));
        add("Minhas Perguntas", tool("get_product_questions", { productId: d.productId, filter: "mine" })); break;
      case "buyer_product_questions":
        text.push(`🔒 *Suas perguntas com vínculo à conta*\n📦 *${value(d.productName)}*\n${value(d.returnedCount)} pergunta(s) exibida(s).`);
        items(d.questions).forEach(q => text.push(`❓ *${value(q.question)}*\n🎫 Protocolo: *${value(q.ticketId)}*\n⏳ Resposta não vinculada; acompanhe o atendimento.`));
        if (!items(d.questions).length) text.push("Ainda não há perguntas com esse vínculo neste histórico. Isso não comprova ausência de chamados antigos.");
        if (d.hasMore) text.push("Exibimos até 20 registros recentes. Há outros registros; acompanhe os protocolos no atendimento.");
        add("Fazer Pergunta", tool("ask_product_question", { productId: d.productId }));
        add("Ver Respondidas", tool("get_product_questions", { productId: d.productId, filter: "answered" })); break;
      case "product_question_input":
        text.push(`❓ *Sua pergunta para a loja*\n📦 *${value(d.productName)}*\nEscreva a pergunta em uma mensagem. Use *Voltar* para desistir.`); break;
      case "add_review": text.push(`Qual nota de 1 a 5 você dá a ${value(d.productName)}? Conte também como foi sua experiência.`); break;
      case "coupon_list":
        items(d.coupons).forEach(c => add(value(c.code), tool("apply_coupon", { couponCode: c.code }), value(c.description)));
        if (d.progressive) text.push(`🎟️ *Condições de desconto*\n\n• ${value(d.progressive.description)}\n\n_A elegibilidade é conferida no checkout._`); break;
      case "buyer_hub_actions":
        items(d.choices).forEach(choice => add(value(choice.label), tool("buyer_hub", object(choice.args)), value(choice.description) || undefined)); break;
      case "quick_replies":
        if (Array.isArray(d.options)) d.options.forEach((label: unknown) => add(value(label), { kind: "message", message: value(label) })); break;
      case "product_content":
        if (items(d.blocks).length) text.push("*Informações do produto*");
        items(d.blocks).sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)).forEach(content => {
          const c = object(content.data ?? content);
          switch (content.type) {
            case "paragraph": text.push([c.title ? `*${value(c.title)}*` : c.heading ? `*${value(c.heading)}*` : "", c.text].filter(Boolean).join("\n")); break;
            case "heading": text.push(`*${value(c.text || c.title || c.heading)}*`); break;
            case "callout": text.push([c.title || c.heading ? `*${value(c.title || c.heading)}*` : "", c.text ? `_${value(c.text)}_` : ""].filter(Boolean).join("\n")); break;
            case "list": text.push((Array.isArray(c.items) ? c.items : []).map((i: unknown) => `• ${value(i)}`).join("\n")); break;
            case "image": photo(c.src, c.caption || c.alt); break;
            case "image_text_split": photo(c.imageSrc, c.imageAlt); if (c.heading) text.push(`*${value(c.heading)}*`); text.push(value(c.text)); break;
            case "table": text.push(value(c.caption), (Array.isArray(c.rows) ? c.rows : []).map((r: unknown[]) => r.map((v, i) => `${value(c.headers?.[i])}: ${value(v)}`).join(" · ")).join("\n")); break;
            case "faq": if (items(c.items).length) text.push("*Perguntas sobre o produto*\nEscolha uma pergunta no menu ou escreva sua dúvida."); items(c.items).forEach(f => add(value(f.question), { kind: "tool", tool: "show_content", args: { text: `*${value(f.question)}*\n\n${value(f.answer)}` } })); break;
            case "video": { const link = safeLink(["mp4", "url"].includes(c.provider) ? c.ref : c.provider === "youtube" ? `https://www.youtube.com/watch?v=${encodeURIComponent(value(c.ref))}` : `https://vimeo.com/${encodeURIComponent(value(c.ref))}`); if (link) { if (c.provider === "mp4") view.media.push({ type: "video", media: { link, caption: c.caption } }); else text.push(`${value(c.caption)}\n${link}`); } break; }
            case "carousel": items(c.images).forEach(i => photo(i.src, i.alt)); break;
            case "banner": photo(c.imageSrc, c.caption || c.alt); if (c.ctaAction === "add_to_cart") contentProductLink(d.productId || response.state.selectedProductId, c.ctaLabel, true); else if (safeLink(c.linkUrl)) text.push(`${value(c.ctaLabel)}: ${safeLink(c.linkUrl)}`); break;
            case "button": if (c.linkType === "product" || c.linkType === "add_to_cart") contentProductLink(c.productId || d.productId || response.state.selectedProductId, c.label, c.linkType === "add_to_cart"); else if (safeLink(c.href)) text.push(`${value(c.label)}: ${safeLink(c.href)}`); break;
          }
        }); break;
      case "payment_intent":
        if (!response.blocks.some(b => b.type === "checkout_summary" && Math.round(Number(object(b.data).totals?.total_to_pay ?? object(b.data).totals?.total) * 100) === Number(d.amount_cents)))
          text.push(d.amount_cents != null ? `*Total do pagamento: ${money(Number(d.amount_cents) / 100)}*\n\n_O pedido será confirmado após a aprovação do pagamento._` : "_Pagamento pendente de confirmação._");
        if (d.copy_paste) view.media.push({ type: "text", text: { body: value(d.copy_paste) } });
        if (d.method !== "pix" && safeLink(d.ticket_url)) view.media.push({ type: "interactive", interactive: { type: "cta_url", body: { text: "🤖 🔒 *Pagamento seguro*\n\nConclua o pagamento no checkout do provedor." }, action: { name: "cta_url", parameters: { display_text: "Pagar pedido", url: safeLink(d.ticket_url) } } } });
        break;
      case "checkout_summary":
        text.push("*Resumo da compra*");
        items(d.items).forEach((i, index) => text.push(`${index + 1}. *${value(i.name)}*\nQuantidade: ${value(i.quantity)} · ${money(i.line_total ?? Number(i.unit_price) * Number(i.quantity))}`));
        text.push(`Subtotal: ${money(d.totals?.subtotal)}\nFrete: ${d.shippingPending ? "A calcular" : money(d.totals?.shipping)}${d.totals?.discount ? `\nDescontos: ${money(d.totals.discount)}` : ""}${d.totals?.service_fee ? `\nTaxa de serviço: ${money(d.totals.service_fee)}` : ""}\n*${d.shippingPending ? "Total parcial" : "Total a pagar"}: ${money(d.totals?.total_to_pay ?? d.totals?.total)}*`);
        break;
      case "checkout_form":
        view.media.push({ type: "interactive", interactive: { type: "flow", body: { text: `🤖 📝 *Seus dados*\n\nPreencha ${value(d.label).toLowerCase()} ou responda aqui na conversa.` }, action: {
          name: "flow", parameters: { flow_message_version: "3", flow_token: d.token, flow_id: d.flowId, flow_cta: "Preencher dados", flow_action: "navigate",
            flow_action_payload: { screen: "DETAILS", data: { label: d.label } } } } } }); break;
      default: throw new Error(`whatsapp_ui_block_unsupported:${block.type}`);
    }
  }
  response.quickReplies.forEach(label => {
    if (/^remover item$/i.test(label.trim()) && response.blocks.some(block => block.type === "wishlist")) return;
    // The complete public description is already in this view. Reopening it
    // under "Mais informações" repeats the same content instead of adding detail.
    if (/^mais informa[cç][oõ]es$/i.test(label.trim()) && response.blocks.some(b => b.type === "product_card")) return;
    if (/^adicionar.*carrinho$/i.test(label) && view.choices.some(c => c.action.kind === "tool" && c.action.tool === "add_item_to_cart")) return;
    if (/^adicionar.*carrinho$/i.test(label) && response.blocks.some(b => b.type === "product_card")) return;
    if (/^finalizar compra$/i.test(label) && response.blocks.some(b => b.type === "cart_summary" && !items(object(b.data).items).length)) return;
    if (/^tenho um cupom de desconto$/i.test(label.trim()) && view.choices.some(c => c.label === "Usar cupom")) return;
    const presentedLabel = /^mover para carrinho$/i.test(label.trim()) && response.blocks.some(block => block.type === "wishlist") ? "Escolher para comprar" : label;
    add(/^tenho um cupom de desconto$/i.test(label.trim()) ? "Usar cupom" : presentedLabel, metaStoreQuickReplyAction(label, { ...response.state, view }) ?? { kind: "message", message: label });
  });
  const seen = new Set<string>();
  view.choices = view.choices.filter(c => { const key = actionKey(c.action); if (!c.label.trim() || seen.has(key)) return false; seen.add(key); return true; });
  view.body = formatMetaText(text.filter(Boolean).join("\n\n"));
  if (options.selectionOnly && selectionText.length) {
    const fullDetails = [view.body, ...fullDescriptions].join("\n\n");
    view.body = [formatMetaConversation(response.agentMessage), ...selectionText].filter(Boolean).join("\n\n");
    add("Ver detalhes completos", tool("show_content", { text: fullDetails }));
  }
  return view;
}

/** Native selection IDs are scoped to a persisted turn; labels never authorize actions. */
export function withMetaCartNavigation(view: MetaUiView, hasItems?: boolean): MetaUiView {
  // Checkout renders only the controls for the current step. The buyer can
  // always explicitly open /atalhos; field entry must not repeat the store hub.
  if (view.stage === "checkout") return view;
  if (view.blocks.some(block => block.type === "buyer_hub_actions")) return view;
  if (view.blocks.some(block => block.type === "cart_summary") && !view.productContext) return view;
  if (isMetaCatalogView(view)) return { ...view, choices: view.choices.filter(catalogProductChoice) };
  const productContext = metaProductContext(view);
  if (productContext) return { ...view, productContext, choices: view.choices.filter(choice => {
    const action = choice.action;
    if (action.kind === "cart_edit_items") return false;
    if (["back", "menu", "catalog_options"].includes(action.kind)) return false;
    if (action.kind === "tool" && ["search_products", "get_cart", "checkout", "list_categories", "get_daily_deals", "get_wishlist", "edit_cart_item", "update_cart_item", "remove_cart_item"].includes(action.tool)) return false;
    return !(action.kind === "message" && /^(?:\/atalhos|menu|ver produtos|encontrar produto|categorias|ofertas do dia|selecionar produto|ver carrinho|finalizar (?:pedido|compra))$/i.test(action.message));
  }) };
  const browsing: MetaUiChoice[] = [
    { label: "Ver produtos", action: tool("search_products", { query: "*" }) },
    { label: "Encontrar produto", action: { kind: "message", message: "Encontrar produto" } },
  ];
  const choices = view.choices.filter(choice => {
    if (choice.action.kind === "tool" && ["get_cart", "checkout"].includes(choice.action.tool)) return hasItems === undefined;
    return !browsing.some(item => actionKey(item.action) === actionKey(choice.action));
  });
  return { ...view, choices: [...browsing, ...(hasItems ? [
    { label: "Ver carrinho", action: tool("get_cart", {}) },
    { label: "Finalizar pedido", action: tool("checkout", {}) },
  ] as MetaUiChoice[] : []), ...choices] };
}

export function metaWelcomeMessage(greeting: string, merchantName: string, agentName = "Zyon", tone?: unknown): string {
  const merchantCopy = formatMetaConversation(greeting).trim();
  const shop = formatMetaText(merchantName), agent = formatMetaText(agentName);
  const introductions = {
    consultative: `👋 Olá! Seja muito bem-vindo à *${shop}*!\n\nEu sou *${agent}*, assistente virtual da loja. Vou ajudar você a escolher e cuidar do seu pedido.`,
    premium: `👋 Seja bem-vindo à *${shop}*.\n\nSou *${agent}*, assistente virtual da loja. Vou acompanhar sua escolha e os detalhes do seu pedido.`,
    direct: `👋 Olá! Você está na *${shop}*.\n\nSou *${agent}*, assistente virtual. Conte o que procura para começarmos.`,
    friendly: `👋 Oi! Que bom ter você na *${shop}*!\n\nSou *${agent}*, assistente virtual da loja. Vamos encontrar o que você precisa? 😊`,
    technical: `👋 Olá! Bem-vindo à *${shop}*.\n\nSou *${agent}*, assistente virtual. Posso comparar especificações e ajudar na escolha do seu pedido.`,
  };
  return `${merchantCopy ? `${merchantCopy}\n\nSou *${agent}*, assistente virtual da *${shop}*.` : introductions[checkoutTone(tone)]}\n\nConte o que procura ou pergunte sobre produtos, entrega e seu pedido. Para abrir o menu, digite */atalhos*.`;
}

export const isMetaCatalogView = (view?: MetaUiView): boolean => !!view && view.stage !== "checkout" &&
  !view.blocks.some(block => block.type === "product_card") &&
  view.blocks.some(block => ["product_carousel", "marketplace_products", "wishlist", "cross_sell", "product_comparison", "comparison_table"].includes(block.type));

const catalogProductChoice = (choice: MetaUiChoice): boolean => choice.action.kind === "tool" &&
  (choice.action.tool === "get_product_details" || choice.action.tool === "search_products" && !!choice.action.args.cursor);

export function presentMetaUi(view: MetaUiView, revision: string, requestedPage = 0, options: { native?: boolean; includeMedia?: boolean; canGoBack?: boolean; navigationOnly?: boolean } = {}): MetaUiPresentation {
  const offerChoices = view.offerPresentation && view.productContext?.offerId ? view.choices.filter(c => c.action.kind === "tool"
    && ["accept_cross_sell_offer", "cross_sell_offer_details", "decline_cross_sell_offer"].includes(c.action.tool)
    && c.action.args.offerId === view.productContext!.offerId) : [];
  if (view.offerPresentation && offerChoices.length === 3) {
    const selections = Object.fromEntries(offerChoices.map((choice, index) => ["zyon:" + createHash("sha256").update(`${revision}:offer:${index}`).digest("hex").slice(0, 32), choice.action]));
    const offer = view.offerPresentation;
    const messages: MetaUiMessage[] = options.navigationOnly ? [] : [{ type: "text", text: { body: formatMetaSpeech(offer.confirmation) } }];
    if (options.native === false) messages.push({ type: "text", text: { body: `${formatMetaSpeech(offer.body)}\n\n${offerChoices.map((c, i) => `${i + 1}. ${c.label}`).join("\n")}` } });
    else messages.push({ type: "interactive", interactive: { type: "button",
      ...(offer.imageUrl && options.includeMedia !== false ? { header: { type: "image", image: { link: offer.imageUrl } } } : {}),
      body: { text: formatMetaSpeech(offer.body) }, action: { buttons: offerChoices.map((choice, index) => ({ type: "reply", reply: { id: Object.keys(selections)[index], title: choice.label } })) } } });
    return { messages, selections, numericSelections: offerChoices.map(c => c.action), page: 0, totalPages: 1 };
  }
  const parts = paragraphs(formatMetaText(view.body || "Como posso ajudar?"));
  const productDetails = view.blocks.some(block => block.type === "product_card");
  const productContext = metaProductContext(view);
  const catalog = isMetaCatalogView(view);
  const mainMenu = !catalog && view.blocks.some(block => block.type === "buyer_hub_actions" && block.data.scope === "main_menu");
  const cart = view.blocks.some(b => b.type === "cart_summary");
  const pinned = catalog || mainMenu || productContext || cart ? [] : view.choices.filter(choice => ["Ver produtos", "Encontrar produto", "Ver carrinho", "Finalizar pedido"].includes(choice.label));
  let allChoices = view.choices.filter(choice => !pinned.includes(choice));
  if (view.stage === "checkout") {
    const primary = (choice: MetaUiChoice) => choice.action.kind === "tool" && ["create_payment", "edit_checkout", "confirm_checkout_edit", "cancel_checkout_edit", "cancel_coupon_entry"].includes(choice.action.tool);
    allChoices.sort((a, b) => Number(primary(b)) - Number(primary(a)));
  }
  if (catalog) {
    allChoices = allChoices.filter(catalogProductChoice);
  }
  // Preserve the canonical search ordering (price, rating or recency).
  if (!catalog && parts.length > 2) allChoices.unshift({ label: "Ler mais", action: tool("show_content", { text: parts.slice(2).join("\n\n") }) });
  const media = view.media.filter(m => m.type !== "text");
  if (!catalog && media.length > 3) allChoices.unshift({ label: "Ver mais mídias", action: tool("media_page", { media: media.slice(3) }) });
  if (productDetails) {
    const priority = (choice: MetaUiChoice): number => {
      if (choice.action.kind === "variant") return 0;
      if (["option", "slot", "option_group"].includes(choice.action.kind)) return 1;
      if (choice.action.kind === "tool") {
        if (choice.action.tool === "add_item_to_cart") return 2;
        if (["product_gallery", "media_page"].includes(choice.action.tool)) return 3;
        if (["show_content", "get_reviews"].includes(choice.action.tool)) return 4;
        if (choice.action.tool === "get_product_details") return 6;
      }
      return 5;
    };
    allChoices.sort((a, b) => priority(a) - priority(b));
  }
  // Catalog pages reserve room for pagination and the single main-menu entry.
  // The current nine root shortcuts fit together within Meta's ten-row limit.
  const pageSize = mainMenu ? allChoices.length <= 10 ? 10 : 8 : catalog ? 7 : 7 - pinned.length;
  const totalPages = Math.max(1, Math.ceil(allChoices.length / pageSize));
  const page = Math.max(0, Math.min(Math.floor(requestedPage), totalPages - 1));
  const currentChoices = allChoices.slice(page * pageSize, (page + 1) * pageSize);
  const choices: MetaUiChoice[] = productDetails ? [...currentChoices, ...pinned] : [...pinned, ...currentChoices];
  if (page > 0) choices.push({ label: catalog ? "Produtos anteriores" : "Página anterior", action: { kind: "page", page: page - 1 } });
  if (page < totalPages - 1) choices.push({ label: catalog ? "Próximos produtos" : "Mais opções", action: { kind: "page", page: page + 1 } });
  if (catalog || productContext) choices.push({ label: "Menu principal", action: { kind: "message", message: "/atalhos" } });
  if (options.canGoBack && view.stage !== "checkout" && !catalog && !mainMenu && !productContext) choices.push({ label: "Voltar", action: { kind: "back" } });
  const selections: Record<string, StoreUiAction> = {};
  const rows = choices.map((choice, index) => {
    const id = "zyon:" + createHash("sha256").update(`${revision}:${page}:${index}`).digest("hex").slice(0, 32);
    selections[id] = choice.action;
    const product = choice.action.kind === "tool" && choice.action.tool === "get_product_details";
    const description = product ? `${choice.label}${choice.description ? ` · ${choice.description}` : ""}` : choice.description || (choice.label.length > 24 ? choice.label : undefined);
    return { id, title: productRowTitle(choice.label), ...(description ? { description: concise(description, 72) } : {}) };
  });
  const messages: MetaUiMessage[] = [];
  const visibleMedia = options.includeMedia !== false && !options.navigationOnly ? view.media.filter(m => m.type !== "text").slice(0, 3) : [];
  // Product detail starts with its real photo and price, followed by the full
  // published information. Payment instructions retain their existing order.
  const welcome = view.blocks.some(block => block.type === "welcome_animation");
  if (productDetails && !welcome && visibleMedia[0]?.type === "image") messages.push(visibleMedia.shift()!);
  if (!options.navigationOnly && (!catalog || page === 0)) {
    const introduction = welcome ? parts[0]?.split(/\n{2,}/) : undefined;
    if (introduction && introduction.length > 2 && (visibleMedia[0]?.type === "video" || visibleMedia[0]?.type === "sticker")) {
      messages.push({ type: "text", text: { body: formatMetaSpeech(introduction.slice(0, 2).join("\n\n")) } });
      messages.push(visibleMedia.shift()!);
      [introduction.slice(2).join("\n\n"), ...parts.slice(1, 2)].filter(Boolean).forEach(body => messages.push({ type: "text", text: { body: formatMetaSpeech(body) } }));
    } else parts.slice(0, 2).forEach(body => messages.push({ type: "text", text: { body: formatMetaSpeech(body) } }));
  }
  messages.push(...visibleMedia);
  // Very long published names cannot fit either native field. Keep the full
  // name and commercial description on the current page, including later pages.
  const fullProductLabels = currentChoices.filter(choice => choice.action.kind === "tool" && choice.action.tool === "get_product_details"
    && Array.from(choice.label).length > 72)
    .map(choice => `📦 *${choice.label}*${choice.description ? `\n${choice.description}` : ""}`);
  paragraphs(fullProductLabels.join("\n\n")).forEach(body => messages.push({ type: "text", text: { body: formatMetaSpeech(body) } }));
  if (options.includeMedia !== false && !options.navigationOnly) messages.push(...view.media.filter(m => m.type === "text"));
  const productButtonLabel = (choice: MetaUiChoice) => view.primaryAction && actionKey(choice.action) === actionKey(view.primaryAction.action)
    ? view.primaryAction.label : choice.label;
  const compactProductButtons = !!productContext && choices.length <= 3 && choices.every(c => Array.from(productButtonLabel(c)).length <= 20);
  if ((productDetails || productContext) && !compactProductButtons && !options.navigationOnly && options.native !== false && view.primaryAction
    && view.choices.some(choice => actionKey(choice.action) === actionKey(view.primaryAction!.action))) {
    const id = "zyon:" + createHash("sha256").update(`${revision}:${page}:primary:${actionKey(view.primaryAction.action)}`).digest("hex").slice(0, 32);
    selections[id] = view.primaryAction.action;
    messages.push({ type: "interactive", interactive: { type: "button", body: { text: formatMetaSpeech(view.primaryAction.body) },
      action: { buttons: [{ type: "reply", reply: { id, title: view.primaryAction.label } }] } } });
  }
  if (choices.length) {
    const selectedVariation = view.choices.find(choice => choice.action.kind === "variant" && choice.label.startsWith("✓ "));
    const variantPrompt = view.choices.some(choice => choice.action.kind === "variant")
      ? selectedVariation ? `Selecionado: ${selectedVariation.label.slice(2)}.\nAdicione ao carrinho ou escolha outra variação.`
        : "Escolha a variação do produto para continuar." : undefined;
    if (options.native === false) messages.push({ type: "text", text: { body: choices.map((c, i) => `${i + 1}. ${c.label}${c.description ? ` — ${c.description}` : ""}`).join("\n") + "\n\nVocê pode responder pelo número ou escrever sua pergunta." } });
    else if (compactProductButtons || !catalog && choices.length <= 3 && choices.every(c => Array.from(c.label).length <= 20)) messages.push({ type: "interactive", interactive: { type: "button", body: { text: productContext ? `*${concise(productContext.name, 500)}*\nEscolha como continuar.` : view.stage === "checkout" ? view.blocks.some(b => b.type === "shipping_quote_retry") ? "Consulte o frete novamente para continuar." : choices.every(c => ["Sim", "Não"].includes(c.label)) ? "Confirme o endereço acima." : "Escolha como continuar seu pedido." : "Navegue no menu e explore as opções" }, action: { buttons: rows.map((row, i) => ({ type: "reply", reply: { id: row.id, title: concise(compactProductButtons ? productButtonLabel(choices[i]!) : choices[i]!.label, 20) } })) } } });
    else {
      const context = catalog ? "Escolha um produto para ver fotos e informações completas."
        : productDetails ? variantPrompt || "Veja as opções deste produto ou escreva sua dúvida."
          : view.blocks.some(block => block.type === "cart_summary") ? "Confira os itens e escolha como continuar."
            : view.stage === "checkout" ? view.blocks.some(b => b.type === "shipping_options") ? "Escolha uma das entregas cotadas acima." : "Escolha a próxima etapa do seu pedido." : "Navegue no menu e explore as opções";
      const productName = productDetails ? value(object(view.blocks.find(block => block.type === "product_card")?.data).name) : "";
      messages.push({ type: "interactive", interactive: { type: "list", ...(productName ? { header: { type: "text", text: concise(productName, 60) } } : {}), body: { text: context }, action: { button: view.stage === "checkout" ? view.blocks.some(b => b.type === "shipping_options") ? "Escolher entrega" : "Opções do pedido" : catalog ? "Escolher produto" : productDetails && variantPrompt ? "Escolher variação" : "Ver opções", sections: [{ title: catalog ? "Produtos da loja" : "Sua próxima ação", rows }] } } });
    }
  }
  return { messages: compactMetaPresentation(messages, view), selections, numericSelections: choices.map(c => c.action), page, totalPages };
}
