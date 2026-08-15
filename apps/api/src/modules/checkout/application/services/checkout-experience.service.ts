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
  ShippingQuote,
  SuggestedProduct
} from "@zyon/shared-types";
import { DEFAULT_MERCHANT_THEME } from "@zyon/shared-types";
import { deriveChatStage, missingFieldsForStage } from "../../domain/services/customer-extraction.service.js";
import type { MerchantRules } from "@zyon/shared-types";

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
  /**
   * Platform service fee in BRL. Resolved from the injected
   * `CheckoutExperienceConfig.platformFeeBrl` by the caller; defaults to 1.99
   * to preserve the prior `process.env.PLATFORM_FEE_BRL` fallback.
   */
  serviceFee?: number;
  suggestedProducts?: SuggestedProduct[];
  showBranding?: boolean;
}

export interface CartSnapshot {
  items: Array<{ name: string; quantity: number }>;
  total: number;
  couponCode?: string | null;
}

export function quickRepliesForStage(
  stage: ChatStage,
  missingFields: string[] = [],
  rules?: MerchantRules,
  cart?: CartSnapshot
): string[] {
  const next = missingFields[0];
  if (next === "confirmar endereço") {
    return ["Sim", "Não"];
  }
  let customReplies: string[] | undefined;

  if (stage === "data_collection") {
    // Empty cart: show product discovery actions
    if (cart?.items.length === 0) {
      return ["Ver produtos", "Buscar por categoria", "Quais as promoções?"];
    }
    const dRules = rules?.quickReplies?.data_collection;
    if (next === "nome") customReplies = dRules?.nome;
    else if (next === "email") customReplies = dRules?.email;
    else if (next === "CPF") customReplies = dRules?.CPF;
    else if (next === "telefone") customReplies = dRules?.telefone;
    if (!customReplies?.length) customReplies = dRules?.default;
  } else if (stage === "shipping") {
    // Cart-aware: show carrier options as quick replies when frete stage is ready
    if (next === "frete" && cart?.items.length) {
      // Carrier options will be provided separately via shippingOptionReplies
      return ["Tem frete grátis?", "O prazo está muito longo", "Tem transportadora mais rápida?"];
    }
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
        return ["Vocês vão me ligar?", "Mandam rastreio por WhatsApp?", "Por que precisa ser celular?"];
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
      if (rules?.cryptoPayments?.enabled) {
        base.push("Pagar com crypto");
      }
      const cartAwareReplies: string[] = [];
      // Add quantity modification option if any item has qty > 1
      if (cart?.items.some(item => item.quantity > 1)) {
        cartAwareReplies.push("Quero alterar quantidade");
      }
      // Add item removal option if cart has 2+ items
      if (cart && cart.items.length >= 2) {
        cartAwareReplies.push("Remover item");
      }
      // Filter out coupon mention if not applicable or already applied
      const couponReplies: string[] = [];
      if (rules?.couponBoxEnabled !== false && (rules?.maxDiscountPercent ?? 0) > 0 && !cart?.couponCode) {
        couponReplies.push("Tenho um cupom de desconto");
      }
      return [...couponReplies, ...base, ...cartAwareReplies];
    }
    case "completed":
      return ["Obrigado!", "Quero acompanhar o pedido", "Voltar à loja"];
    default:
      return ["Ok"];
  }
}

function readPlatformServiceFee(deps: ExperienceDeps): number {
  if (typeof deps.serviceFee === "number" && Number.isFinite(deps.serviceFee) && deps.serviceFee >= 0) {
    return deps.serviceFee;
  }
  return 1.99;
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
  const serviceFee = readPlatformServiceFee(deps);
  const agentIdentity = deps.agent?.agent;
  const agentName = agentIdentity?.agentName ?? "Assistente AACP";
  const cartEmpty = input.cart.items.length === 0;
  const greeting = cartEmpty
    ? "O que você deseja comprar? Digite aqui que encontro para você."
    : (agentIdentity?.greeting ?? "Ola, tudo bem? Sou o seu assistente virtual e vou guiar seu checkout com seguranca.");

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

  // Build cart snapshot for cart-aware quick replies
  const cartSnapshot: CartSnapshot = {
    items: input.cart.items.map(item => ({ name: item.name, quantity: item.quantity })),
    total: subtotal,
    couponCode: (input.cart as any).couponCode ?? null
  };

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
    rules: {
      couponBoxEnabled: deps.couponBoxEnabled ?? true,
      cryptoPaymentsEnabled: deps.rules?.cryptoPayments?.enabled === true,
      cryptoPayments: deps.rules?.cryptoPayments,
      showBranding: deps.showBranding ?? false,
    },
    policies: deps.rules?.policies,
    items,
    totals: {
      currency: input.cart.currency,
      subtotal: roundMoney(subtotal),
      shipping: roundMoney(shipping),
      discount: roundMoney(discount),
      service_fee: serviceFee,
      total
    },
    shipping: input.shipping,
    shippingOptions: undefined,
    suggestedProducts: deps.suggestedProducts?.length ? deps.suggestedProducts : undefined,
    customer: publicCustomerHints(input.customer),
    agent: {
      name: agentName,
      greeting,
      tone: agentIdentity?.tone ?? "consultative",
      language: agentIdentity?.language ?? "pt-BR"
    },
    copy: {
      headline: `${merchantName}: finalize sua compra com ajuda da IA`,
      subheadline: `${items.length} item(ns) no pedido, total ${formatMoney(total, input.cart.currency)} com contexto real do carrinho.`,
      trust_badges: [],
      quick_replies: quickRepliesForStage(chatStage, deps.missingFieldsPreview ?? [], deps.rules, cartSnapshot),
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
  const readyForFrete = missingFieldsPreview[0] === "frete";
  return {
    ...experience,
    shippingOptions: readyForFrete ? session.shippingOptions : undefined,
    copy: shippingOptionReplies
      ? { ...experience.copy, quick_replies: shippingOptionReplies }
      : experience.copy
  };
}

function publicCustomerHints(customer: CustomerHints | undefined): CustomerHints | undefined {
  if (!customer) return undefined;
  const { otp_code: _otpCode, phone_otp_code: _phoneOtpCode, ...safe } = customer;
  return safe;
}

function shippingOptionLabel(option: ShippingQuote): string {
  const carrier = option.carrier?.trim();
  const method = option.method?.trim();
  const methodLabel = carrier && method && !method.toLowerCase().includes(carrier.toLowerCase())
    ? `${carrier} ${method}`
    : method ?? carrier ?? "Frete";
  const price = formatMoney(option.customerPrice, "BRL");
  const eta = typeof option.deliveryDays === "number" ? ` (${option.deliveryDays} dias)` : "";
  return `${methodLabel}${eta} - ${price}`;
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
    variant: item.variant,
    description: item.description?.slice(0, 100)
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: number, currency: CurrencyCode): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(value);
}
