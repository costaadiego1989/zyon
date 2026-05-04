import type {
  AgentContext,
  Cart,
  CheckoutExperienceSnapshot,
  CheckoutItemSnapshot,
  CheckoutSession,
  CurrencyCode,
  CustomerHints,
  MerchantTheme,
  ShippingQuote
} from "@aacp/shared-types";
import { DEFAULT_MERCHANT_THEME } from "@aacp/shared-types";

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
}

export function buildCheckoutExperience(
  input: ExperienceInputs,
  deps: ExperienceDeps
): CheckoutExperienceSnapshot {
  const merchantName = deps.merchantName ?? input.merchant_id;
  const theme = deps.theme ?? DEFAULT_MERCHANT_THEME;
  const items = input.cart.items.map(toItemSnapshot);
  const shipping = input.shipping?.customerPrice ?? 0;
  const discount = input.cart.currentDiscount ?? 0;
  const subtotal = input.cart.total;
  const total = Math.max(0, roundMoney(subtotal + shipping - discount));
  const agentIdentity = deps.agent?.agent;
  const agentName = agentIdentity?.agentName ?? "Assistente AACP";
  const greeting =
    agentIdentity?.greeting ??
    `Olá, sou o assistente da ${merchantName}. Posso te ajudar a finalizar este pedido.`;

  return {
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
      trust_badges: [
        "IA respeita políticas comerciais da loja",
        "Frete, cupom e pagamento validados pela API",
        "Resumo do pedido sincronizado com a sessão"
      ],
      quick_replies: [
        "Tenho dúvida sobre o frete",
        "Existe algum cupom disponível?",
        "Quero finalizar agora"
      ]
    }
  };
}

export function buildExperienceFromSession(
  session: CheckoutSession,
  deps: ExperienceDeps
): CheckoutExperienceSnapshot {
  return buildCheckoutExperience(
    {
      merchant_id: session.merchantId,
      cart: session.cart,
      customer: session.customer,
      shipping: session.shipping
    },
    deps
  );
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
