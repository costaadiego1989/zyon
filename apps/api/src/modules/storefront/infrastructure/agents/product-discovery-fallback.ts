import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import type { StoreToolHandlers } from "../../domain/tools/types.js";
import { buildConversationBlocks } from "./conversation-block.builder.js";
import { allowsSalesDiscovery, countSalesDiscoveryRounds, isBroadShoppingRequest, isUnspecifiedShoppingRequest,
  MAX_SALES_DISCOVERY_ROUNDS, salesDiscoveryHistory, type SalesDiscoveryQuestion } from "../../domain/services/sales-discovery.js";
import { createSalesSearchPolicy } from "../../domain/services/sales-search-policy.js";
import { hasCareProfile, salesRecommendationContext } from "../../domain/services/sales-recommendation-intent.js";
import { callStorefrontTool } from "../../domain/tools/call-storefront-tool.js";
import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";

/** Consultative discovery and bounded catalog policy remain behind the server
 * domain decision; clarification is never replaced by a product dump. */
export async function ensureProductDiscovery<T extends { message: string; blocks: ConversationBlock[]; toolsUsed: string[]; discoveryQuestion?: SalesDiscoveryQuestion }>(
  result: T, input: { userMessage: string; merchantId: string; handlers: StoreToolHandlers;
    history?: Array<{ role: "user" | "assistant"; content: string }>; discoveryDecision?: boolean },
): Promise<T> {
  if (result.toolsUsed.length || result.blocks.length || input.discoveryDecision === false) return result;
  // A positive server-owned semantic decision also covers explicit catalog
  // navigation, which must not become a sales interview. This flag never comes
  // from browser text and cannot authorize a commercial mutation.
  if (input.discoveryDecision !== true && !allowsSalesDiscovery(input.userMessage)) return result;
  const history = salesDiscoveryHistory(input.history ?? [], input.userMessage).slice(-10);
  if (result.discoveryQuestion || (isBroadShoppingRequest(input.userMessage)
    && countSalesDiscoveryRounds(history) < MAX_SALES_DISCOVERY_ROUNDS)) return result;
  const exhausted = countSalesDiscoveryRounds(history) >= MAX_SALES_DISCOVERY_ROUNDS && allowsSalesDiscovery(input.userMessage)
    && history.some(item => item.role === "user" && (isBroadShoppingRequest(item.content) || isUnspecifiedShoppingRequest(item.content)));
  const message = input.userMessage.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const context = salesRecommendationContext(input.userMessage, history);
  const profileReady = allowsSalesDiscovery(input.userMessage) && hasCareProfile(context);
  const legacyNeedsDiscovery = (exhausted || profileReady || /(quero|preciso|procuro|busco|encontre|indique|recomende|sugira).*\bprodutos?\b.*\b(para|pra|com|sem|que)\b/.test(message))
    && !/\b(adicionar|remover|cancelar|carrinho|pagar|pagamento|pedido|checkout|frete)\b/.test(message);
  if (!(input.discoveryDecision ?? legacyNeedsDiscovery)) return result;
  const unavailable = (): T => ({ ...result, message: "Não consegui consultar o catálogo agora. Tente novamente em instantes.", blocks: [], toolsUsed: ["search_products"] });
  const policy = createSalesSearchPolicy(input.userMessage, history);
  const [search] = policy.wrap([{ name: "search_products", execute: async args => callStorefrontTool("search_products", args,
    checked => input.handlers.searchProducts(checked as Parameters<StoreToolHandlers["searchProducts"]>[0])) }]);
  let checked;
  try { checked = await search!.execute({ query: context, inStockOnly: true, limit: 3 }); }
  catch { return unavailable(); }
  if (!checked.ok) return unavailable();
  const parsed = storefrontToolOutputSchemas.search_products.safeParse(checked.data);
  if (!parsed.success) return unavailable();
  const found = parsed.data;
  const intro = policy.recommendationMessage ?? (found.products?.length ? "Encontrei opções relacionadas ao que você procura. Escolha um produto para ver os detalhes ou me conte mais sobre sua necessidade."
    : exhausted ? "Não encontrei produtos correspondentes às preferências que você informou. Não vou indicar uma opção sem correspondência confirmada."
      : "Não encontrei produtos correspondentes ao que você descreveu. Pode detalhar o que procura?");
  const built = buildConversationBlocks({ toolResults: { search_products: found }, userMessage: input.userMessage, finalContent: intro, merchantId: input.merchantId,
    presentationMode: input.discoveryDecision !== undefined ? "structured" : "legacy" });
  return { ...result, message: built.finalContent || intro, blocks: built.blocks, toolsUsed: ["search_products"] };
}
