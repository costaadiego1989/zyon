import { createHash } from "node:crypto";
import type { MetaUiChoice, MetaUiMessage, MetaUiPresentation, MetaUiView, StoreUiAction, WhatsAppStructuredResponse } from "./meta-ui.types.js";
import { serviceSlotLabel } from "../../../catalog/domain/services/service-schedule.js";
import { metaStoreQuickReplyAction } from "./meta-store-actions.js";
import { commercialNoticesSchema } from "../../../storefront/domain/contracts/commercial-notice.schemas.js";

const object = (value: unknown): Record<string, any> => value && typeof value === "object" ? value as Record<string, any> : {};
const items = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.map(object) : [];
const value = (input: unknown): string => typeof input === "string" ? input : input == null ? "" : String(input);
const money = (amount: unknown): string => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(amount) || 0);
const concise = (text: string, limit: number): string => Array.from(text).slice(0, limit).join("");
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
    .replace(/^(Subtotal:)/gm, "🛍️ $1").replace(/^(Frete:)/gm, "🚚 $1")
    .replace(/^(Descontos:)/gm, "🏷️ $1").replace(/^(Taxa de serviço:)/gm, "ℹ️ $1")
    .replace(/^(\*Total (?:a pagar|parcial|do pagamento):)/gm, "💳 $1")
    .replace(/^(\*[^*\n]+\*)\n(?=\*R\$)/gm, "📦 $1\n");
  return content.startsWith("🤖") ? content : `🤖 ${content}`;
}

/** Channel presentation only: all commercial values and actions come from the store. */
export function buildMetaUiView(response: WhatsAppStructuredResponse, options: { selectionOnly?: boolean } = {}): MetaUiView {
  const view: MetaUiView = { stage: response.state.stage, title: response.merchantName || "Sua loja", body: response.agentMessage, choices: [], media: [], blocks: response.blocks, quickReplies: response.quickReplies };
  const cartJustAdded = response.blocks.some(block => block.type === "cart_add_result" && object(block.data).status === "succeeded");
  const redundantIntro = response.blocks.some(block => ["cart_summary", "wishlist"].includes(block.type))
    && /^(?:Este é o seu carrinho:|Seu carrinho:|Sua lista de desejos:|Confira sua lista de desejos:)$/.test(response.agentMessage.trim());
  const redundantAdd = cartJustAdded && /^Produto adicionado ao carrinho\.?$/.test(response.agentMessage.trim());
  const text: string[] = redundantIntro || redundantAdd ? [] : [formatMetaConversation(response.agentMessage)];
  const selectionText: string[] = [];
  const add = (label: string, action: StoreUiAction, description?: string) => view.choices.push({ label, action, description });
  const photo = (url: unknown, caption?: string) => { const link = safeLink(url); if (link && !view.media.some(m => m.type === "image" && m.media.link === link)) view.media.push({ type: "image", media: { link, caption: caption ? concise(caption, 1024) : undefined } }); };
  const productChoice = (p: Record<string, any>) => {
    const price = p.priceFormatted || money(Number(p.price) / 100);
    add(value(p.name), tool("get_product_details", { productId: p.productId || p.id }), [price, p.sellerName, p.inStock === false ? "Indisponível" : ""].filter(Boolean).join(" · "));
    const link = safeLink(p.image || p.imageUrl || p.image_url || p.images?.[0]);
    if (link) view.choices.at(-1)!.image = { link, caption: concise(`*${value(p.name)}*\n*${price}*${p.inStock === false ? "\n_Indisponível_" : "\n_Escolha o produto no menu para ver detalhes._"}`, 1024) };
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
      case "welcome_animation": {
        const link = safeLink(d.url);
        if (link) view.media.push({ type: "video", media: { link } });
        break;
      }
      case "form_field": text.push(`Informe ${value(d.label || d.field)}:`); break;
      case "address_confirmation": text.push(`*Confira a entrega*\n${value(d.formatted)}\n\n_O endereço está correto?_`); add("Sim", { kind: "message", message: "Sim" }); add("Corrigir endereço", { kind: "message", message: "Não" }); break;
      case "payment_methods":
        items(d.methods).forEach(m => add(value(m.label), d.nativePayment && d.fingerprint
          ? tool("create_payment", { method: m.key, fingerprint: d.fingerprint }) : { kind: "message", message: value(m.label) }, value(m.sub)));
        if (d.nativePayment && d.couponAllowed) add("Usar cupom", tool("edit_checkout", { section: "coupon", fingerprint: d.fingerprint }));
        break;
      case "checkout_edit_actions":
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
      case "product_carousel": case "marketplace_products": case "cross_sell":
        items(d.products ?? d.items).forEach(productChoice);
        if (d.nextCursor) add("Mais produtos", tool("search_products", { query: d.query || "*", categoryId: d.categoryId, cursor: d.nextCursor, ...(d.criteria ? { criteria: d.criteria } : {}) }));
        break;
      case "product_card": {
        if (d.sellerName) { const seller = `Vendido por: ${value(d.sellerName)}`; text.push(seller); selectionText.push(seller); }
        const retailerId = response.state.catalogRetailerIds?.[value(d.variants?.[0]?.id)] ?? response.state.catalogRetailerIds?.[value(d.sku ?? d.variants?.[0]?.sku)];
        if (response.state.catalogId && retailerId && response.state.catalogPrices?.[retailerId] === Number(d.variants?.[0]?.price ?? d.price) && items(d.variants).length <= 1 && !items(d.optionGroups).length && !d.serviceSchedule) view.media.push({ type: "interactive", interactive: {
          type: "product", body: { text: value(d.name) }, action: { catalog_id: response.state.catalogId, product_retailer_id: retailerId } } });
        const variants = items(d.variants).filter(v => ["digital", "service"].includes(d.productType) || v.stock !== 0);
        const remembered = response.state.selectedProductId === d.id ? response.state.selectedVariantId : undefined;
        const selected = variants.find(v => v.id === remembered)?.id;
        const variantId = remembered ? selected : (variants.length === 1 ? value(variants[0].id) : undefined);
        const selectedVariant = variants.find(v => v.id === variantId);
        const price = selectedVariant?.priceFormatted || (selectedVariant?.price != null ? money(Number(selectedVariant.price) / 100) : d.priceFormatted || money(Number(d.price) / 100));
        const heading = `*${value(d.name)}*\n*${price}*${d.inStock === false ? "\n_Indisponível_" : ""}`;
        text.push(heading); selectionText.push(heading);
        if (d.description) text.push(`*Descrição*\n${value(d.description)}`);
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
        } else if (variantId && d.inStock !== false && (!d.serviceSchedule || slot)) add("Adicionar ao carrinho", tool("add_item_to_cart", { variantId, quantity: 1, selectedOptionItemIds: chosen, selectedServiceSlotId: slot?.slotId }));
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
        text.push("🛒 *Seu carrinho*");
        if (!items(d.items).length) text.push("Seu carrinho está vazio. Escolha um produto para começar.");
        items(d.items).forEach((i, index) => {
          text.push(`${index + 1}. *${value(i.productName || i.name)}*\nQuantidade: ${i.quantity} · ${money(i.subtotal)}`);
          if (!cartJustAdded) photo(i.imageUrl || i.image_url || i.image, `*Item no carrinho*\n${value(i.productName || i.name)}\n${i.quantity} unidade(s) · ${money(i.subtotal)}`);
          items(i.selectedOptions).forEach(o => text.push(`${value(o.groupName)}: ${value(o.itemName)}`));
          if (i.selectedServiceSlotId) text.push(`Agendamento: ${value(i.selectedServiceSlotId)}`);
          add(`Editar ${value(i.productName || i.name)}`, tool("edit_cart_item", { variantId: i.variantId, quantity: i.quantity }));
          add(`Remover ${value(i.productName || i.name)}`, tool("remove_cart_item", { variantId: i.variantId }));
        });
        text.push(`Subtotal: ${money(d.subtotal)}${d.discount ? `\nDescontos: −${money(d.discount)}` : ""}\n*Total dos itens: ${money(d.total)}*\n\n_Frete e eventuais taxas aparecem no resumo antes do pagamento._`);
        if (d.freeShipping) text.push("Frete grátis aplicado.");
        {
          const notices = commercialNoticesSchema.safeParse(d.commercialNotices);
          if (notices.success) for (const notice of notices.data) text.push(notice.message);
        }
        if (items(d.items).length) add("Finalizar compra", tool("checkout", {}));
        add("Continuar comprando", tool("search_products", { query: "*" }));
        break;
      case "cart_add_result":
        text.push(d.status === "succeeded" ? "✅ *Item adicionado ao carrinho*" : d.status === "unknown" ? "_A inclusão está sendo verificada._" : "Não foi possível adicionar este item."); break;
      case "shipping_options":
        if (items(d.options).length) text.push("🚚 *Opções de entrega*\nCompare o valor e o prazo antes de escolher.");
        items(d.options).forEach(o => {
          const carrier = value(o.carrier), name = value(o.name);
          const label = carrier.startsWith("melhor-envio-") || carrier.startsWith("own_delivery_")
            ? name : [carrier, name].filter(Boolean).join(" ");
          const eta = o.estimatedUnit === "minutes" && Number.isInteger(o.estimatedValue) && o.estimatedValue > 0
            ? ` · ${o.estimatedValue} minutos` : o.days != null ? ` · ${o.days} dias úteis` : "";
          add(label || "Frete", { kind: "message", message: value(o.responseLabel) || `Escolho o frete ${label || "disponível"}` }, `${Number(o.price) === 0 ? "Grátis · benefício da loja" : o.priceFormatted || money(o.price)}${eta}`);
        }); break;
      case "shipping_quote_input": text.push("Qual é o CEP para calcular a entrega?"); break;
      case "checkout_redirect":
        if (safeLink(d.url)) view.media.push({ type: "interactive", interactive: { type: "cta_url", body: { text: "🤖 🔒 *Continue sua compra com segurança*\n\nPreencha os dados protegidos na página da loja. Seu carrinho será mantido." }, action: { name: "cta_url", parameters: { display_text: "Continuar compra", url: safeLink(d.url) } } } }); break;
      case "checkout_prepared": add("Continuar checkout", tool("checkout", { actionId: d.actionId, cartId: d.cartId })); break;
      case "order_confirmation":
        text.push(`✅ *Pedido ${value(d.orderId)}*\n*Total: ${money(d.total)}*`);
        items(d.items).forEach(i => text.push(`${i.quantity}× ${value(i.productName)} — ${money(i.price)}`));
        if (d.estimatedDelivery) text.push(`Previsão: ${value(d.estimatedDelivery)}`); break;
      case "comparison_table": case "product_comparison":
        if (items(d.products).length) text.push("*Comparação de produtos*");
        items(d.products).forEach(p => { const labels: Record<string, string> = { size: "Tamanho", color: "Cor", volume: "Volume", weight: "Peso", material: "Material", voltage: "Voltagem" };
          text.push(`*${value(p.name)}*\n*${p.priceFormatted || money(p.price)}*\n${Object.entries(object(p.attributes)).map(([k, v]) => `- ${labels[k.toLowerCase()] || k}: ${value(v)}`).join("\n")}`); productChoice(p); }); break;
      case "reviews":
        text.push(`⭐ *Avaliações*\n📦 *${value(d.productName)}*\n\n📊 *${d.filter === "positive" ? "Positivas" : d.filter === "negative" ? "Negativas" : "Publicadas"}:* ${value(d.totalReviews)} · Média: *${Number(d.averageRating).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} / 5*\n_Da mais recente para a mais antiga._`);
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
        text.push(d.amount_cents != null ? `*Total do pagamento: ${money(Number(d.amount_cents) / 100)}*\n\n_O pedido será confirmado após a aprovação do pagamento._` : "_Pagamento pendente de confirmação._");
        if (d.copy_paste) view.media.push({ type: "text", text: { body: value(d.copy_paste) } });
        if (safeLink(d.ticket_url)) view.media.push({ type: "interactive", interactive: { type: "cta_url", body: { text: "🤖 🔒 *Pagamento seguro*\n\nConclua o pagamento no checkout do provedor." }, action: { name: "cta_url", parameters: { display_text: "Pagar pedido", url: safeLink(d.ticket_url) } } } });
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
    const fullDetails = view.body;
    view.body = [formatMetaConversation(response.agentMessage), ...selectionText].filter(Boolean).join("\n\n");
    add("Ver detalhes completos", tool("show_content", { text: fullDetails }));
  }
  return view;
}

/** Native selection IDs are scoped to a persisted turn; labels never authorize actions. */
export function withMetaCartNavigation(view: MetaUiView, hasItems?: boolean): MetaUiView {
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

export function metaWelcomeMessage(greeting: string, merchantName: string, agentName = "Zyon"): string {
  return `👋 *${formatMetaText(agentName)} · ${formatMetaText(merchantName)}*\n\n${formatMetaConversation(greeting)}\n\n*Converse à vontade*\n- Encontre e compare produtos.\n- Confira entrega, pagamento e seu pedido.\n\n_Pergunte o que quiser sobre a loja, pelo menu ou aqui na conversa._`;
}

export const isMetaCatalogView = (view?: MetaUiView): boolean => !!view && view.stage !== "checkout" &&
  !view.blocks.some(block => block.type === "product_card") &&
  view.blocks.some(block => ["product_carousel", "marketplace_products", "wishlist", "cross_sell"].includes(block.type));

const catalogProductChoice = (choice: MetaUiChoice): boolean => choice.action.kind === "tool" &&
  (choice.action.tool === "get_product_details" || choice.action.tool === "search_products" && !!choice.action.args.cursor);

/** The catalog's secondary actions retain their original server-owned identities. */
export function buildMetaCatalogOptionsView(view: MetaUiView): MetaUiView {
  return { stage: view.stage, title: view.title, body: "Escolha uma opção para continuar. Você também pode escrever sua pergunta.",
    choices: view.choices.filter(choice => !catalogProductChoice(choice)), media: [], blocks: [], quickReplies: [] };
}

export function presentMetaUi(view: MetaUiView, revision: string, requestedPage = 0, options: { native?: boolean; includeMedia?: boolean; canGoBack?: boolean; navigationOnly?: boolean } = {}): MetaUiPresentation {
  const parts = paragraphs(formatMetaText(view.body || "Como posso ajudar?"));
  const productDetails = view.blocks.some(block => block.type === "product_card");
  const catalog = isMetaCatalogView(view);
  const pinned = view.choices.filter(choice => ["Ver produtos", "Encontrar produto", "Ver carrinho", "Finalizar pedido"].includes(choice.label));
  let allChoices = view.choices.filter(choice => !pinned.includes(choice));
  if (view.stage === "checkout") {
    const primary = (choice: MetaUiChoice) => choice.action.kind === "tool" && ["create_payment", "edit_checkout", "confirm_checkout_edit", "cancel_checkout_edit", "cancel_coupon_entry"].includes(choice.action.tool);
    allChoices.sort((a, b) => Number(primary(b)) - Number(primary(a)));
  }
  if (catalog) {
    allChoices = allChoices.filter(catalogProductChoice);
  }
  // On the visual catalog, show photographed products first while retaining
  // every product and its authorized identity across subsequent pages.
  if (catalog && allChoices.some(choice => choice.image)) allChoices.sort((a, b) => Number(!!b.image) - Number(!!a.image));
  if (parts.length > 2) allChoices.unshift({ label: "Ler mais", action: tool("show_content", { text: parts.slice(2).join("\n\n") }) });
  const media = view.media.filter(m => m.type !== "text");
  if (media.length > 3) allChoices.unshift({ label: "Ver mais mídias", action: tool("media_page", { media: media.slice(3) }) });
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
  // Reserve a row for the secondary menu as well as previous/next/back.
  const pageSize = catalog ? Math.min(allChoices.some(choice => choice.image) ? 3 : 6, 6 - pinned.length) : 7 - pinned.length;
  const totalPages = Math.max(1, Math.ceil(allChoices.length / pageSize));
  const page = Math.max(0, Math.min(Math.floor(requestedPage), totalPages - 1));
  const currentChoices = allChoices.slice(page * pageSize, (page + 1) * pageSize);
  const choices: MetaUiChoice[] = productDetails ? [...currentChoices, ...pinned] : [...pinned, ...currentChoices];
  if (catalog) choices.push({ label: "Outras opções", action: { kind: "catalog_options" } });
  if (page > 0) choices.push({ label: catalog ? "Produtos anteriores" : "Página anterior", action: { kind: "page", page: page - 1 } });
  if (page < totalPages - 1) choices.push({ label: catalog ? "Próximos produtos" : "Mais opções", action: { kind: "page", page: page + 1 } });
  if (options.canGoBack) choices.push({ label: "Voltar", action: { kind: "back" } });
  const selections: Record<string, StoreUiAction> = {};
  const rows = choices.map((choice, index) => {
    const id = "zyon:" + createHash("sha256").update(`${revision}:${page}:${index}`).digest("hex").slice(0, 32);
    selections[id] = choice.action;
    const numbered = `${index + 1}. ${choice.label}`;
    const description = numbered.length > 24 ? `${choice.label}${choice.description ? ` · ${choice.description}` : ""}` : choice.description;
    return { id, title: concise(numbered, 24), ...(description ? { description: concise(description, 72) } : {}) };
  });
  const productPhotos: MetaUiMessage[] = catalog && options.includeMedia !== false ? choices.filter(choice => choice.image).map(choice => ({ type: "image", media: choice.image! })) : [];
  const messages: MetaUiMessage[] = [];
  const visibleMedia = productPhotos.length ? productPhotos.slice(0, 3)
    : options.includeMedia !== false && !options.navigationOnly ? view.media.filter(m => m.type !== "text").slice(0, 3) : [];
  // Product detail starts with its real photo and price, followed by the full
  // published information. Payment instructions retain their existing order.
  const welcome = view.blocks.some(block => block.type === "welcome_animation");
  if (productDetails && !welcome && visibleMedia[0]?.type === "image") messages.push(visibleMedia.shift()!);
  if (!options.navigationOnly && (!catalog || page === 0)) {
    const introduction = welcome ? parts[0]?.split(/\n{2,}/) : undefined;
    if (introduction && introduction.length > 2 && visibleMedia[0]?.type === "video") {
      messages.push({ type: "text", text: { body: formatMetaSpeech(introduction.slice(0, 2).join("\n\n")) } });
      messages.push(visibleMedia.shift()!);
      [introduction.slice(2).join("\n\n"), ...parts.slice(1, 2)].filter(Boolean).forEach(body => messages.push({ type: "text", text: { body: formatMetaSpeech(body) } }));
    } else parts.slice(0, 2).forEach(body => messages.push({ type: "text", text: { body: formatMetaSpeech(body) } }));
  }
  messages.push(...visibleMedia);
  if (options.includeMedia !== false && !options.navigationOnly) messages.push(...view.media.filter(m => m.type === "text"));
  if (choices.length) {
    const selectedVariation = view.choices.find(choice => choice.action.kind === "variant" && choice.label.startsWith("✓ "));
    const variantPrompt = view.choices.some(choice => choice.action.kind === "variant")
      ? selectedVariation ? `Selecionado: ${selectedVariation.label.slice(2)}.\nAdicione ao carrinho ou escolha outra variação.`
        : "Escolha a variação do produto para continuar." : undefined;
    if (options.native === false) messages.push({ type: "text", text: { body: choices.map((c, i) => `${i + 1}. ${c.label}${c.description ? ` — ${c.description}` : ""}`).join("\n") + "\n\nVocê pode responder pelo número ou escrever sua pergunta." } });
    else if (choices.length <= 3 && choices.every(c => Array.from(c.label).length <= 17)) messages.push({ type: "interactive", interactive: { type: "button", body: { text: "🧭 Como posso ajudar?" }, footer: { text: "🤖 Pode perguntar o que quiser." }, action: { buttons: rows.map(row => ({ type: "reply", reply: { id: row.id, title: concise(row.title, 20) } })) } } });
    else {
      const context = catalog ? "Escolha um produto para ver fotos e informações completas."
        : productDetails ? variantPrompt || "Veja as opções deste produto ou escreva sua dúvida."
          : view.blocks.some(block => block.type === "cart_summary") ? "Confira os itens e escolha como continuar."
            : view.stage === "checkout" ? "Escolha a próxima etapa do seu pedido." : "Explore a loja ou continue a conversa.";
      const productName = productDetails ? value(object(view.blocks.find(block => block.type === "product_card")?.data).name) : "";
      messages.push({ type: "interactive", interactive: { type: "list", header: { type: "text", text: concise(productName || view.title, 60) }, body: { text: `🧭 ${context}${totalPages > 1 ? `\nPágina ${page + 1} de ${totalPages}` : ""}` }, footer: { text: "🤖 Pode perguntar o que quiser." }, action: { button: catalog ? "Ver produtos" : productDetails && variantPrompt ? "Escolher variação" : "Explorar opções", sections: [{ title: catalog ? "Produtos da loja" : "Sua próxima ação", rows }] } } });
    }
  }
  return { messages, selections, numericSelections: choices.map(c => c.action), page, totalPages };
}
