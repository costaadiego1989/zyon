import { Injectable, Logger, Optional } from "@nestjs/common";
import { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";

export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

export interface ToolExecutionResult {
  toolCalls: ToolCall[];
  message: string;
}

/**
 * Executes LLM tool calls (discount, shipping, coupon, marketplace search).
 * Single Responsibility: take a tool_call from the LLM and produce a result string.
 */
@Injectable()
export class ChatToolExecutorService {
  private readonly logger = new Logger(ChatToolExecutorService.name);

  constructor(
    @Optional() private readonly searchMarketplace?: SearchFederatedProductsUseCase,
  ) {}

  async executeToolCalls(
    toolCalls: Array<{ function?: { name: string; arguments: string | object } }>,
    context: { merchantId: string },
  ): Promise<ToolExecutionResult> {
    const executed: ToolCall[] = [];
    const results: string[] = [];

    for (const tc of toolCalls) {
      const fn = tc.function?.name ?? "";
      const args = typeof tc.function?.arguments === "string"
        ? JSON.parse(tc.function.arguments)
        : tc.function?.arguments ?? {};

      executed.push({ name: fn, args });

      switch (fn) {
        case "apply_discount":
          results.push(`✅ Desconto de ${args.percent}% aplicado no carrinho`);
          break;

        case "apply_free_shipping":
          results.push(`✅ Frete grátis aplicado`);
          break;

        case "apply_coupon":
          results.push(`✅ Cupom ${args.code} aplicado`);
          break;

        case "search_marketplace":
          if (args.query) {
            results.push(await this.executeMarketplaceSearch(args.query, context.merchantId));
          }
          break;

        default:
          this.logger.warn(`Unknown tool call: ${fn}`);
      }
    }

    return { toolCalls: executed, message: results.join("\n") };
  }

  private async executeMarketplaceSearch(query: string, merchantId: string): Promise<string> {
    if (!this.searchMarketplace) {
      return "Marketplace não disponível.";
    }

    try {
      const result = await this.searchMarketplace.execute({
        query,
        hostMerchantId: merchantId,
        limit: 5,
      });

      const products = result.products ?? [];
      if (products.length === 0) {
        return "Não encontrei esse produto em lojas parceiras.";
      }

      const productList = products.slice(0, 3).map((p) =>
        `• ${p.name} — R$${(p.priceCents / 100).toFixed(2)} (vendido por loja parceira)`
      ).join("\n");

      return `Encontrei nos parceiros:\n${productList}`;
    } catch (err) {
      this.logger.error(`Marketplace search failed: ${err}`);
      return "Não consegui buscar no marketplace agora.";
    }
  }
}
