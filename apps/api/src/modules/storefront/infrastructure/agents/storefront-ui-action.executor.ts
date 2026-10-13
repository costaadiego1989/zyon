import type { StoreToolHandlers } from "../../domain/tools/types.js";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { StorefrontUiAction } from "../../domain/types/storefront-ui-action.js";
import { buildConversationBlocks } from "./conversation-block.builder.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";

export async function executeStorefrontUiAction(handlers: StoreToolHandlers, action: StorefrontUiAction, merchantId: string, cartId: string) {
  try {
    return await executeAction(handlers, action, merchantId, cartId);
  } catch (error) {
    if (!(error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException)) throw error;
    return { message: "Não consegui concluir essa seleção. O produto pode estar indisponível ou suas condições ter mudado. Escolha outra opção ou consulte seu carrinho.", blocks: [] as ConversationBlock[] };
  }
}

async function executeAction(handlers: StoreToolHandlers, action: StorefrontUiAction, merchantId: string, cartId: string) {
  const a = action.args; const str = (key: string) => typeof a[key] === "string" ? a[key] as string : "";
  let result: any; let message: string;
  switch (action.tool) {
    case "add_catalog_items": {
      const lines = Array.isArray(a.lines) ? a.lines : [];
      if (!lines.length || lines.length > 30 || lines.some(line => typeof line?.variantId !== "string" || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99)) throw new Error("store_ui_catalog_order_invalid");
      const results = [];
      for (const line of lines) results.push(await handlers.addItemToCart({ cartId, variantId: line.variantId, quantity: line.quantity }));
      result = { success: results.every(r => !(r as any)?.error && (r as any)?.success !== false) };
      message = result.success ? "Confira os itens do catálogo no seu carrinho. A compra será confirmada após o pagamento." : "Alguns itens não puderam ser adicionados. Confira o carrinho e as opções disponíveis.";
      break;
    }
    case "get_product_details": result = await handlers.getProductDetails({ productId: str("productId") }); message = "Aqui estão os detalhes do produto:"; break;
    case "search_products": result = await handlers.searchProducts({ query: str("query") || "*", categoryId: str("categoryId") || undefined, cursor: str("cursor") || undefined }); message = "Estes são os produtos disponíveis:"; break;
    case "list_categories": result = await handlers.listCategories(); message = "Escolha uma categoria:"; break;
    case "get_reviews": result = await handlers.getReviews({ productId: str("productId"), cursor: str("cursor") || undefined }); message = "Veja as avaliações:"; break;
    case "get_similar_products": result = await handlers.getSimilarProducts({ productId: str("productId") }); message = "Veja os produtos semelhantes:"; break;
    case "compare_products": result = await handlers.compareProducts({ productId: str("productId"), includeSimilar: true }); message = "Compare os produtos:"; break;
    case "get_daily_deals": result = await handlers.getDailyDeals({}); message = "Confira as ofertas disponíveis:"; break;
    case "add_item_to_cart": {
      const quantity = Number(a.quantity ?? 1);
      if (!str("variantId") || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("store_ui_variant_or_quantity_invalid");
      result = await handlers.addItemToCart({ cartId, variantId: str("variantId"), quantity, selectedServiceSlotId: str("selectedServiceSlotId") || undefined, selectedOptionItemIds: Array.isArray(a.selectedOptionItemIds) ? a.selectedOptionItemIds.filter((id): id is string => typeof id === "string") : undefined });
      message = result?.success === false || result?.error ? "Não foi possível adicionar este item. Confira as opções disponíveis." : "Confira o resultado da inclusão no carrinho:";
      break;
    }
    case "get_cart": result = await handlers.getCart({ cartId }); message = "Este é o seu carrinho:"; break;
    case "get_wishlist": result = await handlers.getWishlist(); message = "Sua lista de desejos:"; break;
    case "add_to_wishlist": result = await handlers.addToWishlist({ productId: str("productId") }); message = "Confira sua lista de desejos:"; break;
    case "remove_from_wishlist": result = await handlers.removeFromWishlist({ productId: str("productId") }); message = "Confira sua lista de desejos:"; break;
    case "remove_cart_item": result = await handlers.removeCartItem({ cartId, variantId: str("variantId") }); message = "Confira seu carrinho atualizado:"; break;
    case "update_cart_item": {
      const quantity = Number(a.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("store_ui_quantity_invalid");
      result = await handlers.updateCartItem({ cartId, variantId: str("variantId"), quantity }); message = "Confira seu carrinho atualizado:"; break;
    }
    case "apply_coupon": result = await handlers.applyCoupon({ cartId, couponCode: str("couponCode") }); message = result?.applied ? "Cupom aplicado. Confira o total atualizado:" : "O cupom não pôde ser aplicado. Confira as condições."; break;
    case "create_checkout_session": result = await handlers.createCheckoutSession({ cartId }); message = "Vamos finalizar sua compra:"; break;
    default: throw new Error("store_ui_action_unsupported");
  }
  const toolResults: Record<string, unknown> = { [action.tool]: result };
  if (["get_cart", "remove_cart_item", "update_cart_item", "apply_coupon", "add_item_to_cart", "add_catalog_items"].includes(action.tool)) toolResults.get_cart = await handlers.getCart({ cartId });
  const built = buildConversationBlocks({ toolResults, userMessage: action.tool === "get_product_details" ? "Detalhes do produto" : message, finalContent: message, merchantId });
  const blocks: ConversationBlock[] = built.blocks;
  if (action.tool === "list_categories" && !blocks.some(b => b.type === "category_carousel" as string)) blocks.push({ type: "category_carousel", data: { categories: Array.isArray(result) ? result : result?.categories ?? [] } } as unknown as ConversationBlock);
  const failed = !!result?.error || result?.success === false;
  if (failed) message = "Não foi possível concluir esta ação. " + (typeof result.message === "string" ? result.message : "Confira as opções disponíveis.");
  return { message: failed ? message : built.finalContent || message, blocks };
}
