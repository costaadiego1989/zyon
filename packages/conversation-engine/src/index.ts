import type { AgentContext, AuthorizedOffer, Cart, ChatStage, ChatTurn, MerchantRules, ShippingQuote } from "@aacp/shared-types";

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
  shippingOptions?: ShippingQuote[];
  fetchFn?: typeof fetch;
}

export interface ConversationOutput {
  message: string;
  objection: Objection;
}

export function generateDeterministicReply(input: ConversationInput): ConversationOutput {
  const objection = classifyObjection(input.userMessage);
  return fallbackReply(
    objection,
    input.authorizedOffer,
    input.agentContext,
    input.stage,
    input.missingFields,
    input.merchantName,
    input.deliverySummary,
    input.userMessage,
    input.shippingOptions
  );
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
      input.merchantName,
      input.deliverySummary,
      input.userMessage,
      input.shippingOptions
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
  const fetchFn = input.fetchFn ?? globalThis.fetch;
  const response = await fetchFn(`${input.baseUrl ?? "https://api.openai.com/v1"}/responses`, {
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
  const fetchFn = input.fetchFn ?? globalThis.fetch;
  const messages = buildChatMessages(input, objection);
  const response = await fetchFn(`${input.baseUrl ?? "https://api.deepseek.com/v1"}/chat/completions`, {
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
  if (input.shippingOptions?.length && input.stage === "shipping" && input.missingFields?.[0] === "frete") {
    const opts = input.shippingOptions
      .map((o) => `${o.method ?? o.carrier ?? "Frete"}: R$${o.customerPrice.toFixed(2)} (${o.deliveryDays ?? "?"} dias úteis)`)
      .join(" | ");
    lines.push(`Opções de frete disponíveis — apresente estas opções ao comprador e aguarde a escolha: ${opts}`);
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
    if (next === "código de verificação do celular") {
      return [
        "ETAPA: Verificação OTP de Celular.",
        "Diga que enviou um código de verificação por SMS para o telefone dele e peça para ele digitar.",
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
    if (next === "confirmar endereço") {
      return [
        "ETAPA: confirmar endereço.",
        "Apresente o endereço localizado (Rua, Cidade, UF) e peça para o comprador confirmar se está correto com 'Sim' ou 'Não'.",
        "Você DEVE sugerir os botões de resposta rápida Sim/Não."
      ].join("\n");
    }
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
    if (next === "frete") {
      return [
        "ETAPA: selecao de frete.",
        "As opcoes de frete ja foram calculadas. Peca ao comprador para escolher uma opcao disponivel.",
        "Nao peca CEP, numero ou complemento novamente.",
        "Nao mencione pagamento, PIX, cartao, cupom ou desconto antes da escolha do frete."
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
  merchantName?: string,
  deliverySummary?: string,
  userMessage?: string,
  shippingOptions?: ShippingQuote[]
): ConversationOutput {
  const agentName = agentContext?.agent.agentName;
  const prefix = agentName ? `${agentName}: ` : "";

  // Check if the message matches a known quick reply and provide contextual answer
  const quickReplyAnswer = matchQuickReplyResponse(userMessage ?? "", stage, missingFields, merchantName, deliverySummary);
  if (quickReplyAnswer) {
    return { objection, message: `${prefix}${quickReplyAnswer}` };
  }

  if (stage === "data_collection") {
    const next = missingFields?.[0];
    const stageMessage = stageMessageForField(next, merchantName, agentName);
    return { objection, message: `${prefix}${stageMessage}` };
  }
  if (stage === "shipping") {
    const next = missingFields?.[0] ?? "CEP";
    const normalizedNext = normalize(next);
    if (normalizedNext.includes("numero")) {
      return {
        objection,
        message: `${prefix}Ja achei o endereco pelo CEP. Qual o numero do imovel?`
      };
    }
    if (normalizedNext.includes("complemento")) {
      return {
        objection,
        message: `${prefix}Numero anotado. Tem complemento, como apto, bloco ou casa? Se nao tiver, responda "Nao tem".`
      };
    }
    if (next === "frete") {
      const optionCount = shippingOptions?.length ?? 0;
      return {
        objection,
        message: optionCount > 0
          ? `${prefix}Calculei ${optionCount} opcoes de frete. Selecione uma delas para seguirmos.`
          : `${prefix}Ja tenho o endereco completo. Vou carregar as opcoes de frete para voce escolher.`
      };
    }
    if (next === "confirmar endereço") {
      const addrSnippet = deliverySummary
        ?.replace(/^Referência para entrega:\s*/i, "")
        .replace(/\s*·\s*CEP\b.*$/, "")
        .trim();
      const addrLine = addrSnippet ? ` ${addrSnippet}.` : "";
      return {
        objection,
        message: `${prefix}Localizei o endereço pelo CEP:${addrLine} Está correto? (Sim/Não)`
      };
    }
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

/**
 * Matches known quick reply messages and returns a contextual response.
 * Returns null if no match found (falls through to default stage logic).
 */
function matchQuickReplyResponse(
  message: string,
  stage?: ChatStage,
  missingFields?: string[],
  merchantName?: string,
  _deliverySummary?: string
): string | null {
  const normalized = message.toLowerCase().trim();
  const storeName = merchantName ?? "nossa loja";
  const nextField = normalize(missingFields?.[0] ?? "");

  // --- Data Collection stage quick replies ---
  if (stage === "data_collection") {
    if (/por que precisa do meu nome/i.test(message)) {
      return `Precisamos do seu nome para emitir a nota fiscal e personalizar a entrega. Seus dados são usados apenas para esta compra em ${storeName}. Qual é o seu nome completo?`;
    }
    if (/posso usar nome de empresa/i.test(message)) {
      return `Sim, pode usar o nome da empresa se preferir. Nesse caso, informe a razão social completa para a nota fiscal.`;
    }
    if (/seguro informar dados/i.test(message)) {
      return `Sim, totalmente seguro. Seus dados são criptografados e usados exclusivamente para processar este pedido. Não compartilhamos com terceiros. Pode informar seu nome completo?`;
    }
    if (/v[aã]o me mandar spam/i.test(message)) {
      return `Não enviamos spam. O email é usado apenas para confirmação do pedido e rastreio da entrega. Qual o seu melhor email?`;
    }
    if (/posso usar outro e-?mail/i.test(message)) {
      return `Claro! Pode informar qualquer email que tenha acesso. Usaremos apenas para enviar a confirmação do pedido.`;
    }
    if (/enviam a nota por e-?mail/i.test(message)) {
      return `Sim, a nota fiscal é enviada automaticamente para o email informado após a confirmação do pagamento. Qual o seu email?`;
    }
    if (/reenviar c[oó]digo de e-?mail/i.test(message)) {
      return `Reenviando o código de verificação para o seu email. Aguarde alguns segundos e verifique também a pasta de spam.`;
    }
    if (/n[aã]o recebi o c[oó]digo/i.test(message)) {
      return `O código pode levar até 1 minuto para chegar. Verifique a pasta de spam ou lixo eletrônico. Se não chegar, posso reenviar.`;
    }
    if (/qual e-?mail foi usado/i.test(message)) {
      return `O código foi enviado para o email que você informou anteriormente. Se precisar usar outro email, é só me dizer.`;
    }
    if (/por que o cpf [eé] obrigat[oó]rio/i.test(message)) {
      return `O CPF é necessário para emissão da nota fiscal eletrônica, exigida por lei. Seus dados ficam protegidos e não são compartilhados.`;
    }
    if (/posso informar cnpj/i.test(message)) {
      return `Sim! Se a compra é para pessoa jurídica, pode informar o CNPJ que emitiremos a nota para a empresa.`;
    }
    if (/seguro enviar meu cpf/i.test(message)) {
      return `Sim, totalmente seguro. O CPF é transmitido com criptografia e usado apenas para a nota fiscal deste pedido.`;
    }
    if (/v[aã]o me ligar/i.test(message)) {
      return `Não ligamos. O telefone é usado apenas para enviar atualizações sobre a entrega via WhatsApp ou SMS. Qual o seu número com DDD?`;
    }
    if (/rastreio por whatsapp/i.test(message)) {
      return `Sim! Enviamos o código de rastreio e atualizações de entrega pelo WhatsApp. Qual o seu número com DDD?`;
    }
    if (/pode ser telefone fixo/i.test(message)) {
      return `Recomendamos um celular para receber o rastreio por WhatsApp, mas pode informar fixo se preferir. Qual o número com DDD?`;
    }
    if (/reenviar c[oó]digo sms/i.test(message)) {
      return `Reenviando o código SMS para o seu celular. Aguarde alguns segundos.`;
    }
    if (/n[aã]o recebi o sms/i.test(message)) {
      return `O SMS pode levar até 2 minutos. Verifique se o número está correto e se o celular tem sinal. Posso reenviar se precisar.`;
    }
    if (/posso usar outro n[uú]mero/i.test(message)) {
      return `Claro! Informe o novo número com DDD que enviarei o código para ele.`;
    }
  }

  // --- Shipping stage quick replies ---
  if (stage === "shipping") {
    const isNoNumberOrComplementReply = normalize(message).includes("nao tem") || /minha casa n[aÃ£]o tem n[uÃº]mero/i.test(message);
    if (isNoNumberOrComplementReply && !(nextField.includes("numero") || nextField.includes("complemento"))) return null;
    if (/como calculo o frete/i.test(message)) {
      return `O frete é calculado automaticamente pelo CEP de entrega. Basta informar os 8 dígitos do seu CEP que mostro as opções disponíveis com preço e prazo.`;
    }
    if (/entregam em todo o brasil/i.test(message)) {
      return `Sim, entregamos para todo o Brasil via Correios (PAC e Sedex). O prazo varia conforme a região. Informe seu CEP para ver as opções.`;
    }
    if (/n[aã]o sei meu cep/i.test(message)) {
      return `Você pode consultar seu CEP no site dos Correios (buscacep.correios.com.br) usando o nome da rua e cidade. Quando encontrar, me envie aqui.`;
    }
    if (/cep est[aá] correto/i.test(message)) {
      return `Perfeito, endereço confirmado! Agora preciso do número do imóvel para finalizar o cálculo do frete.`;
    }
    if (/n[aã]o encontram meu endere[cç]o/i.test(message)) {
      return `Pode ser que o CEP esteja incorreto ou seja muito novo. Tente conferir no site dos Correios ou informe outro CEP próximo.`;
    }
    if (/qual o problema com o cep/i.test(message)) {
      return `Alguns CEPs novos ainda não estão na base dos Correios. Confira se digitou corretamente os 8 dígitos ou tente um CEP alternativo da mesma região.`;
    }
    if (/n[aã]o tem|minha casa n[aã]o tem n[uú]mero/i.test(message)) {
      return `Sem problema! Registrei como "S/N" (sem número). Há algum complemento como bloco, casa ou referência?`;
    }
    if (/como informo o bloco/i.test(message)) {
      return `Pode informar no formato: "Bloco B, Apto 302" ou "Casa 5". Se não houver complemento, diga "não tem".`;
    }
    if (/moro em zona rural/i.test(message)) {
      return `Para zona rural, informe o CEP da cidade mais próxima e adicione uma referência no complemento (ex: "Sítio São João, Estrada Municipal km 5").`;
    }
    if (/tem frete gr[aá]tis/i.test(message)) {
      return `O frete é calculado com base no CEP e peso do pedido. Não posso garantir frete grátis, mas vou mostrar as melhores opções disponíveis. Selecione uma das opções de frete acima.`;
    }
    if (/prazo est[aá] muito longo/i.test(message)) {
      return `Entendo! O Sedex é a opção mais rápida disponível. Os prazos são estimativas dos Correios e geralmente chegam antes. Selecione a opção que preferir.`;
    }
    if (/tem transportadora mais r[aá]pida/i.test(message)) {
      return `No momento trabalhamos com Correios (PAC e Sedex). O Sedex é a opção expressa com menor prazo. Selecione a opção que preferir acima.`;
    }
    if (/qual o prazo m[eé]dio/i.test(message)) {
      return `O prazo varia por região: PAC de 5 a 12 dias úteis, Sedex de 2 a 5 dias úteis. Selecione a opção que preferir.`;
    }
    if (/tem op[cç][aã]o de retirada/i.test(message)) {
      return `No momento não temos opção de retirada em loja. A entrega é feita pelos Correios no endereço informado.`;
    }
    if (/como acompanho o pedido/i.test(message)) {
      return `Após o envio, você receberá o código de rastreio por email e WhatsApp para acompanhar em tempo real no site dos Correios.`;
    }
  }

  // --- Payment stage quick replies ---
  if (stage === "payment") {
    if (/obrigad[oa]/i.test(message)) {
      return `Por nada! Foi um prazer ajudar. Seu pedido está confirmado e você receberá os detalhes por email. Boas compras!`;
    }
  }

  return null;
}

function stageMessageForField(field: string | undefined, merchantName?: string, agentName?: string): string {
  const greetingTail = merchantName ? ` da ${merchantName}` : "";
  switch (field) {
    case "nome":
      return `Olá! Sou ${agentName ?? "o assistente"}${greetingTail}. Antes de continuar, posso saber seu nome completo?`;
    case "email":
      return "Perfeito. Qual o seu melhor email para o pedido?";
    case "código de verificação":
      return "Enviei um código de 6 dígitos para o seu email. Pode digitá-lo aqui?";
    case "CPF":
      return "Obrigado. Pode me informar o CPF para emitir a nota?";
    case "telefone":
      return "Anotado. Qual o telefone com DDD para acompanharmos a entrega?";
    case "código de verificação do celular":
      return "Enviei um SMS de confirmação para o seu celular. Pode me informar o código recebido?";
    case "CEP":
      return "Para calcular o frete, pode informar o CEP da entrega?";
    case "confirmar endereço":
      return "Localizei o seu endereço. Está correto?";
    default:
      return "Para começar, posso saber seu nome completo?";
  }
}
