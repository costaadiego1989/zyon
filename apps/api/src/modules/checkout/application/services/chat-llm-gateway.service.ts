import { Injectable, Logger } from "@nestjs/common";
import type { ToolCall } from "./chat-tool-executor.service.js";

export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCallResult {
  content: string | null;
  toolCalls: Array<{ function?: { name: string; arguments: string | object } }>;
}

/**
 * Gateway to local/cloud LLM providers.
 * Single Responsibility: send messages + tools to an LLM and return raw response.
 */
@Injectable()
export class ChatLlmGatewayService {
  private readonly logger = new Logger(ChatLlmGatewayService.name);

  /** Standard chat tools available to the agent */
  getTools(): LlmToolDefinition[] {
    return [
      {
        type: "function",
        function: {
          name: "apply_discount",
          description: "Aplica desconto percentual no carrinho do comprador",
          parameters: { type: "object", properties: { percent: { type: "number", description: "Percentual de desconto (ex: 10 para 10%)" } }, required: ["percent"] },
        },
      },
      {
        type: "function",
        function: {
          name: "apply_free_shipping",
          description: "Aplica frete grátis no pedido do comprador",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function",
        function: {
          name: "apply_coupon",
          description: "Aplica um cupom de desconto no carrinho",
          parameters: { type: "object", properties: { code: { type: "string", description: "Código do cupom" } }, required: ["code"] },
        },
      },
      {
        type: "function",
        function: {
          name: "search_marketplace",
          description: "Busca produto no marketplace de lojas parceiras quando cliente pedir algo específico",
          parameters: { type: "object", properties: { query: { type: "string", description: "Nome ou descrição do produto" } }, required: ["query"] },
        },
      },
      // ─── UI Navigation Tools — controlam quais componentes aparecem na tela ───
      {
        type: "function",
        function: {
          name: "confirm_address",
          description: "Mostra o card de confirmação do endereço de entrega. Use quando o cliente quiser prosseguir e o endereço precisar ser confirmado.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function",
        function: {
          name: "request_cep",
          description: "Mostra o campo para o cliente digitar o CEP. Use quando o endereço estiver incompleto ou o cliente quiser mudar o endereço de entrega.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function",
        function: {
          name: "show_shipping_options",
          description: "Mostra as opções de frete calculadas para o cliente escolher. Use quando o endereço estiver confirmado e for hora de escolher a entrega.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function",
        function: {
          name: "show_payment_methods",
          description: "Mostra as formas de pagamento disponíveis (Pix, cartão, crypto). Use quando o frete estiver selecionado OU quando o cliente perguntar sobre formas de pagamento.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
    ];
  }

  /** Build system prompt for the checkout agent */
  buildSystemPrompt(opts: {
    merchantName?: string;
    merchantRules: string[];
    cartInfo: string;
    stage?: string;
    hasAddress?: boolean;
    hasShipping?: boolean;
  }): string {
    return [
      `Você é assistente de checkout da ${opts.merchantName || "loja"}. Seja breve e direto.`,
      opts.cartInfo,
      "",
      `ETAPA ATUAL: ${opts.stage || "unknown"}`,
      "",
      "NAVEGAÇÃO DO CHECKOUT (use as ferramentas de UI para guiar o cliente):",
      "- Se etapa é 'shipping' e endereço completo: CHAME confirm_address",
      "- Se etapa é 'shipping' e endereço incompleto: CHAME request_cep",
      "- Se cliente confirmou endereço ('sim', 'correto', 'confirmo'): CHAME show_shipping_options",
      "- Se frete foi selecionado OU cliente pergunta sobre pagamento: CHAME show_payment_methods",
      "- NUNCA descreva opções em texto se pode mostrar com ferramenta de UI",
      "",
      "REGRAS COMERCIAIS (siga a primeira que encaixar e USE A FERRAMENTA correspondente):",
      ...opts.merchantRules.map((r, i) => `${i + 1}. ${r}`),
      "",
      "IMPORTANTE: Quando uma regra diz 'ofereça X% desconto', CHAME apply_discount. Quando diz 'frete grátis', CHAME apply_free_shipping. Quando diz 'cupom CODIGO', CHAME apply_coupon.",
      "",
      "BUSCA DE PRODUTOS:",
      "- Quando o cliente pedir um produto específico, SEMPRE chame search_marketplace com o nome do produto.",
      "- search_marketplace busca no catálogo da loja E em lojas parceiras do marketplace.",
      "- Se encontrar produtos, apresente-os ao cliente com nome, preço e vendedor.",
      "- Se não encontrar nada, informe que o produto não está disponível.",
      "",
      "Após chamar a ferramenta, confirme ao cliente o que foi aplicado/encontrado.",
      "Responda em português. Sem markdown.",
    ].join("\n");
  }

  /** Call LLM with fallback chain: Local LLM → DeepSeek cloud */
  async call(messages: LlmMessage[], tools: LlmToolDefinition[]): Promise<LlmCallResult | null> {
    const localUrl = process.env.LOCAL_LLM_BASE_URL || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
    const localModel = process.env.LOCAL_LLM_MODEL || process.env.OLLAMA_MODEL || "llama3.1:8b";
    const localKey = process.env.DEEPSEEK_API_KEY || "ollama";

    // Primary: local/configured LLM (5s timeout for local Ollama, 30s for cloud)
    const isCloud = localUrl.includes("deepseek") || localUrl.includes("openrouter") || localUrl.includes("openai");
    const timeout = isCloud ? 30000 : 5000;

    const primaryResult = await this.callProvider(
      `${localUrl}/chat/completions`, localKey, localModel, messages, tools, timeout,
    );
    if (primaryResult) return primaryResult;

    // Fallback: DeepSeek cloud (if not already the primary)
    const cloudKey = process.env.DEEPSEEK_API_KEY;
    const cloudUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
    if (cloudKey && !localUrl.includes("deepseek")) {
      const deepseekResult = await this.callProvider(
        `${cloudUrl}/chat/completions`,
        cloudKey,
        process.env.DEEPSEEK_MODEL || "deepseek-chat",
        messages,
        tools,
        30000,
      );
      if (deepseekResult) return deepseekResult;
    }

    return null;
  }

  private async callProvider(
    url: string,
    key: string,
    model: string,
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    timeoutMs: number,
  ): Promise<LlmCallResult | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, tools, max_tokens: 300, temperature: 0.3 }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`http_${res.status}`);

      const json = await res.json() as any;
      const choice = json.choices?.[0];

      if (choice?.message?.tool_calls?.length) {
        return {
          content: choice.message.content?.trim() || null,
          toolCalls: choice.message.tool_calls,
        };
      }

      return {
        content: choice?.message?.content?.trim() || null,
        toolCalls: [],
      };
    } catch {
      return null;
    }
  }
}
