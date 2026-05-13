import type {
  AgentContext,
  Cart,
  ChatStage,
  CheckoutExperienceSnapshot,
  CheckoutItemSnapshot,
  CheckoutSession,
  CurrencyCode,
  CustomerHints,
  MerchantTheme,
  ShippingQuote
} from "@aacp/shared-types";
import { DEFAULT_MERCHANT_THEME } from "@aacp/shared-types";
import { deriveChatStage, missingFieldsForStage } from "../../domain/services/customer-extraction.service.js";
import type { MerchantRules } from "@aacp/shared-types";

export interface ExperienceInputs {
  merchant_id: string;
  cart: Cart;
  customer?: CustomerHints;
  shipping?: ShippingQuote;
}

export interface ExperienceDeps {
  merchantName?: string;
  theme?: MerchantTheme;
  agent?: AgentContext;
  couponBoxEnabled?: boolean;
  chatStage?: ChatStage;
  missingFieldsPreview?: string[];
  rules?: MerchantRules;
}

export function quickRepliesForStage(stage: ChatStage, missingFields: string[] = [], rules?: MerchantRules): string[] {
  const next = missingFields[0];
  if (next === "confirmar endereço") {
    return ["Sim", "Não"];
  }
  let customReplies: string[] | undefined;

  if (stage === "data_collection") {
    const dRules = rules?.quickReplies?.data_collection;
    if (next === "nome") customReplies = dRules?.nome;
    else if (next === "email") customReplies = dRules?.email;
    else if (next === "CPF") customReplies = dRules?.CPF;
    else if (next === "telefone") customReplies = dRules?.telefone;
    if (!customReplies?.length) customReplies = dRules?.default;
  } else if (stage === "shipping") {
    const sRules = rules?.quickReplies?.shipping;
    if (next === "CEP") customReplies = sRules?.CEP;
    else if (next?.includes("confirmar")) customReplies = sRules?.confirmar;
    else if (next?.includes("número") || next?.includes("complemento")) customReplies = sRules?.numero_complemento;
    else if (next === "frete") customReplies = sRules?.frete;
    if (!customReplies?.length) customReplies = sRules?.default;
  } else if (stage === "payment") {
    customReplies = rules?.quickReplies?.payment;
  } else if (stage === "completed") {
    customReplies = rules?.quickReplies?.completed;
  }

  if (customReplies && customReplies.length > 0) {
    if (stage === "payment" && (!rules?.couponBoxEnabled || rules?.maxDiscountPercent === 0)) {
      return customReplies.filter(r => !/cupom/i.test(r));
    }
    return customReplies;
  }

  switch (stage) {
    case "data_collection":
      if (next === "nome")
        return ["Por que precisa do meu nome?", "Posso usar nome de empresa?", "É seguro informar dados aqui?"];
      if (next === "email")
        return ["Vão me mandar SPAM?", "Posso usar outro e-mail?", "Vocês enviam a nota por e-mail?"];
      if (next === "código de verificação")
        return ["Reenviar código de e-mail", "Não recebi o código", "Qual e-mail foi usado?"];
      if (next === "código de verificação do celular")
        return ["Reenviar código SMS", "Não recebi o SMS", "Posso usar outro número?"];
      if (next === "CPF")
        return ["Por que o CPF é obrigatório?", "Posso informar CNPJ?", "É seguro enviar meu CPF?"];
      if (next === "telefone")
        return ["Vocês vão me ligar?", "Mandam rastreio por WhatsApp?", "Pode ser telefone fixo?"];
      return ["Precisa de mais algum dado?", "Como funciona a entrega?", "Quais as formas de pagamento?"];
    case "shipping":
      if (next === "CEP")
        return [
          "Como calculo o frete?",
          "Entregam em todo o Brasil?",
          "Não sei meu CEP, como faço?"
        ];
      if (next?.includes("confirmar"))
        return ["O CEP está correto", "Não encontram meu endereço", "Qual o problema com o CEP?"];
      if (next?.includes("complemento"))
        return ["Não tem", "Como informo o bloco?", "Moro em zona rural"];
      if (next?.includes("número"))
        return ["Minha casa não tem número", "Como informo o bloco?", "Moro em zona rural"];
      if (next === "frete")
        return ["Tem frete grátis?", "O prazo está muito longo", "Tem transportadora mais rápida?"];
      return ["Qual o prazo médio?", "Tem opção de retirada?", "Como acompanho o pedido?"];
    case "payment": {
      const base = ["Cartão de crédito", "Cartão de débito", "PIX", "Boleto"];
      if (rules?.couponBoxEnabled !== false && (rules?.maxDiscountPercent ?? 0) > 0) {
        return ["Tenho um cupom de desconto", ...base];
      }
      return base;
    }
    case "completed":
      return ["Obrigado!"];
    default:
      return ["Ok"];
  }
}

export function buildCheckoutExperience(input: ExperienceInputs, deps: ExperienceDeps): CheckoutExperienceSnapshot {
  const merchantName = deps.merchantName ?? input.merchant_id;
  const theme = deps.theme ?? DEFAULT_MERCHANT_THEME;
  const chatStage = deps.chatStage ?? "data_collection";
  const items = input.cart.items.map(toItemSnapshot);
  // Only include shipping cost when a method has been explicitly selected (session.shipping exists)
  const shipping = input.shipping ? input.shipping.customerPrice : 0;
  const discount = input.cart.currentDiscount ?? 0;
  const subtotal = input.cart.total;
  const total = Math.max(0, roundMoney(subtotal + shipping - discount));
  const agentIdentity = deps.agent?.agent;
  const agentName = agentIdentity?.agentName ?? "Assistente AACP";
  const baseGreeting =
    agentIdentity?.greeting ??
    "Olá, tudo bem? Seja muito bem-vindo! Sou o seu assistente virtual e vou te guiar em todo o processo do seu checkout com total segurança e agilidade.";
  const maxDiscount = deps.rules?.maxDiscountPercent ?? 0;
  const greeting =
    maxDiscount > 0 && !baseGreeting.match(/\d+\s*%/)
      ? `${baseGreeting} Tenho até ${maxDiscount}% de desconto disponível para você fechar hoje.`
      : baseGreeting;

  const trustCadastro = chatStage === "data_collection";

  let expected_input_type: "text" | "email" | "tel" | "number" = "text";
  if (chatStage === "data_collection") {
    const next = deps.missingFieldsPreview?.[0];
    if (next === "email") expected_input_type = "email";
    if (next === "telefone") expected_input_type = "tel";
    if (next === "CPF") expected_input_type = "number";
  } if (chatStage === "shipping") {
    const next = deps.missingFieldsPreview?.[0];
    if (next === "CEP" || next?.includes("número")) expected_input_type = "number";
  }

  return {
    stage: chatStage,
    brand: {
      merchant_id: input.merchant_id,
      name: merchantName,
      subtitle: "Checkout assistido por IA",
      support_label: "Compra guiada",
      logo_url: theme.logoUrl,
      accent_color: theme.accentColor,
      theme
    },
    rules: { couponBoxEnabled: deps.couponBoxEnabled ?? true },
    items,
    totals: {
      currency: input.cart.currency,
      subtotal: roundMoney(subtotal),
      shipping: roundMoney(shipping),
      discount: roundMoney(discount),
      total
    },
    shipping: input.shipping,
    shippingOptions: undefined,
    customer: input.customer,
    agent: {
      name: agentName,
      greeting,
      tone: agentIdentity?.tone ?? "consultative",
      language: agentIdentity?.language ?? "pt-BR"
    },
    copy: {
      headline: `${merchantName}: finalize sua compra com ajuda da IA`,
      subheadline: `${items.length} item(ns) no pedido, total ${formatMoney(total, input.cart.currency)} com contexto real do carrinho.`,
      trust_badges: trustCadastro
        ? [
          "Dados apenas para esta compra",
          "Códigos e benefícios comerciais na etapa final",
          "Frete confirmado antes do pagamento"
        ]
        : [
          "IA respeita políticas comerciais da loja",
          "Frete e cupom validados pela API",
          "Resumo do pedido sincronizado"
        ],
      quick_replies: quickRepliesForStage(chatStage, deps.missingFieldsPreview ?? [], deps.rules),
      focus_input: chatStage !== "completed",
      expected_input_type
    }
  };
}

export function buildExperienceFromSession(session: CheckoutSession, deps: ExperienceDeps): CheckoutExperienceSnapshot {
  const chatStage = deriveChatStage(session);
  const missingFieldsPreview = missingFieldsForStage(session, chatStage);
  const experience = buildCheckoutExperience(
    {
      merchant_id: session.merchantId,
      cart: session.cart,
      customer: session.customer,
      shipping: session.shipping
    },
    { ...deps, chatStage, missingFieldsPreview }
  );
  const shippingOptionReplies =
    chatStage === "shipping" && missingFieldsPreview[0] === "frete" && session.shippingOptions?.length
      ? session.shippingOptions.map(shippingOptionLabel)
      : undefined;
  return {
    ...experience,
    shippingOptions: session.shippingOptions,
    copy: shippingOptionReplies
      ? { ...experience.copy, quick_replies: shippingOptionReplies }
      : experience.copy
  };
}

function shippingOptionLabel(option: ShippingQuote): string {
  const method = option.method ?? option.carrier ?? "Frete";
  const price = formatMoney(option.customerPrice, "BRL");
  const eta = typeof option.deliveryDays === "number" ? ` (${option.deliveryDays} dias)` : "";
  return `${method}${eta} - ${price}`;
}

function toItemSnapshot(item: Cart["items"][number]): CheckoutItemSnapshot {
  return {
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unit_price: roundMoney(item.price),
    line_total: roundMoney(item.price * item.quantity),
    image_url: item.imageUrl,
    product_url: item.productUrl,
    category: item.category,
    variant: item.variant
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: number, currency: CurrencyCode): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}
