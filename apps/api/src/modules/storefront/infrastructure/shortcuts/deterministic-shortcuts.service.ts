import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { StorefrontConversationInput, StorefrontConversationOutput } from "../../domain/ports/conversation.port.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import type { AgentCopyService } from "../copy/agent-copy.service.js";

export interface DeterministicShortcutDeps {
  productRepo: ProductRepositoryPort;
  copyService: AgentCopyService;
  emitFunnelEvent: (merchantId: string, sessionId: string, event: string) => Promise<void>;
  applyCoupon?: (args: { cartId?: string; couponCode: string }) => Promise<any>;
  getCartBlock?: (cartId: string) => Promise<ConversationBlock | null>;
}

const formatPrice = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

async function resolveOffersShortcut(
  deps: DeterministicShortcutDeps,
  input: StorefrontConversationInput,
  normalizedMsg: string,
): Promise<StorefrontConversationOutput | null> {
  const triggers = ["ofertas", "ofertas do dia", "promoções", "promocoes", "ver produtos"];
  if (!triggers.includes(normalizedMsg)) return null;

  try {
    const result = await deps.productRepo.search({
      merchantId: input.merchantId,
      query: normalizedMsg === "ver produtos" ? "*" : undefined,
      isActiveOnly: true,
      limit: 10,
    });
    if (result.products.length === 0) return null;

    deps.emitFunnelEvent(input.merchantId, input.sessionId, "product_viewed").catch(() => {});

    const blocks: ConversationBlock[] = [{
      type: "product_carousel",
      data: {
        products: result.products.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.defaultVariant?.basePriceInCents ?? 0,
          priceFormatted: formatPrice(p.defaultVariant?.basePriceInCents ?? 0),
          image: p.defaultVariant?.media?.[0]?.url,
          inStock: p.hasStock,
          badge: "Oferta",
          discountPercent: 15,
        })),
      },
    } as ConversationBlock];

    const isProducts = normalizedMsg === "ver produtos";
    const introDefault = isProducts ? "Encontrei esses produtos para você:" : "Aqui estão nossas ofertas:";
    const introMessage = await deps.copyService.generateVariantCopy(
      input.experimentSystemPrompt,
      isProducts
        ? "Responda em 1 frase curta e amigável que encontrou produtos pra o cliente. Não liste os produtos."
        : "Responda em 1 frase curta e animada apresentando as ofertas do dia. Não liste os produtos.",
      introDefault,
    );
    return {
      message: introMessage,
      blocks,
      suggestedNext: ["Selecionar Produto", "Filtrar Produtos", "Categorias", "Ofertas do Dia"],
    };
  } catch {
    return null;
  }
}

async function resolveDetailsShortcut(
  deps: DeterministicShortcutDeps,
  input: StorefrontConversationInput,
  normalizedMsg: string,
): Promise<StorefrontConversationOutput | null> {
  const detalhesMatch = normalizedMsg.match(/^detalhes\s+(.+)$/);
  if (!detalhesMatch) return null;

  const productName = detalhesMatch[1].trim();
  try {
    const detailResult = await deps.productRepo.search({
      merchantId: input.merchantId,
      query: productName,
      isActiveOnly: true,
      limit: 3,
    });
    const product = detailResult.products[0];
    if (!product) return null;

    const price = product.defaultVariant?.basePriceInCents ?? 0;
    const isDigitalOrService = product.type === "digital" || product.type === "service";
    const blocks: ConversationBlock[] = [{
      type: "product_card",
      data: {
        id: product.id,
        name: product.name,
        price,
        priceFormatted: formatPrice(price),
        image: product.defaultVariant?.media?.[0]?.url,
        description: product.description ?? undefined,
        inStock: product.hasStock,
        rating: product.averageRating ?? undefined,
        reviewCount: product.reviewCount ?? 0,
        detailed: true,
        stock: isDigitalOrService ? 999 : (product.totalStock ?? 0),
        sku: product.defaultVariant?.sku ?? product.variants?.[0]?.sku,
        variants: (product.variants ?? []).map((v: any) => {
          const attrs = (v.attributes ?? {}) as Record<string, string>;
          const attrKeys = Object.keys(attrs);
          const attrValues = Object.values(attrs);
          const variantStock = isDigitalOrService ? 999 : Math.max(0, (v.stockQuantity ?? 0) - (v.stockReserved ?? 0));
          return {
            id: v.id,
            name: v.name || attrKeys.join(" / ") || "Opção",
            value: attrValues.length > 0 ? attrValues.join(", ") : (v.sku ?? v.name ?? ""),
            sku: v.sku,
            stock: variantStock,
            price: v.basePriceInCents,
            priceFormatted: v.basePriceInCents ? formatPrice(v.basePriceInCents) : undefined,
          };
        }),
      },
    } as ConversationBlock];

    deps.emitFunnelEvent(input.merchantId, input.sessionId, "product_viewed").catch(() => {});
    const detailMessage = await deps.copyService.generateVariantCopy(
      input.experimentSystemPrompt,
      `Apresente o produto "${product.name}" em 1 frase curta e empolgante. Não repita o nome completo, diga "esse produto" ou algo natural.`,
      `Aqui estão os detalhes de **${product.name}**:`,
    );
    return {
      message: detailMessage,
      blocks,
      suggestedNext: [
        `Adicionar ${product.name} ao carrinho`,
        `Calcular frete para ${product.name}`,
        `Ver avaliações de ${product.name}`,
        "Ver mais produtos",
      ],
    };
  } catch {
    return null;
  }
}

/**
 * Deterministic coupon apply. Matches "aplicar cupom X" / "usar cupom X" /
 * "cupom X" and routes straight to the real applyCoupon handler — never the LLM
 * (which sometimes fails to emit the tool call). The discount is authorized
 * server-side by the coupon use-case; this shortcut only parses the code.
 */
async function resolveCouponShortcut(
  deps: DeterministicShortcutDeps,
  input: StorefrontConversationInput,
  normalizedMsg: string,
): Promise<StorefrontConversationOutput | null> {
  if (!deps.applyCoupon) return null;
  // Accept "aplicar cupom XPTO", "usar cupom XPTO", "cupom XPTO" (code = alnum, 3-32).
  const m = normalizedMsg.match(/^(?:aplicar|usar|use|quero(?:\s+usar)?)?\s*cupom\s+([a-z0-9][a-z0-9._-]{2,31})$/i);
  if (!m) return null;
  const code = m[1].toUpperCase();
  try {
    const result = await deps.applyCoupon({ cartId: input.cartId, couponCode: code });
    const blocks: ConversationBlock[] = [];
    if (deps.getCartBlock && input.cartId) {
      const cb = await deps.getCartBlock(input.cartId);
      if (cb) blocks.push(cb);
    }
    if (result?.applied) {
      const disc = typeof result.discount === "number" ? result.discount : (result.discountCents ?? 0) / 100;
      return {
        message: `Cupom ${code} aplicado! Desconto de ${formatPrice(Math.round(disc * 100))}.`,
        blocks,
        suggestedNext: ["Ver Carrinho", "Finalizar Compra"],
      };
    }
    // Honest rejection — never claim a discount that wasn't authorized.
    const reasonMap: Record<string, string> = {
      cart_empty: "Seu carrinho está vazio. Adicione um produto antes de aplicar o cupom.",
      COUPON_NOT_FOUND: `Não encontrei o cupom ${code}.`,
      coupon_not_found: `Não encontrei o cupom ${code}.`,
      COUPON_MIN_CART_NOT_MET: "O valor do carrinho ainda não atinge o mínimo desse cupom.",
      COUPON_EXPIRED: `O cupom ${code} está expirado.`,
      COUPON_ALREADY_APPLIED: `O cupom ${code} já foi aplicado.`,
      coupon_service_unavailable: "Não consegui validar o cupom agora. Tente novamente em instantes.",
    };
    const msg = reasonMap[result?.reason] ?? `Não foi possível aplicar o cupom ${code}.`;
    return { message: msg, blocks, suggestedNext: ["Ver Carrinho"] };
  } catch {
    return null; // fall through to the LLM on unexpected error
  }
}

export async function resolveDeterministicShortcut(
  deps: DeterministicShortcutDeps,
  input: StorefrontConversationInput,
): Promise<StorefrontConversationOutput | null> {
  const normalizedMsg = input.userMessage.trim().toLowerCase();
  return (
    (await resolveOffersShortcut(deps, input, normalizedMsg)) ??
    (await resolveDetailsShortcut(deps, input, normalizedMsg)) ??
    (await resolveCouponShortcut(deps, input, normalizedMsg))
  );
}
