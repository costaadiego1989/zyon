import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import type { StoreToolHandlers } from "../../domain/tools/types.js";
import { buildConversationBlocks } from "./conversation-block.builder.js";
import { allowsSalesDiscovery, countSalesDiscoveryRounds, isBroadShoppingRequest, isUnspecifiedShoppingRequest,
  MAX_SALES_DISCOVERY_ROUNDS, salesDiscoveryHistory, type SalesDiscoveryQuestion } from "../../domain/services/sales-discovery.js";
import { salesSearchMaxPrice } from "../../domain/services/sales-search-policy.js";

/** Sufficiently defined requests need a real lookup, but a clarification must
 * not be replaced by products. Shared by chat and the voice commerce handoff. */
export async function ensureProductDiscovery<T extends { message: string; blocks: ConversationBlock[]; toolsUsed: string[]; discoveryQuestion?: SalesDiscoveryQuestion }>(
  result: T, input: { userMessage: string; merchantId: string; handlers: StoreToolHandlers; history?: Array<{ role: "user" | "assistant"; content: string }> },
): Promise<T> {
  const history = salesDiscoveryHistory(input.history ?? [], input.userMessage).slice(-10);
  if (result.discoveryQuestion || (isBroadShoppingRequest(input.userMessage)
    && countSalesDiscoveryRounds(history) < MAX_SALES_DISCOVERY_ROUNDS)) return result;
  const exhausted = countSalesDiscoveryRounds(history) >= MAX_SALES_DISCOVERY_ROUNDS && allowsSalesDiscovery(input.userMessage)
    && history.some(item => item.role === "user" && (isBroadShoppingRequest(item.content) || isUnspecifiedShoppingRequest(item.content)));
  const message = input.userMessage.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (result.toolsUsed.length || result.blocks.length || (!exhausted && !/(quero|preciso|procuro|busco|encontre|indique|recomende|sugira).*\bprodutos?\b.*\b(para|pra|com|sem|que)\b/.test(message))
    || /\b(adicionar|remover|cancelar|carrinho|pagar|pagamento|pedido|checkout|frete)\b/.test(message)) return result;
  const query = exhausted ? [...history.filter(item => item.role === "user").slice(-3).map(item => item.content), input.userMessage].join(". ") : input.userMessage;
  const maxPrice = salesSearchMaxPrice(query);
  const found = await input.handlers.searchProducts({ query, inStockOnly: true, limit: 3,
    ...(maxPrice !== undefined ? { maxPrice } : {}) }) as { products?: Array<{ price?: number }> };
  // A federated provider must not bypass an explicitly stated spending cap.
  if (maxPrice !== undefined) found.products = found.products?.filter(product => typeof product.price === "number" && product.price <= maxPrice);
  const intro = found.products?.length ? "Encontrei opções relacionadas ao que você procura. Escolha um produto para ver os detalhes ou me conte mais sobre sua necessidade."
    : exhausted ? "Não encontrei produtos correspondentes às preferências que você informou. Não vou indicar uma opção sem correspondência confirmada."
      : "Não encontrei produtos correspondentes ao que você descreveu. Pode detalhar o que procura?";
  const built = buildConversationBlocks({ toolResults: { search_products: found }, userMessage: input.userMessage, finalContent: intro, merchantId: input.merchantId });
  return { ...result, message: built.finalContent || intro, blocks: built.blocks, toolsUsed: ["search_products"] };
}
