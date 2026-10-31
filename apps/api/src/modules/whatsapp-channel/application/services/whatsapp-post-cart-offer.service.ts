import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { STOREFRONT_CROSS_SELL_CART, type StorefrontCrossSellCartPort } from "../../../storefront/domain/ports/storefront-cross-sell-cart.port.js";
import type { StoreUiAction, WhatsAppConversationState, WhatsAppStructuredResponse } from "../../domain/ui/meta-ui.types.js";

type Offer = NonNullable<WhatsAppConversationState["postCartOffer"]>;
const commands = new Set(["accept_cross_sell_offer", "decline_cross_sell_offer", "cross_sell_offer_details"]);
const argsSchema = z.strictObject({ offerId: z.string().uuid() });
const key = (ruleId: string, variantId: string) => JSON.stringify([ruleId, variantId]);
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (value: unknown): Record<string, any> => value && typeof value === "object" ? value as Record<string, any> : {};
const block = (offer: Offer) => ({ type: "post_cart_offer", data: { offerId: offer.id, productId: offer.productId,
  name: offer.name, priceCents: offer.expectedQuote.maximumUnitPriceCents, imageUrl: offer.imageUrl } });
function retireViews(state: WhatsAppConversationState) {
  const clean = (view: NonNullable<WhatsAppConversationState["view"]>) => ({ ...view,
    blocks: view.blocks.filter(b => b.type !== "post_cart_offer"),
    choices: view.choices.filter(c => !(c.action.kind === "tool" && commands.has(c.action.tool))) });
  return { ...state, view: state.view && clean(state.view), previousViews: state.previousViews.map(clean),
    selections: Object.fromEntries(Object.entries(state.selections ?? {}).filter(([, a]) => !(a.kind === "tool" && commands.has(a.tool)))),
    numericSelections: state.numericSelections?.filter(a => !(a.kind === "tool" && commands.has(a.tool))) };
}

/** Channel-owned offers carry evidence, never a model-selected price or write grant. */
@Injectable()
export class WhatsAppPostCartOfferService {
  constructor(@Inject(STOREFRONT_CROSS_SELL_CART) private readonly carts: StorefrontCrossSellCartPort) {}

  async decorate(merchantId: string, response: WhatsAppStructuredResponse): Promise<WhatsAppStructuredResponse> {
    const confirmed = response.blocks.find(b => b.type === "cart_add_result" && data(b.data).status === "succeeded"
      && data(b.data).cartId === response.state.conversationId);
    if (!confirmed) return response;
    const added = data(confirmed.data);
    if (response.state.postCartOffer?.status === "accepted" && response.state.postCartOffer.variantId === added.variantId) return response;
    const summary = response.blocks.find(b => b.type === "cart_summary");
    const source = data(summary?.data).items?.find((i: any) => i.variantId === added.variantId && i.quantity > 0);
    if (!source) return response;
    // Any new confirmed mutation invalidates an earlier snapshot. Paging and reads
    // have no cart_add_result and cannot create or revive an offer.
    let state = retireViews({ ...response.state, postCartOffer: undefined });
    const candidates = response.blocks.filter(b => b.type === "cross_sell").flatMap(b => data(b.data).products ?? []);
    for (const candidate of candidates) {
      const ruleId = candidate.recommendationRuleId;
      if (typeof ruleId !== "string" || typeof candidate.id !== "string" || typeof candidate.productId !== "string"
        || candidate.inStock !== true || state.declinedCrossSellKeys?.includes(key(ruleId, candidate.id))) continue;
      try {
        if (!this.carts.quoteRecommendation) continue;
        const quote = await this.carts.quoteRecommendation({ merchantId, cartId: state.conversationId }, {
          variantId: candidate.id, promotionId: ruleId, quantity: 1 });
        if (quote.productId !== candidate.productId || quote.variantId !== candidate.id || quote.merchantId !== merchantId
          || quote.cartId !== state.conversationId || !quote.cartBasis.items.some(i => i.variantId === added.variantId)) continue;
        const offer: Offer = { id: randomUUID(), merchantId, cartId: state.conversationId, ruleId, kind: "recommendation",
          variantId: quote.variantId, productId: quote.productId, sourceVariantId: added.variantId,
          addedName: String(source.productName ?? source.name), name: String(candidate.name), imageUrl: candidate.image,
          expiresAt: Date.now() + 10 * 60_000, status: "pending", expectedQuote: quote };
        const message = `🤖 ✅ *${offer.addedName} adicionado ao carrinho!*\n\n✨ *Que tal complementar sua escolha?*\nA loja selecionou *${offer.name}* para combinar com este item.\n💰 *${money(quote.maximumUnitPriceCents)}* por unidade.\n\n💬 Quer adicionar *1 unidade de ${offer.name}* ou seguir sem esse extra? Você também pode pedir os detalhes.`;
        state = { ...state, postCartOffer: offer, expectsFreeInput: false,
          history: response.state.history.map((entry, index, all) => index === all.length - 1 && entry.role === "assistant" ? { ...entry, content: message } : entry) };
        return { ...response, agentMessage: message, quickReplies: [], state,
          blocks: [...response.blocks.filter(b => b.type !== "cross_sell"), block(offer)] };
      } catch { /* Successful cart add is never retried because offering failed. */ }
    }
    return { ...response, state };
  }

  async handle(input: { merchantId: string; state: WhatsAppConversationState; message: string; action?: StoreUiAction;
    verifiedOwner: boolean; details: (productId: string) => Promise<{ blocks: WhatsAppStructuredResponse["blocks"] }> }): Promise<WhatsAppStructuredResponse | undefined> {
    const offer = input.state.postCartOffer;
    const explicit = input.action?.kind === "tool" && commands.has(input.action.tool) ? input.action : undefined;
    let command = explicit?.tool;
    const visible = input.state.view?.blocks.some(b => b.type === "post_cart_offer" && data(b.data).offerId === offer?.id);
    if (!input.action && offer?.status === "pending" && visible) {
      const text = input.message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[!.?]+$/g, "");
      if (/^(sim|sim[, ]+pode adicionar|pode adicionar|adicionar complemento|quero (esse|este|o) complemento|adicion(e|a) (esse|este|o) complemento)$/.test(text)) command = "accept_cross_sell_offer";
      else if (/^(nao|nao[, ]+obrigad[oa]|seguir sem (extra|complemento)|sem (extra|complemento)|nao quero( (o|esse|este))? complemento)$/.test(text)) command = "decline_cross_sell_offer";
      else if (/^(ver( os)? detalhes|quero (ver |saber )?(os )?detalhes|mais detalhes)$/.test(text)) command = "cross_sell_offer_details";
    }
    if (!command) return;
    const finish = (message: string, state: WhatsAppConversationState, blocks: WhatsAppStructuredResponse["blocks"] = []): WhatsAppStructuredResponse => ({
      agentMessage: message, quickReplies: ["Ver carrinho", "Finalizar pedido"], blocks,
      state: { ...state, history: [...state.history, { role: "user" as const, content: input.message }, { role: "assistant" as const, content: message }].slice(-24) } });
    const validArgs = !explicit || argsSchema.safeParse(explicit.args).success && explicit.args.offerId === offer?.id;
    if (!offer || !validArgs || offer.merchantId !== input.merchantId || offer.cartId !== input.state.conversationId
      || offer.status !== "pending" || offer.expiresAt <= Date.now()) {
      return finish("🤖 ⏳ Essa recomendação já foi encerrada ou mudou. Confira seu carrinho para continuar.", retireViews(input.state));
    }
    if (!input.verifiedOwner) return finish("🤖 🔒 Não consegui confirmar esta conversa para alterar o carrinho. Abra novamente o menu da loja.", input.state);
    if (command === "decline_cross_sell_offer") {
      const state = retireViews({ ...input.state, postCartOffer: { ...offer, status: "declined" },
        declinedCrossSellKeys: [...new Set([...(input.state.declinedCrossSellKeys ?? []), key(offer.ruleId, offer.variantId)])].slice(-200) });
      return finish("🤖 👍 Tudo bem! Vamos seguir com os itens que você já escolheu, sem adicionar esse complemento.\n\n🛒 Você pode conferir o carrinho ou finalizar o pedido.", state);
    }
    if (command === "cross_sell_offer_details") {
      const details = await input.details(offer.productId);
      const product = details.blocks.find(b => b.type === "product_card" && data(b.data).id === offer.productId);
      const description = data(product?.data).description;
      return finish(`🤖 🔎 *${offer.name}*\n💰 *${money(offer.expectedQuote.maximumUnitPriceCents)}* por unidade.${description ? `\n\n${String(description)}` : ""}\n\n💬 Quer adicionar uma unidade ou seguir sem esse extra?`, input.state, [block(offer)]);
    }
    try {
      if (!this.carts.acceptRecommendation) throw new Error("recommendation_authority_unavailable");
      await this.carts.acceptRecommendation({ merchantId: input.merchantId, cartId: offer.cartId }, { expectedQuote: offer.expectedQuote });
    } catch {
      return finish("🤖 ⚠️ Não consegui confirmar a inclusão desse complemento. O preço, o estoque ou o carrinho pode ter mudado.\n\n🛒 Confira o carrinho antes de tentar novamente.", retireViews({ ...input.state, postCartOffer: { ...offer, status: "invalidated" } }));
    }
    const state = retireViews({ ...input.state, postCartOffer: { ...offer, status: "accepted" } });
    const blocks: WhatsAppStructuredResponse["blocks"] = [{ type: "cart_add_result", data: { cartId: offer.cartId, variantId: offer.variantId, status: "succeeded", optionItemIds: [] } }];
    // An acknowledged commit remains acknowledged if the subsequent read fails.
    // Never retry accept or synthesize a second add.
    try {
      const cart = await this.carts.project({ merchantId: input.merchantId, cartId: offer.cartId });
      blocks.push({ type: "cart_summary", data: { cartId: cart.sessionId,
        items: cart.items.map(i => ({ variantId: i.variantId, productName: i.name, quantity: i.quantity, price: i.unitPriceCents / 100, subtotal: i.quantity * i.unitPriceCents / 100 })),
        itemCount: cart.items.reduce((n, i) => n + i.quantity, 0), subtotal: cart.total / 100, discount: cart.discount / 100,
        total: (cart.total - cart.discount) / 100, freeShipping: cart.freeShipping } });
    } catch { /* The confirmed commit is not replayed on a read failure. */ }
    return finish(`🤖 ✅ *${offer.name} adicionado ao carrinho!*\n💰 *${money(offer.expectedQuote.maximumUnitPriceCents)}* por unidade.\n\n🛒 Quer conferir o carrinho ou finalizar o pedido?`, state, blocks);
  }
}
