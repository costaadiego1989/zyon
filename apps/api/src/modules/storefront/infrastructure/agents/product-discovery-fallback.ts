import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import type { StoreToolHandlers } from "../../domain/tools/types.js";
import { buildConversationBlocks } from "./conversation-block.builder.js";

/** A clear discovery request must produce an actual catalog lookup even when
 * the model answers conversationally without executing a tool. Shared by all channels. */
export async function ensureProductDiscovery<T extends { message: string; blocks: ConversationBlock[]; toolsUsed: string[] }>(
  result: T, input: { userMessage: string; merchantId: string; handlers: StoreToolHandlers },
): Promise<T> {
  const message = input.userMessage.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (result.toolsUsed.length || result.blocks.length || !/(quero|preciso|procuro|busco|encontre|indique|recomende|sugira).*\bprodutos?\b.*\b(para|pra|com|sem|que)\b/.test(message)
    || /\b(adicionar|remover|cancelar|carrinho|pagar|pagamento|pedido|checkout|frete)\b/.test(message)) return result;
  const found = await input.handlers.searchProducts({ query: input.userMessage, inStockOnly: true, limit: 3 }) as { products?: unknown[] };
  const intro = found.products?.length ? "Encontrei opções relacionadas ao que você procura. Escolha um produto para ver os detalhes ou me conte mais sobre sua necessidade."
    : "Não encontrei produtos correspondentes ao que você descreveu. Pode detalhar o que procura?";
  const built = buildConversationBlocks({ toolResults: { search_products: found }, userMessage: input.userMessage, finalContent: intro, merchantId: input.merchantId });
  return { ...result, message: built.finalContent || intro, blocks: built.blocks, toolsUsed: ["search_products"] };
}
