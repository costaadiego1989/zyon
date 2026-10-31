import { Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { STOREFRONT_CROSS_SELL_CART, type StorefrontCrossSellCartPort } from "../../../storefront/domain/ports/storefront-cross-sell-cart.port.js";
import type { StoreUiAction, WhatsAppConversationState, WhatsAppStructuredResponse } from "../../domain/ui/meta-ui.types.js";
import { cartMessageAuthorizesAdd } from "../../../storefront/domain/tools/cart-turn-policy.js";
import { MERCHANT_AGENT_RULE_READER, type MerchantAgentRuleReaderPort } from "../../../agent-rules/domain/ports/merchant-agent-rule-reader.port.js";
import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import { GetProductContentUseCase } from "../../../catalog/application/use-cases/get-product-content.use-case.js";
import { extractSafeTargetReasons } from "../../domain/ui/quoted-target-public-facts.js";

type Offer = NonNullable<WhatsAppConversationState["postCartOffer"]>;
const commands = new Set(["accept_cross_sell_offer", "decline_cross_sell_offer", "cross_sell_offer_details"]);
const argsSchema = z.strictObject({ offerId: z.string().uuid() });
const key = (ruleId: string, variantId: string) => JSON.stringify([ruleId, variantId]);
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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
  constructor(@Inject(STOREFRONT_CROSS_SELL_CART) private readonly carts: StorefrontCrossSellCartPort,
    @Optional() @Inject(MERCHANT_AGENT_RULE_READER) private readonly agentRules?: MerchantAgentRuleReaderPort,
    @Optional() @Inject("ProductRepositoryPort") private readonly products?: Pick<ProductRepositoryPort, "findById">,
    @Optional() @Inject(GetProductContentUseCase) private readonly publicContent?: Pick<GetProductContentUseCase, "execute">) {}

  private async reasons(merchantId: string, offer: Offer): Promise<string[]> {
    const sourceId = offer.expectedQuote.cartBasis.items.find(item => item.variantId === offer.sourceVariantId)?.productId;
    if (!this.products || !sourceId) return [];
    try {
      const [source, target] = await Promise.all([this.products.findById(merchantId, sourceId), this.products.findById(merchantId, offer.productId)]);
      const sourceVariant = source?.variants.find(variant => variant.id === offer.sourceVariantId);
      const targetVariant = target?.variants.find(variant => variant.id === offer.variantId);
      if (!source || !target || source.id !== sourceId || target.id !== offer.productId
        || source.merchantId !== merchantId || target.merchantId !== merchantId || !source.isActive || !target.isActive
        || !sourceVariant?.isActive || !targetVariant?.isActive) return [];
      let blocks: Parameters<typeof extractSafeTargetReasons>[0]["publicBlocks"] = [];
      try { blocks = (await this.publicContent?.execute({ merchantId, productId: target.id, locale: "pt-BR" }))?.blocks ?? []; }
      catch { /* Public description remains usable when optional rich content is unavailable. */ }
      return extractSafeTargetReasons({ productId: target.id, variantId: targetVariant.id,
        description: target.description, variantAttributes: targetVariant.attributes, publicBlocks: blocks, locale: "pt-BR" });
    } catch { return []; /* Missing evidence never invents a benefit or retries the confirmed cart write. */ }
  }

  private async recommendation(merchantId: string, offer: Offer): Promise<string> {
    let tone: unknown;
    try { tone = data((await this.agentRules?.findForMerchant(merchantId))?.identity).tone; } catch { /* Optional voice never changes the confirmed add or quote. */ }
    // Only the validated tone selects presentation. Free-form persona cannot
    // supply a price, benefit, suitability claim or consent to add the suggestion.
    switch (tone) {
      case "friendly": return `Pensando nessa escolha, separei *${offer.name}* para você conhecer também. Pode ser um complemento interessante para você!`;
      case "premium": return `Pensando no que você escolheu, separei *${offer.name}* como uma recomendação para acompanhar essa escolha.`;
      case "direct": return `Com base nessa escolha, separei *${offer.name}* para você avaliar também.`;
      case "technical": return `Considerando o *${offer.addedName}*, separei *${offer.name}* como complemento para você comparar.`;
      default: return `Com base nessa escolha, separei *${offer.name}*, que também pode te interessar.`;
    }
  }

  async decorate(merchantId: string, response: WhatsAppStructuredResponse): Promise<WhatsAppStructuredResponse> {
    const confirmed = response.blocks.find(b => b.type === "cart_add_result" && data(b.data).status === "succeeded"
      && data(b.data).cartId === response.state.conversationId);
    if (!confirmed) return response;
    const added = data(confirmed.data);
    if (response.state.postCartOffer?.status === "accepted" && response.state.postCartOffer.variantId === added.variantId
      && !response.blocks.some(b => b.type === "cross_sell")) return response;
    const summary = response.blocks.find(b => b.type === "cart_summary");
    const source = data(summary?.data).items?.find((i: any) => i.variantId === added.variantId && i.quantity > 0);
    if (!source) {
      if (!response.blocks.some(b => b.type === "cross_sell")) return response;
      const fallback = "🤖 ✅ *Item adicionado ao carrinho!*\n\n✨ Não consegui confirmar o complemento agora. Confira seu carrinho para continuar.";
      return { ...response, agentMessage: fallback, blocks: response.blocks.filter(b => b.type !== "cross_sell"),
        state: { ...response.state, history: response.state.history.map((entry, index, all) =>
          index === all.length - 1 && entry.role === "assistant" ? { ...entry, content: fallback } : entry) } };
    }
    // Any new confirmed mutation invalidates an earlier snapshot. Paging and reads
    // have no cart_add_result and cannot create or revive an offer.
    let state = retireViews({ ...response.state, postCartOffer: undefined });
    const candidates = response.blocks.filter(b => b.type === "cross_sell").flatMap(b => data(b.data).products ?? []);
    let attemptedQuote = false;
    for (const candidate of candidates) {
      const ruleId = candidate.recommendationRuleId ?? candidate.promoId;
      const kind = candidate.recommendationRuleId ? "recommendation" : "discount";
      if (typeof ruleId !== "string" || typeof candidate.id !== "string" || typeof candidate.productId !== "string"
        || candidate.inStock !== true || state.declinedCrossSellKeys?.includes(key(ruleId, candidate.id))) continue;
      try {
        const quoteReader = kind === "recommendation" ? this.carts.quoteRecommendation?.bind(this.carts) : this.carts.quote.bind(this.carts);
        if (!quoteReader) continue;
        attemptedQuote = true;
        const quote = await quoteReader({ merchantId, cartId: state.conversationId }, {
          variantId: candidate.id, promotionId: ruleId, quantity: 1 });
        if (quote.productId !== candidate.productId || quote.variantId !== candidate.id || quote.merchantId !== merchantId
          || quote.cartId !== state.conversationId || !quote.cartBasis.items.some(i => i.variantId === added.variantId)) continue;
        if (kind === "discount" && quote.maximumUnitPriceCents >= quote.originalUnitPriceCents) continue;
        const offer: Offer = { id: randomUUID(), merchantId, cartId: state.conversationId, ruleId, kind,
          variantId: quote.variantId, productId: quote.productId, sourceVariantId: added.variantId,
          addedName: String(source.productName ?? source.name), name: String(candidate.name), imageUrl: candidate.image,
          expiresAt: Date.now() + 10 * 60_000, status: "pending", expectedQuote: quote };
        const price = kind === "discount" ? `🏷️ De ${money(quote.originalUnitPriceCents)} por *${money(quote.maximumUnitPriceCents)}* por unidade, na cotação atual.`
          : `💰 *${money(quote.maximumUnitPriceCents)}* por unidade.`;
        const [suggestion, reasons] = await Promise.all([this.recommendation(merchantId, offer), this.reasons(merchantId, offer)]);
        const why = reasons.length ? `\n\n✨ *${reasons.length === 1 ? "Um motivo para conhecer esse produto" : `${reasons.length} motivos para conhecer esse produto`}*\n${reasons.map(reason => `• ${reason}`).join("\n")}` : "";
        const message = `🤖 ✅ Vi que você adicionou *${offer.addedName}* ao carrinho!\n\n💡 *Minha recomendação para você*\n${suggestion}${why}\n\n${price}\n\n_Sugestão opcional: só adiciono se você quiser._\n\n💬 Quer conhecer melhor essa sugestão, adicionar *1 unidade de ${offer.name}* ou seguir com os itens que já escolheu?`;
        state = { ...state, postCartOffer: offer, expectsFreeInput: false,
          history: response.state.history.map((entry, index, all) => index === all.length - 1 && entry.role === "assistant" ? { ...entry, content: message } : entry) };
        return { ...response, agentMessage: message, quickReplies: [], state,
          blocks: [...response.blocks.filter(b => b.type !== "cross_sell"), block(offer)] };
      } catch { /* Successful cart add is never retried because offering failed. */ }
    }
    const fallback = `🤖 ✅ *${String(source.productName ?? source.name)} adicionado ao carrinho!*\n\n${attemptedQuote
      ? "✨ Não consegui confirmar esse complemento agora. Você pode seguir com os itens que já escolheu."
      : "🛒 Você pode conferir o carrinho ou finalizar o pedido com os itens que já escolheu."}`;
    return { ...response, state: { ...state, history: candidates.length ? state.history.map((entry, index, all) =>
      index === all.length - 1 && entry.role === "assistant" ? { ...entry, content: fallback } : entry) : state.history },
      blocks: response.blocks.filter(b => b.type !== "cross_sell"), agentMessage: candidates.length ? fallback : response.agentMessage };
  }

  async handle(input: { merchantId: string; state: WhatsAppConversationState; message: string; action?: StoreUiAction;
    attachmentContext?: string; verifiedOwner: boolean; details: (productId: string) => Promise<{ blocks: WhatsAppStructuredResponse["blocks"] }> }): Promise<WhatsAppStructuredResponse | undefined> {
    const offer = input.state.postCartOffer;
    let explicit = input.action?.kind === "tool" && commands.has(input.action.tool) ? input.action : undefined;
    let command = explicit?.tool;
    const visible = input.state.view?.blocks.some(b => b.type === "post_cart_offer" && data(b.data).offerId === offer?.id);
    // An explicit read of this complement can recover its still-pending view
    // after another read failed. It grants no assent or cart mutation; ordinary
    // nonvisible "sim" and unrelated product questions remain outside this path.
    const text = normalize(input.message).replace(/[!.?]+$/g, "");
    const scopedDetails = /^(?:(?:quero|gostaria de|pode|poderia)\s+)?(?:me\s+)?(?:(?:ver|mostrar|mostre)\s+)?(?:os\s+)?detalhes\s+(?:desse|deste|do|dessa|desta|da)\s+(?:complemento|sugestao|recomendacao)(?:\s+antes de (?:eu )?decidir)?(?:[, ]+por favor)?$/.test(text);
    if (!explicit && offer?.status === "pending" && input.action?.kind === "tool") {
      const action = input.action;
      if (action.tool === "add_item_to_cart" && action.args.variantId === offer.variantId) {
        const options = action.args.optionItemIds ?? [];
        const expectedOptions = offer.expectedQuote.selectedOptionItemIds ?? [];
        if ((action.args.quantity ?? 1) === 1 && Object.keys(action.args).every(k => ["variantId", "quantity", "optionItemIds"].includes(k))
          && Array.isArray(options) && JSON.stringify([...options].sort()) === JSON.stringify([...expectedOptions].sort())) {
          explicit = { kind: "tool", tool: "accept_cross_sell_offer", args: { offerId: offer.id } }; command = explicit.tool;
        } else command = "clarify_cross_sell_offer";
      } else if (action.tool === "add_catalog_items" && Array.isArray(action.args.lines)
        && action.args.lines.some(line => data(line).variantId === offer.variantId)) command = "clarify_cross_sell_offer";
    }
    if (!input.attachmentContext && !input.action && offer?.status === "pending" && (visible || scopedDetails)) {
      if (/^(sim|sim[, ]+pode adicionar|pode adicionar|adicionar (complemento|sugestao|recomendacao)|quero (esse|este|o|essa|esta|a) (complemento|sugestao|recomendacao)|adicion(e|a) (esse|este|o|essa|esta|a) (complemento|sugestao|recomendacao))$/.test(text)) command = "accept_cross_sell_offer";
      else if (/^(nao|nao[, ]+obrigad[oa]|seguir sem (extra|complemento|sugestao|recomendacao)|sem (extra|complemento|sugestao|recomendacao)|nao quero( (o|esse|este|a|essa|esta))? (complemento|sugestao|recomendacao))$/.test(text)) command = "decline_cross_sell_offer";
      else if (scopedDetails || /^(ver( os)? detalhes|quero (ver |saber )?(os )?detalhes|mais detalhes)$/.test(text)) command = "cross_sell_offer_details";
      else {
        // A bounded explicit reference may name a contiguous published phrase
        // of the one visible offer. Quantities/conditions/extra items cannot match.
        const selection = text.match(/^(?:sim[, ]+)?(?:pode adicionar|pode incluir|adicione|adiciona|inclua|inclui|quero)\s+(.+)$/)?.[1]
          ?.replace(/[, ]*por favor$/, "").replace(/\s+(?:ao|no|para o)\s+(?:meu\s+)?carrinho[, ]*$/, "")
          .replace(/^(?:(?:a|o|esse|essa|este|esta|um|uma|1|unidade de)\s+)+/, "").trim();
        const published = normalize(offer.name).replace(/[^a-z0-9]+/g, " ");
        if (selection && selection.length >= 4 && /^[a-z ]+$/.test(selection) && (` ${published} `).includes(` ${selection} `)) command = "accept_cross_sell_offer";
        else if (/^(?:quero|inclua|adicione|adicionar)\s+(?:duas|dois|tres|quatro|[2-9][0-9]*)\b/.test(text)) command = "clarify_cross_sell_offer";
      }
    }
    // Unresolved add commands never fall through to the normal base-price writer
    // while a quote is pending. Questions and other read-only conversation do.
    if (!command && !input.action && offer?.status === "pending" && !input.attachmentContext
      && cartMessageAuthorizesAdd(input.message)) command = "clarify_cross_sell_offer";
    if (!command) return;
    const finish = (message: string, state: WhatsAppConversationState, blocks: WhatsAppStructuredResponse["blocks"] = []): WhatsAppStructuredResponse => ({
      agentMessage: message, quickReplies: ["Ver carrinho", "Finalizar pedido"], blocks,
      state: { ...state, history: [...state.history, { role: "user" as const, content: input.message }, { role: "assistant" as const, content: message }].slice(-24) } });
    if (input.attachmentContext) return finish("🤖 📎 Vou usar o anexo apenas como referência. Para escolher esse complemento, responda em uma nova mensagem ou use o botão da oferta.", input.state);
    const validArgs = !explicit || argsSchema.safeParse(explicit.args).success && explicit.args.offerId === offer?.id;
    if (!offer || !validArgs || offer.merchantId !== input.merchantId || offer.cartId !== input.state.conversationId
      || offer.status !== "pending" || offer.expiresAt <= Date.now()) {
      return finish("🤖 ⏳ Essa recomendação já foi encerrada ou mudou. Confira seu carrinho para continuar.", retireViews({ ...input.state,
        ...(offer?.status === "pending" && offer.expiresAt <= Date.now() ? { postCartOffer: { ...offer, status: "invalidated" } } : {}) }));
    }
    if (!input.verifiedOwner) return finish("🤖 🔒 Não consegui confirmar esta conversa para alterar o carrinho. Abra novamente o menu da loja.", input.state);
    if (command === "clarify_cross_sell_offer") return finish(`🤖 💬 A recomendação atual é *1 unidade de ${offer.name}* por *${money(offer.expectedQuote.maximumUnitPriceCents)}*.\n\n✨ Para manter essa cotação, escolha *Adicionar complemento* ou *Seguir sem extra*. Outra quantidade precisa de uma nova cotação.`, input.state, [block(offer)]);
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
      const accept = offer.kind === "recommendation" ? this.carts.acceptRecommendation?.bind(this.carts) : this.carts.accept.bind(this.carts);
      if (!accept) throw new Error("recommendation_authority_unavailable");
      await accept({ merchantId: input.merchantId, cartId: offer.cartId }, { expectedQuote: offer.expectedQuote });
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
