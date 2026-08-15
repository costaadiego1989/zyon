/**
 * Storefront quick replies — context-intelligent tool-driven suggestions.
 *
 * Generates deterministic quick-reply suggestions based on last tool used
 * and current cart state. Used to populate suggestedNext after storefront
 * agent tool calls.
 *
 * Max 5 replies per context; always deterministic, never LLM-generated.
 */

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

/**
 * Generate smart quick-reply suggestions based on last tool action and cart state.
 *
 * @param lastToolUsed Name of the tool that was just executed
 * @param cartState Current cart state (items, total, coupon)
 * @param shippingOptions Available shipping options (if quote_shipping was called)
 * @returns Array of 1-5 quick-reply strings (Portuguese)
 */
export function storefrontQuickReplies(
  lastToolUsed: string | undefined,
  cartState?: StorefrontCartState,
  shippingOptions?: StorefrontShippingOption[]
): string[] {
  if (!lastToolUsed) {
    // Default: no recent tool call
    return cartState?.items.length
      ? ["Ver meu carrinho", "Buscar produtos", "Preciso de ajuda"]
      : ["O que vocês vendem?", "Tem promoção?", "Buscar produto"];
  }

  switch (lastToolUsed) {
    case "search_products":
      // After search: show product actions
      return ["Adicionar ao carrinho", "Ver detalhes", "Buscar outro produto"];

    case "get_product_details":
      // After viewing details: add to cart or continue
      return ["Adicionar ao carrinho", "Comparar com outro", "Continuar buscando"];

    case "add_item_to_cart":
      // After adding: continue shopping or go to cart
      return ["Continuar comprando", "Ver meu carrinho", "Finalizar compra"];

    case "remove_cart_item":
    case "update_cart_item":
      // After modifying cart: show updated cart and checkout
      return ["Ver carrinho atualizado", "Continuar comprando", "Finalizar compra"];

    case "get_cart": {
      // Context based on cart content
      if (!cartState?.items.length) {
        return ["Buscar produtos", "Ver promoções", "Quais categorias?"];
      }
      const hasMultipleItems = cartState.items.length > 1;
      const replies: string[] = ["Finalizar compra"];
      if (!cartState.couponCode) {
        replies.push("Aplicar cupom");
      }
      if (hasMultipleItems) {
        replies.push("Remover item");
      }
      replies.push("Continuar comprando");
      return replies.slice(0, 5);
    }

    case "apply_coupon": {
      // Coupon application result will be determined by success/failure in context
      // Success: show checkout, failure: show retry or continue
      // For now, generic: continue or finalize
      return ["Finalizar compra", "Ver carrinho atualizado", "Continuar comprando"];
    }

    case "remove_coupon":
      // After removing coupon
      return ["Aplicar outro cupom", "Finalizar compra", "Continuar comprando"];

    case "list_promotions":
      // After viewing promotions
      return ["Aplicar cupom ZYON10", "Ver carrinho", "Continuar comprando"];

    case "quote_shipping": {
      // After shipping quote: show carrier options as quick replies
      if (shippingOptions && shippingOptions.length > 0) {
        const carrierReplies = shippingOptions.map(opt => {
          const days = opt.days ? ` (${opt.days} dias)` : "";
          const price = formatMoney(opt.price);
          return `${opt.name}${days} - ${price}`;
        });
        // Trim to max 5
        return carrierReplies.slice(0, 5);
      }
      // Fallback if no options
      return ["Sedex", "PAC", "Finalizar compra"];
    }

    case "clear_cart":
      // After clearing: browse or view promotions
      return ["Buscar produtos", "Ver promoções", "Ver categorias"];

    case "create_checkout_session":
      // After checkout handoff: finishing flow
      return ["Acompanhar pedido", "Voltar à loja", "Suporte"];

    case "compare_products":
      // After comparison: add one or search more
      return ["Adicionar ao carrinho", "Buscar outro", "Ver detalhes"];

    case "get_product_availability":
      // After checking stock
      return ["Adicionar ao carrinho", "Notificar quando disponível", "Buscar alternativa"];

    default:
      // Fallback for unknown tools
      return cartState?.items.length
        ? ["Ver meu carrinho", "Buscar produtos", "Preciso de ajuda"]
        : ["Buscar produtos", "Ver promoções", "Continuar comprando"];
  }
}

/**
 * Format price in BRL currency for display.
 * Quick helper; production code should use centralized formatting.
 */
function formatMoney(valueCents: number): string {
  const valueReal = valueCents / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valueReal);
}
