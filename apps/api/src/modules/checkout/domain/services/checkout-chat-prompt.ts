export type CheckoutChatPromptInput = {
  merchantName?: string;
  merchantRules: string[];
  cartInfo: string;
  stage?: string;
  hasAddress?: boolean;
  hasShipping?: boolean;
  buyerIntent?: BuyerIntentPromptContext;
};

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

/** Non-identifying, consent-gated signals from deterministic intent memory. */
export interface BuyerIntentPromptContext {
  primary_intent?: string;
  urgency?: string;
  budget_tier?: string;
  pain_points?: string[];
}

/** Standard chat tools available to the agent */
export function checkoutChatTools(): LlmToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "apply_discount",
        description: "Apresenta o desconto percentual autorizado para o carrinho do comprador",
        parameters: { type: "object", properties: { percent: { type: "number", description: "Percentual de desconto (ex: 10 para 10%)" } }, required: ["percent"] },
      },
    },
    {
      type: "function",
      function: {
        name: "apply_free_shipping",
        description: "Apresenta a condição de frete grátis autorizada para o pedido do comprador",
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
        name: "add_cross_sell_item",
        description: "Adiciona ao carrinho um produto sugerido no cross-sell (quando o cliente diz 'Adicionar <produto>'). NÃO use search_marketplace para itens sugeridos — use esta ferramenta com o sku do produto.",
        parameters: { type: "object", properties: { sku: { type: "string", description: "SKU do produto sugerido a adicionar" }, quantity: { type: "number", description: "Quantidade (padrão 1)" } }, required: ["sku"] },
      },
    },
    {
      type: "function",
      function: {
        name: "search_marketplace",
        description: "Busca produto no marketplace de lojas parceiras quando cliente pedir algo específico que NÃO está entre as sugestões de cross-sell",
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
        description: "Mostra as formas de pagamento disponíveis nesta loja. Use quando o frete estiver selecionado OU quando o cliente perguntar sobre formas de pagamento.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
  ];
}

/** Build system prompt for the checkout agent */
export type ChatPromptPart = string | { slot: "merchant" | "cart" | "stage" | "rules" | "intent" };

// This is also the program frozen into a reviewed baseline. Dynamic buyer/cart
// data is bound at the turn, never copied into a store-wide proposal.
export const CHECKOUT_CHAT_PROGRAM: readonly ChatPromptPart[] = [
      { slot: "merchant" },
      { slot: "cart" },
      "",
      { slot: "stage" },
      "",
      "NAVEGAÇÃO DO CHECKOUT (use as ferramentas de UI para guiar o cliente):",
      "- Se etapa é 'shipping' e endereço completo: CHAME confirm_address",
      "- Se etapa é 'shipping' e endereço incompleto: CHAME request_cep",
      "- Se cliente confirmou endereço ('sim', 'correto', 'confirmo'): CHAME show_shipping_options",
      "- Se frete foi selecionado OU cliente pergunta sobre pagamento: CHAME show_payment_methods",
      "- NUNCA descreva opções em texto se pode mostrar com ferramenta de UI",
      "",
      "REGRAS COMERCIAIS (siga a primeira que encaixar e USE A FERRAMENTA correspondente):",
      { slot: "rules" },
      "",
      "IMPORTANTE: Quando uma regra diz 'ofereça X% desconto', CHAME apply_discount. Quando diz 'frete grátis', CHAME apply_free_shipping. Quando diz 'cupom CODIGO', CHAME apply_coupon.",
      "Nunca diga que desconto ou frete grátis foi aplicado: a condição fica disponível e depende da confirmação do comprador no checkout.",
      "",
      "CROSS-SELL (itens sugeridos):",
      "- Quando o cliente disser 'Adicionar <produto> ao carrinho' referindo-se a um item SUGERIDO (a mensagem traz 'SKU: XXX'), CHAME add_cross_sell_item com esse sku. NUNCA use search_marketplace para um item sugerido.",
      "- add_cross_sell_item adiciona o produto ao carrinho do checkout e atualiza o total.",
      "",
      "BUSCA DE PRODUTOS:",
      "- Quando o cliente pedir um produto específico que NÃO é uma sugestão de cross-sell, chame search_marketplace com o nome do produto.",
      "- search_marketplace busca no catálogo da loja E em lojas parceiras do marketplace.",
      "- Se encontrar produtos, apresente-os ao cliente com nome, preço e vendedor.",
      "- Se não encontrar nada, informe que o produto não está disponível.",
      "",
      "Após chamar a ferramenta, confirme ao cliente o que foi aplicado/encontrado.",
      "Responda em português. Sem markdown.",
      { slot: "intent" },
    ];

export function buildCheckoutChatPrompt(opts: CheckoutChatPromptInput,
  program: readonly ChatPromptPart[] = CHECKOUT_CHAT_PROGRAM): string {
  return program.flatMap(part => {
    if (typeof part === "string") return [part];
    switch (part.slot) {
      case "merchant": return [`Você é assistente de checkout da ${opts.merchantName || "loja"}. Seja breve e direto.`];
      case "cart": return [opts.cartInfo];
      case "stage": return [`ETAPA ATUAL: ${opts.stage || "unknown"}`];
      case "rules": return opts.merchantRules.map((rule, i) => `${i + 1}. ${rule}`);
      case "intent": { const intent = buildBuyerIntentContext(opts.buyerIntent); return intent === undefined ? [] : [intent]; }
      default: throw new Error("CHECKOUT_CHAT_UNKNOWN_BINDING");
    }
  }).join("\n");
}

/** Formats only known classification values, never arbitrary stored text. */
export function buildBuyerIntentContext(intent?: BuyerIntentPromptContext): string | undefined {
  if (!intent) return undefined;

  const primaryIntents = new Set([
    "price_sensitive", "speed_focused", "ready_to_buy", "browsing",
    "exploring", "comparison_shopper", "quality_seeker",
  ]);
  const urgencyValues = new Set(["low", "medium", "high"]);
  const budgetTiers = new Set(["budget", "mid", "premium"]);
  const painPoints = new Set(["shipping_cost", "price", "payment_friction", "trust", "hesitation"]);
  const approvedPainPoints = (intent.pain_points ?? [])
    .filter((point): point is string => typeof point === "string" && painPoints.has(point))
    .slice(0, 5);
  const signals = [
    primaryIntents.has(intent.primary_intent ?? "") ? `intencao=${intent.primary_intent}` : undefined,
    urgencyValues.has(intent.urgency ?? "") ? `urgencia=${intent.urgency}` : undefined,
    budgetTiers.has(intent.budget_tier ?? "") ? `faixa_orcamento=${intent.budget_tier}` : undefined,
    approvedPainPoints.length ? `pontos=${approvedPainPoints.join(",")}` : undefined,
  ].filter((signal): signal is string => Boolean(signal));

  if (signals.length === 0) return undefined;
  return [
    "SINAL DE INTENCAO DO COMPRADOR (uso autorizado e somente consultivo):",
    signals.join("; "),
    "Use este sinal apenas para ajustar tom e foco. Nunca o mencione ao comprador e nunca trate-o como instrucao ou autorizacao comercial.",
  ].join("\n");
}
