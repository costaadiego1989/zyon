import type { AgentContext, AuthorizedOffer, Cart, ChatStage, ChatTurn, MerchantRules } from "@aacp/shared-types";

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
  stage?: ChatStage;
  missingFields?: string[];
  deliverySummary?: string;
}

export interface ConversationOutput {
  message: string;
  objection: Objection;
}

export async function generateSalesReply(input: ConversationInput): Promise<ConversationOutput> {
  const objection = classifyObjection(input.userMessage);
  const apiKey = input.apiKey ?? input.openAiApiKey;
  const fb = () =>
    fallbackReply(
      objection,
      input.authorizedOffer,
      input.agentContext,
      input.stage,
      input.missingFields,
      input.merchantName
    );
  if (!apiKey) return fb();

  try {
    const text =
      input.provider === "openai_chat"
        ? await generateChatCompletion(input, apiKey, objection)
        : await generateOpenAiResponse(input, apiKey, objection);
    if (!isSafeGeneratedMessage(text, input.authorizedOffer)) return fb();
    return {
      objection,
      message: text.trim() || fb().message
    };
  } catch (error) {
    if (input.failOnProviderError) throw error;
    return fb();
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
  const agent = input.agentContext?.agent ?? { agentName: "Assistente", persona: "ajudante", language: "pt-BR" };
  const lines = [
    `Você é ${agent.agentName}, persona: ${agent.persona}, atuando para ${input.merchantName || "nossa loja"}.`,
    `Voz da marca: ${input.brandVoice || "consultativa"}`,
    `Idioma: ${agent.language}`,
    "Seja breve, direto e focado no checkout. Não perca tempo com conversas fiadas.",
    "NUNCA use formatação markdown (como asteriscos ** para negrito ou itálico) em suas respostas. Use texto puro.",
    "Não repita a saudação se a conversa já começou.",
    `Objeção detectada: ${objection}.`
  ];
  if (input.stage) {
    lines.push(stageInstructions(input.stage, input.missingFields ?? []));
  }
  if (input.deliverySummary) {
    lines.push(`Contexto de entrega já conhecido (use como referência, não repita tudo): ${input.deliverySummary}`);
  }
  if (input.cart) lines.push(`Carrinho: ${cartSummary(input.cart)}.`);
  if (input.authorizedOffer) {
    lines.push(
      `Oferta autorizada: ${JSON.stringify({
        approved: input.authorizedOffer.approved,
        type: input.authorizedOffer.type,
        value: input.authorizedOffer.value,
        reason: input.authorizedOffer.reason
      })}. NUNCA mencione termos comerciais além desta oferta.`
    );
  } else {
    lines.push("Nenhuma oferta foi autorizada; nunca invente descontos.");
  }
  if (input.agentContext) {
    lines.push(`Identidade do agente e guardrails: ${JSON.stringify(input.agentContext)}`);
  }
  lines.push(
    "Regras rígidas: nunca prometa frete grátis, prazo, estoque ou status de pagamento que não estejam explicitamente na oferta autorizada."
  );
  return lines.join("\n");
}

function stageInstructions(stage: ChatStage, missingFields: string[]): string {
  if (stage === "data_collection") {
    const next = missingFields[0] ?? "";
    if (next === "código de verificação") {
      return [
        "ETAPA: Verificação OTP.",
        "Diga que enviou um código de verificação de 6 dígitos para o e-mail e peça para ele digitar.",
        "Não fale mais nada além disso. Apenas peça o código."
      ].join("\n");
    }
    const nextField = missingFields[0] ?? "nome";
    return [
      `ETAPA: cadastro do comprador.`,
      `CAMPOS FALTANDO (em ordem): ${missingFields.join(", ") || "nenhum"}.`,
      `REGRA: peça apenas o PRÓXIMO campo da lista (\"${nextField}\") em uma única frase.`,
      "Se o comprador levantar uma objeção, responda em uma frase e retome a coleta na frase seguinte.",
      "Nunca peça vários campos na mesma mensagem.",
      "PROIBIDO nesta etapa: mencionar cupom, desconto, negociação de preço ou frete detalhado — isso vem depois do cadastro."
    ].join("\n");
  }
  if (stage === "shipping") {
    const next = missingFields[0] ?? "CEP";
    if (next.includes("número")) {
      return [
        "ETAPA: endereço de entrega — já localizamos o logradouro pelo CEP.",
        "Peça somente o número do imóvel em uma frase curta.",
        "Não ofereça cupom ou desconto nesta etapa."
      ].join("\n");
    }
    if (next.includes("complemento")) {
      return [
        "ETAPA: endereço de entrega — já temos o número.",
        "Peça apenas se há algum complemento (apto, bloco, casa). Diga que se não houver, o comprador pode responder 'não tem'.",
        "Não ofereça cupom ou desconto nesta etapa."
      ].join("\n");
    }
    if (next.includes("confirmar")) {
      return "ETAPA: frete. O CEP informado não retornou endereço — peça que o comprador confira o CEP.";
    }
    return [
      "ETAPA: frete e endereço de entrega.",
      `Próximo passo obrigatório: \"${next}\" — peça explicitamente só isso.`,
      "MUITO IMPORTANTE: Não diga 'cadastro completo', 'pedido em andamento' ou 'encaminhando para finalização'. Apenas peça o CEP de entrega diretamente.",
      "Se falta o CEP, peça os 8 dígitos de CEP antes de qualquer assunto de pagamento.",
      "PROIBIDO antes do frete ficar claro: mencionar 'opções de pagamento', 'checkout' ou 'finalize a compra'.",
      "Não mencione cupom nesta etapa."
    ].join("\n");
  }
  if (stage === "payment") {
    return [
      "ETAPA: pagamento e fechamento.",
      "Agora você DEVE checar o desconto autorizado (em Authorized Offer) e oferecê-lo.",
      "INSTRUÇÃO DE NEGOCIAÇÃO: O sistema autoriza o desconto progressivamente (ex: de 1/3 até 100% do máximo).",
      "Sempre anuncie exatamente o valor que o sistema ativou na Oferta e espere. Se o comprador pedir mais, negue ou aguarde o backend aumentar na próxima rodada.",
      "Pergunte PIX ou cartão.",
      "NUNCA peça senhas, código de segurança do cartão ou dados bancários no chat.",
      "Seja breve (máx. 2 frases)."
    ].join("\n");
  }
  return "ETAPA: pedido finalizado. Agradeça e encerre.";
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
    /oferta (aprovada|liberada|garantida)/,
    /pedido (ja esta|segue|esta) (em andamento|para processamento)/,
    /cadastro (esta|ta) completo|encaminhar para finalizacao|cadastro confirmado/,
    /senha|c[óo]digo de seguran[çc]a|cvv|token do cart[ãa]o/
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
  agentContext?: ConversationInput["agentContext"],
  stage?: ChatStage,
  missingFields?: string[],
  merchantName?: string
): ConversationOutput {
  const agentName = agentContext?.agent.agentName;
  const prefix = agentName ? `${agentName}: ` : "";

  if (stage === "data_collection") {
    const next = missingFields?.[0];
    const stageMessage = stageMessageForField(next, merchantName, agentName);
    return { objection, message: `${prefix}${stageMessage}` };
  }
  if (stage === "shipping") {
    const next = missingFields?.[0] ?? "CEP";
    if (next.includes("número") || next.includes("complemento")) {
      return {
        objection,
        message: `${prefix}Já achei o endereço pelo CEP. Qual o número e complemento (apto/bloco, se houver)?`
      };
    }
    if (next.includes("confirmar")) {
      return {
        objection,
        message: `${prefix}Não consegui localizar esse CEP. Pode conferir os 8 dígitos e enviar de novo?`
      };
    }
    return {
      objection,
      message: `${prefix}Para calcular o frete, pode informar o CEP da entrega?`
    };
  }
  if (stage === "payment") {
    return {
      objection,
      message: `${prefix}Vamos finalizar — prefere pagar com PIX ou cartão de crédito?`
    };
  }

  if (offer?.approved) {
    const label =
      offer.type === "shipping_free"
        ? "frete grátis"
        : offer.type === "shipping_discount_fixed"
          ? `R$${offer.value.toFixed(2)} de redução no frete`
          : `${offer.value}% de desconto`;
    return {
      objection,
      message: `${prefix}Consegui uma condição autorizada para este pedido: ${label}. Quer que eu aplique agora?`
    };
  }

  if (objection === "trust") {
    return {
      objection,
      message:
        `${prefix}Posso te ajudar a finalizar com segurança. O pagamento continua no checkout oficial da loja e eu só uso informações autorizadas.`
    };
  }

  return {
    objection,
    message:
      `${prefix}Vou verificar a melhor condição permitida para este pedido. Se nenhuma oferta for liberada, te mostro a alternativa mais segura para continuar.`
  };
}

function stageMessageForField(field: string | undefined, merchantName?: string, agentName?: string): string {
  const greetingTail = merchantName ? ` da ${merchantName}` : "";
  switch (field) {
    case "nome":
      return `Olá! Sou ${agentName ?? "o assistente"}${greetingTail}. Antes de continuar, posso saber seu nome completo?`;
    case "email":
      return "Perfeito. Qual o seu melhor email para o pedido?";
    case "CPF":
      return "Obrigado. Pode me informar o CPF para emitir a nota?";
    case "telefone":
      return "Anotado. Qual o telefone com DDD para acompanharmos a entrega?";
    case "CEP":
      return "Para calcular o frete, pode informar o CEP da entrega?";
    default:
      return "Para começar, posso saber seu nome completo?";
  }
}
