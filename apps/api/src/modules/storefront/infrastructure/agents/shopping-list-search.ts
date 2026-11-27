import type { StoreToolHandlers } from "../../domain/tools/store-tools.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import { MAX_SHOPPING_LIST_ITEMS, readStorefrontShoppingList } from "../../domain/services/storefront-shopping-list.js";
import { callStorefrontTool } from "../../domain/tools/call-storefront-tool.js";
import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { observeStorefrontOperation } from "../observability/storefront-observation.js";
import { buildConversationBlocks } from "./conversation-block.builder.js";
import type { StorefrontAgentCallbacks } from "./store-langgraph-agent.js";
import type { z } from "zod";

type ListedProduct = z.infer<typeof storefrontToolOutputSchemas.search_products>["products"][number];

/** Read-only list matching. File quantities/instructions never become cart tools. */
export async function searchShoppingListProducts(input: {
  attachmentContext?: string; merchantId: string; userMessage: string; handlers: StoreToolHandlers; callbacks?: StorefrontAgentCallbacks;
}): Promise<{ message: string; blocks: ConversationBlock[]; toolsUsed: string[]; confirmed: boolean } | undefined> {
  const list = readStorefrontShoppingList(input.attachmentContext);
  if (!list) return undefined;
  const toolsUsed: string[] = [];
  const refuse = (message: string) => ({ message, blocks: [] as ConversationBlock[], toolsUsed, confirmed: false });
  if ("error" in list) return refuse(list.error === "too_many_items"
    ? `Pesquiso até ${MAX_SHOPPING_LIST_ITEMS} itens por lista. Divida o arquivo em listas menores para consultar todos os itens.`
    : "Não consegui ler os nomes dessa lista. Envie um produto por linha, com até 500 caracteres por item.");
  const products = new Map<string, ListedProduct>(); let matched = 0;
  try {
    for (const query of list.queries) {
      const args = { query, inStockOnly: true, limit: 3 };
      toolsUsed.push("search_products"); input.callbacks?.onToolCall?.("search_products", args);
      const checked = await observeStorefrontOperation("tool", () => callStorefrontTool("search_products", args, () => input.handlers.searchProducts(args)), { tool: "search_products" });
      input.callbacks?.onToolResult?.("search_products", checked);
      const result = checked.ok ? storefrontToolOutputSchemas.search_products.safeParse(checked.data) : undefined;
      if (!result?.success) return refuse("Não consegui concluir a busca dessa lista. Tente novamente; nenhum produto foi adicionado ao carrinho.");
      if (result.data.products.length) matched++;
      for (const product of result.data.products.slice(0, 3)) products.set(product.id, product);
    }
  } catch { return refuse("Não consegui concluir a busca dessa lista. Tente novamente; nenhum produto foi adicionado ao carrinho."); }
  const message = matched ? `Encontrei opções para ${matched} de ${list.queries.length} itens da lista. Confira os produtos e escolha as opções antes de adicionar ao carrinho.`
    : "Não encontrei correspondências para os itens dessa lista. Confira os nomes ou procure um produto por vez.";
  const built = buildConversationBlocks({ merchantId: input.merchantId, userMessage: input.userMessage, finalContent: message,
    toolResults: { search_products: { products: [...products.values()], total: products.size } } });
  return { message, blocks: built.blocks, toolsUsed, confirmed: true };
}
