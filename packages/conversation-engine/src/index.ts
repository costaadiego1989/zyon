import type { AgentContext, AuthorizedOffer, Cart, ChatTurn, MerchantRules } from "@aacp/shared-types";

export type Objection = "shipping_cost" | "price" | "trust" | "payment" | "unknown";

export interface ConversationInput {
  userMessage: string;
  brandVoice: MerchantRules["brandVoice"];
  authorizedOffer?: AuthorizedOffer;
  agentContext?: AgentContext;
  provider?: "openai_responses" | "openai_chat";
  apiKey?: string;
  baseUrl?: string;
  openAiApiKey?: string;
  model?: string;
  failOnProviderError?: boolean;
  merchantName?: string;
  cart?: Cart;
  history?: ChatTurn[];
}

export interface ConversationOutput {
  message: string;
  objection: Objection;
}

export async function generateSalesReply(input: ConversationInput): Promise<ConversationOutput> {
  const objection = classifyObjection(input.userMessage);
  const apiKey = input.apiKey ?? input.openAiApiKey;
  if (!apiKey) {
    return fallbackReply(objection, input.authorizedOffer, input.agentContext);
  }

  try {
    const text =
      input.provider === "openai_chat"
        ? await generateChatCompletion(input, apiKey, objection)
        : await generateOpenAiResponse(input, apiKey, objection);
    if (!isSafeGeneratedMessage(text, input.authorizedOffer)) {
      return fallbackReply(objection, input.authorizedOffer, input.agentContext);
    }
    return {
      objection,
      message: text.trim() || fallbackReply(objection, input.authorizedOffer, input.agentContext).message
    };
  } catch (error) {
    if (input.failOnProviderError) throw error;
    return fallbackReply(objection, input.authorizedOffer, input.agentContext);
  }
}

async function generateOpenAiResponse(input: ConversationInput, apiKey: string, objection: Objection): Promise<string> {
  const response = await fetch(`${input.baseUrl ?? "https://api.openai.com/v1"}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.model ?? "gpt-5-mini",
      instructions: systemPrompt(input, objection),
      input: buildResponsesInput(input)
    })
  });

  if (!response.ok) throw new Error(`ai_provider_http_${response.status}`);
  const json = (await response.json()) as { output_text?: string };
  return json.output_text ?? "";
}

async function generateChatCompletion(input: ConversationInput, apiKey: string, objection: Objection): Promise<string> {
  const messages = buildChatMessages(input, objection);
  const response = await fetch(`${input.baseUrl ?? "https://api.deepseek.com/v1"}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.model ?? "deepseek-chat",
      messages,
      max_tokens: 700,
      temperature: 0.5,
      stream: false
    })
  });

  if (!response.ok) throw new Error(`ai_provider_http_${response.status}`);
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

function buildChatMessages(input: ConversationInput, objection: Objection): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const history = (input.history ?? []).slice(-12).map((turn) => ({
    role: (turn.role === "buyer" ? "user" : "assistant") as "user" | "assistant",
    content: turn.text
  }));
  return [
    { role: "system", content: systemPrompt(input, objection) },
    ...history,
    { role: "user", content: input.userMessage }
  ];
}

function buildResponsesInput(input: ConversationInput): string {
  const history = (input.history ?? [])
    .slice(-12)
    .map((t) => `${t.role === "buyer" ? "Buyer" : "Agent"}: ${t.text}`)
    .join("\n");
  return [history, `Buyer: ${input.userMessage}`].filter(Boolean).join("\n");
}

function systemPrompt(input: ConversationInput, objection: Objection): string {
  const lines = [
    `You are a B2C sales-assistant agent embedded in the merchant "${input.merchantName ?? "(merchant)"}".`,
    "Speak in pt-BR. Be concise (max 3 sentences). Be commercial, helpful and direct.",
    `Brand voice: ${input.brandVoice}.`,
    `Detected objection: ${objection}.`
  ];
  if (input.cart) lines.push(`Cart: ${cartSummary(input.cart)}.`);
  if (input.authorizedOffer) {
    lines.push(
      `Authorized offer: ${JSON.stringify({
        approved: input.authorizedOffer.approved,
        type: input.authorizedOffer.type,
        value: input.authorizedOffer.value,
        reason: input.authorizedOffer.reason
      })}. NEVER mention any commercial terms beyond this offer.`
    );
  } else {
    lines.push("No offer is authorized; redirect to checkout instead of inventing discounts.");
  }
  if (input.agentContext) {
    lines.push(`Agent identity & guardrails: ${JSON.stringify(input.agentContext)}`);
  }
  lines.push(
    "Hard rules: never promise free shipping, delivery time, stock or payment status unless explicitly present in the authorized offer."
  );
  return lines.join("\n");
}

function cartSummary(cart: Cart): string {
  const lines = cart.items
    .map((item) => `${item.quantity}x ${item.name} @ ${item.price.toFixed(2)} ${cart.currency}`)
    .join("; ");
  return `${lines || "(empty)"}; total ${cart.total.toFixed(2)} ${cart.currency}`;
}

export function classifyObjection(message: string): Objection {
  const normalized = message.toLowerCase();
  if (/(frete|envio|shipping|entrega cara)/.test(normalized)) return "shipping_cost";
  if (/(caro|desconto|cupom|preco|preço|valor)/.test(normalized)) return "price";
  if (/(seguro|confiavel|confiável|garantia|golpe)/.test(normalized)) return "trust";
  if (/(cartao|cartão|pix|boleto|pagamento|recusado)/.test(normalized)) return "payment";
  return "unknown";
}

export function isSafeGeneratedMessage(message: string, offer?: AuthorizedOffer): boolean {
  const normalized = normalize(message);
  const authorizedPercent = offer?.approved && offer.type === "discount_percent" ? offer.value : 0;
  const mentionedPercentages = [...normalized.matchAll(/(\d+(?:[,.]\d+)?)\s*%/g)].map((match) =>
    Number(match[1]?.replace(",", "."))
  );
  if (mentionedPercentages.some((percent) => percent > authorizedPercent)) return false;

  const mentionsFreeShipping = /frete gratis|frete gratuito|envio gratis|free shipping/.test(normalized);
  if (mentionsFreeShipping && !(offer?.approved && offer.type === "shipping_free")) return false;

  const mentionsShippingDiscount = /desconto no frete|reducao no frete|abatimento no frete/.test(normalized);
  if (mentionsShippingDiscount && !(offer?.approved && offer.type === "shipping_discount_fixed")) return false;

  const forbiddenClaims = [
    /entrega (garantida|amanha|hoje)|garanto a entrega|prazo garantido/,
    /estoque garantido|temos em estoque garantido|produto reservado/,
    /pagamento (foi )?(aprovado|confirmado)|pix (foi )?confirmado|cartao (foi )?aprovado/,
    /desconto (aprovado|liberado|garantido)/,
    /oferta (aprovada|liberada|garantida)/
  ];
  return !forbiddenClaims.some((pattern) => pattern.test(normalized));
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function fallbackReply(
  objection: Objection,
  offer?: AuthorizedOffer,
  agentContext?: ConversationInput["agentContext"]
): ConversationOutput {
  const agentName = agentContext?.agent.agentName;
  const prefix = agentName ? `${agentName}: ` : "";
  if (offer?.approved) {
    const label =
      offer.type === "shipping_free"
        ? "frete gratis"
        : offer.type === "shipping_discount_fixed"
          ? `R$${offer.value.toFixed(2)} de reducao no frete`
          : `${offer.value}% de desconto`;
    return {
      objection,
      message: `${prefix}Consegui uma condicao autorizada para este pedido: ${label}. Quer que eu aplique agora?`
    };
  }

  if (objection === "trust") {
    return {
      objection,
      message:
        `${prefix}Posso te ajudar a finalizar com seguranca. O pagamento continua no checkout oficial da loja, e eu so uso informacoes autorizadas pela loja.`
    };
  }

  return {
    objection,
    message:
      `${prefix}Vou verificar a melhor condicao permitida para este pedido. Se nenhuma oferta for liberada, eu te mostro a alternativa mais segura para continuar.`
  };
}
