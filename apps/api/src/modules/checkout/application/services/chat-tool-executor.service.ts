import { Injectable, Logger, Optional } from "@nestjs/common";
import { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import type { AuthorizedOffer } from "@zyon/shared-types";

export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

export interface ChatBlock {
  type: string;
  data?: Record<string, unknown>;
}

export interface ToolExecutionResult {
  toolCalls: ToolCall[];
  message: string;
  blocks?: ChatBlock[];
}

/**
 * Executes LLM tool calls (discount, shipping, coupon, marketplace search, UI navigation).
 * CRITICAL: Every commercial tool call is validated against authorizedOffer.
 * LLM cannot apply discounts/shipping that the rules-engine didn't approve.
 */
@Injectable()
export class ChatToolExecutorService {
  private readonly logger = new Logger(ChatToolExecutorService.name);

  constructor(
    @Optional() private readonly searchMarketplace?: SearchFederatedProductsUseCase,
  ) {}

  async executeToolCalls(
    toolCalls: Array<{ function?: { name: string; arguments: string | object } }>,
    context: {
      merchantId: string;
      authorizedOffer?: AuthorizedOffer;
      shippingOptions?: Array<{ key: string; label: string; tag?: string; sub?: string; cost?: number }>;
      paymentMethods?: Array<{ key: string; label: string; sub?: string }>;
      address?: { formatted?: string; [k: string]: unknown };
    },
  ): Promise<ToolExecutionResult> {
    const executed: ToolCall[] = [];
    const results: string[] = [];
    const blocks: ChatBlock[] = [];
    const offer = context.authorizedOffer;

    for (const tc of toolCalls) {
      const fn = tc.function?.name ?? "";
      const args = typeof tc.function?.arguments === "string"
        ? JSON.parse(tc.function.arguments)
        : tc.function?.arguments ?? {};

      executed.push({ name: fn, args });

      switch (fn) {
        case "apply_discount": {
          const requestedPercent = Number(args.percent) || 0;
          if (offer?.approved && offer.type === "discount_percent" && offer.value >= requestedPercent) {
            results.push(`✅ Desconto de ${offer.value}% aplicado no carrinho`);
          } else {
            this.logger.warn(`Blocked unauthorized discount tool call: ${requestedPercent}% (authorized: ${offer?.value ?? 0}%)`);
            results.push("Vou verificar a melhor condição disponível para o seu pedido.");
          }
          break;
        }

        case "apply_free_shipping": {
          if (offer?.approved && offer.type === "shipping_free") {
            results.push(`✅ Frete grátis aplicado`);
          } else {
            this.logger.warn("Blocked unauthorized free shipping tool call");
            results.push("Vou verificar as opções de frete disponíveis para sua região.");
          }
          break;
        }

        case "apply_coupon": {
          results.push(`Verificando cupom ${args.code}...`);
          break;
        }

        case "search_marketplace":
          if (args.query) {
            results.push(await this.executeMarketplaceSearch(args.query, context.merchantId));
          }
          break;

        // ─── UI Navigation Tools ───
        case "confirm_address": {
          if (context.address?.formatted) {
            blocks.push({ type: "address_confirmation", data: context.address });
          }
          break;
        }

        case "show_shipping_options": {
          if (context.shippingOptions?.length) {
            blocks.push({ type: "shipping_options", data: { options: context.shippingOptions } });
          }
          break;
        }

        case "show_payment_methods": {
          if (context.paymentMethods?.length) {
            blocks.push({ type: "payment_methods", data: { methods: context.paymentMethods } });
          }
          break;
        }

        case "request_cep": {
          blocks.push({ type: "form_field", data: { field: "cep", label: "CEP de entrega", placeholder: "00000-000" } });
          break;
        }

        default:
          this.logger.warn(`Unknown tool call: ${fn}`);
      }
    }

    return { toolCalls: executed, message: results.join("\n"), blocks: blocks.length ? blocks : undefined };
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
