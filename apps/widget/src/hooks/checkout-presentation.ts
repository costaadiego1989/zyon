import type {
  Cart,
  ChatAction,
  CheckoutEventName,
  CheckoutExperienceSnapshot,
  CustomerHints,
  MerchantTheme,
  ShippingQuote,
  SuggestedProduct
} from "@aacp/shared-types";
import { DEFAULT_MERCHANT_THEME } from "@aacp/shared-types";
import type { WidgetConfig } from "../lib/widget-types.js";

export type VisibleCartState = {
  items: CheckoutExperienceSnapshot["items"];
  totals: CheckoutExperienceSnapshot["totals"];
};

export interface QuickReplyChoice {
  label: string;
  event?: CheckoutEventName;
  type?: ChatAction["type"];
  offerId?: string;
}

export const COUPON_PROMPT_MESSAGE =
  "Digite o código do cupom para eu aplicar antes de liberar o pagamento.";
export const COUPON_ENTRY_MESSAGE =
  "Insira o código do seu cupom abaixo para aplicar o desconto.";
export const COUPON_SKIP_REPLY_LABEL = "Continuar sem cupom";

export const STAGE_FLOW = [
  { key: "data_collection", label: "Cadastro", shortLabel: "Cadastro" },
  { key: "shipping", label: "Entrega", shortLabel: "Entrega" },
  { key: "payment", label: "Pagamento", shortLabel: "Pagamento" },
  { key: "completed", label: "Concluído", shortLabel: "Concluído" }
] as const;

export const CART_JOURNEY = [
  { key: "items", label: "Itens no carrinho", shortLabel: "Carrinho", hint: "Produtos selecionados" },
  { key: "identity", label: "Seus dados", shortLabel: "Dados", hint: "Nome, e-mail e contato" },
  { key: "delivery", label: "Entrega", shortLabel: "Frete", hint: "CEP e opção de envio" },
  { key: "payment", label: "Fechar compra", shortLabel: "Pagamento", hint: "PIX ou cartão seguro" }
] as const;

export function resolveCartJourneyIndex(checkoutStage: string, itemCount: number): number {
  if (checkoutStage === "completed") return CART_JOURNEY.length - 1;
  if (checkoutStage === "payment") return 3;
  if (checkoutStage === "shipping") return 2;
  if (checkoutStage === "data_collection") return itemCount > 0 ? 1 : 0;
  return 0;
}

/** Fill % on the stepper rail to the center of the active step (full at last step). */
export function resolveStepperProgressPct(activeIndex: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  if (stepCount === 1) return 100;
  const clamped = Math.max(0, Math.min(activeIndex, stepCount - 1));
  if (clamped === stepCount - 1) return 100;
  return ((clamped + 0.5) / stepCount) * 100;
}

export function resolveStoreReturnUrl(
  config?: Pick<WidgetConfig, "storeUrl" | "emptyCartRedirectUrl" | "cart">
): string | undefined {
  if (!config) return undefined;
  if (config.storeUrl?.trim()) return config.storeUrl.trim();
  if (config.emptyCartRedirectUrl?.trim()) return config.emptyCartRedirectUrl.trim();
  const productUrl = config.cart?.items?.[0]?.productUrl?.trim();
  if (!productUrl) return undefined;
  try {
    return new URL(productUrl).origin;
  } catch {
    return undefined;
  }
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

export function brandInitials(name: string, max = 2): string {
  const parts = name
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "AC";
  if (parts.length === 1) return parts[0].slice(0, max).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function themeStyle(
  theme: MerchantTheme,
  isForcedMode = false,
  colorMode: "light" | "dark" = "light",
  skin: "default" | "pulse" = "default"
): React.CSSProperties {
  const merged: MerchantTheme = {
    ...DEFAULT_MERCHANT_THEME,
    ...(theme ?? {})
  };
  const isDark = colorMode === "dark";
  const accent = merged.accentColor || "#0F766E";
  const secondary = merged.secondaryColor ?? "#1E40AF";
  const surface = isDark ? "#111827" : (merged.surfaceColor ?? "#FFFFFF");
  const elevated = isDark ? "#0F172A" : (merged.surfaceElevatedColor ?? "#F8FAFC");
  const border = isDark ? "rgba(241, 245, 249, 0.14)" : (merged.borderColor ?? "#D9E2EC");
  const text = isDark ? "#F1F5F9" : (merged.textColor ?? "#111827");
  const muted = isDark ? "#94A3B8" : (merged.mutedTextColor ?? "#64748B");
  const background = isDark ? "#0B1220" : (merged.backgroundColor ?? "#F7F8FA");
  const radius = `${merged.borderRadius ?? 12}px`;
  const density = merged.density ?? "comfortable";
  const hasBackgroundImage = typeof merged.backgroundImageUrl === "string" && merged.backgroundImageUrl.startsWith("https://");

  const styles: Record<string, string> = {
    "--aacp-accent": accent,
    "--aacp-accent-2": secondary,
    "--aacp-accent-strong": accent,
    "--aacp-fg": text,
    "--aacp-bg": background,
    "--aacp-surface": surface,
    "--aacp-surface-2": elevated,
    "--aacp-surface-3": elevated,
    "--aacp-muted": muted,
    "--aacp-faint": `${muted}B3`,
    "--aacp-line": `${border}99`,
    "--aacp-line-strong": border,
    "--aacp-success": merged.successColor ?? "#047857",
    "--aacp-warning": merged.warningColor ?? "#B45309",
    "--aacp-font": merged.fontFamily,
    "--aacp-font-display": merged.fontDisplay ?? merged.fontFamily,
    "--aacp-radius": radius,
    "--aacp-density-scale": density === "compact" ? "0.88" : density === "spacious" ? "1.08" : "1",
    "--aacp-grad-primary": `linear-gradient(135deg, ${accent} 0%, ${secondary} 100%)`,
    "--aacp-grad-soft": `linear-gradient(135deg, ${accent}14, ${secondary}0f)`,
    "--aacp-grad-bubble-buyer": `linear-gradient(135deg, ${accent} 0%, ${secondary} 100%)`,
    "--aacp-grad-glow": `radial-gradient(60% 60% at 50% 0%, ${accent}18, transparent 70%)`,
    "--aacp-glow": `0 0 40px ${accent}33`,
    "--aacp-shadow-sm": isDark ? "0 1px 2px rgba(0, 0, 0, 0.35)" : "0 1px 2px rgba(15, 23, 42, 0.06)",
    "--aacp-shadow-md": isDark ? "0 8px 24px rgba(0, 0, 0, 0.4)" : "0 8px 24px rgba(15, 23, 42, 0.08)",
    "--aacp-shadow-lg": isDark ? "0 24px 64px rgba(0, 0, 0, 0.45)" : "0 24px 64px rgba(15, 23, 42, 0.12)",
    "--aacp-shell-bg": surface,
    "--aacp-shell-border": border,
    "--aacp-radius-sm": `calc(${radius} - 4px)`,
    "--aacp-radius-md": radius,
    "--aacp-radius-lg": `calc(${radius} + 4px)`,
    "--aacp-radius-pill": `calc(${radius} + 10px)`,
    "--aacp-accent-ring": `color-mix(in srgb, ${accent} 14%, transparent)`,
    "--aacp-accent-border": `color-mix(in srgb, ${accent} 32%, transparent)`,
    "--aacp-accent-hover-bg": `color-mix(in srgb, ${accent} 7%, ${surface})`,
    "--aacp-accent-hover-border": `color-mix(in srgb, ${accent} 42%, ${border})`,
    "--aacp-accent-shadow": `color-mix(in srgb, ${accent} 26%, transparent)`,
    "--aacp-accent-shadow-strong": `color-mix(in srgb, ${accent} 38%, transparent)`,
    "--aacp-panel-bg": elevated,
    "--aacp-inset-bg": `color-mix(in srgb, ${text} 3%, ${surface})`,
  };

  if (hasBackgroundImage && merged.backgroundImageUrl) {
    styles["--aacp-bg-image"] = `url("${merged.backgroundImageUrl.replace(/"/g, "%22")}")`;
  }

  if (isForcedMode) {
    styles["--aacp-shell-bg"] = isDark
      ? `linear-gradient(180deg, ${surface}f2, ${elevated}f2)`
      : `linear-gradient(180deg, ${surface}f2, ${elevated}f2)`;
  }

  if (skin === "pulse") {
    applyPulseTokens(styles, isDark);
  }

  return styles as unknown as React.CSSProperties;
}

/**
 * Pulse skin tokens, emitted inline so they override the stylesheet defaults
 * (inline custom properties win the cascade against any rule). Faithful to
 * packages/Pulse Agentic Checkout Copy/Pulse Widget.dc.html.
 */
function applyPulseTokens(styles: Record<string, string>, isDark: boolean): void {
  const g1 = isDark ? "#8b5cf6" : "#7c3aed";
  const g2 = isDark ? "#2dd4ff" : "#0891b2";
  const g3 = isDark ? "#ff5cc8" : "#db2777";

  const bg = isDark ? "#08080c" : "#e7e5df";
  const surface = isDark ? "#0f0f16" : "#ffffff";
  const surface2 = isDark ? "rgba(255,255,255,0.05)" : "#f6f5f2";
  const surface3 = isDark ? "rgba(255,255,255,0.08)" : "#efeee9";
  const fg = isDark ? "#f5f5f7" : "#141418";
  const muted = isDark ? "#8b8b95" : "#71717a";
  const faint = isDark ? "#6c6a72" : "#9a978e";
  const line = isDark ? "rgba(255,255,255,0.1)" : "rgba(15,15,25,0.09)";
  const lineStrong = isDark ? "rgba(255,255,255,0.12)" : "rgba(15,15,25,0.1)";

  Object.assign(styles, {
    "--pulse-g1": g1,
    "--pulse-g2": g2,
    "--pulse-g3": g3,

    "--aacp-font": "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    "--aacp-font-display": "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    "--aacp-font-mono": "'Space Mono', ui-monospace, monospace",

    "--aacp-radius": "16px",
    "--aacp-radius-sm": "10px",
    "--aacp-radius-md": "14px",
    "--aacp-radius-lg": "20px",
    "--aacp-radius-pill": "999px",

    "--aacp-bg": bg,
    "--aacp-surface": surface,
    "--aacp-surface-2": surface2,
    "--aacp-surface-3": surface3,
    "--aacp-fg": fg,
    "--aacp-muted": muted,
    "--aacp-faint": faint,
    "--aacp-line": line,
    "--aacp-line-strong": lineStrong,
    "--aacp-success": isDark ? "#34d399" : "#10b981",
    "--aacp-warning": isDark ? "#fbbf24" : "#b45309",

    "--aacp-accent": g1,
    "--aacp-accent-2": g2,
    "--aacp-accent-strong": g1,

    "--aacp-grad-primary": `linear-gradient(95deg, ${g1}, ${g2}, ${g3})`,
    "--aacp-grad-bubble-buyer": `linear-gradient(95deg, ${g1}, ${g2})`,
    "--aacp-grad-soft": `linear-gradient(135deg, ${g1}24, ${g2}1a)`,
    "--aacp-grad-glow": `radial-gradient(60% 60% at 50% 0%, ${g1}38, transparent 70%)`,
    "--aacp-glow": `0 0 44px ${g2}4d`,

    "--aacp-panel-bg": surface,
    "--aacp-inset-bg": surface2,
    "--aacp-shell-bg": bg,
    "--aacp-shell-border": line,
    "--aacp-shadow-sm": isDark ? "0 1px 2px rgba(0,0,0,0.4)" : "0 1px 2px rgba(40,30,80,0.08)",
    "--aacp-shadow-md": isDark ? "0 8px 24px rgba(0,0,0,0.5)" : "0 8px 24px rgba(40,30,80,0.12)",
    "--aacp-shadow-lg": isDark ? "0 34px 70px -28px rgba(0,0,0,0.75)" : "0 34px 70px -30px rgba(40,30,80,0.28)",

    "--continuum-font-interface": "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    "--continuum-font-editorial": "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    "--continuum-font-operational": "'Space Mono', ui-monospace, monospace",
  });
}

export function buildVisibleCart(experience: CheckoutExperienceSnapshot): VisibleCartState {
  return {
    items: experience.items.map((item) => ({ ...item })),
    totals: { ...experience.totals }
  };
}

export function stageNarrative(stage: string, missingField?: string): string {
  if (stage === "completed") return "Pedido finalizado";
  if (stage === "payment") return "Aguardando pagamento";
  if (stage === "shipping") return "Calculando frete";
  if (missingField === "customer.fullName") return "Nome do cliente";
  if (missingField === "customer.email") return "E-mail de contato";
  if (missingField === "customer.phone") return "Telefone";
  if (missingField === "shipping.address.zipCode") return "CEP de entrega";
  return "Coleta de dados";
}

export function stageLabel(stage: string): string {
  const step = STAGE_FLOW.find((s) => s.key === stage);
  return step?.label ?? "Checkout";
}

export function countVisibleItems(items: Array<{ quantity: number }>): number {
  return items.reduce((acc, it) => acc + it.quantity, 0);
}

export function removeVisibleCartItem(current: VisibleCartState, sku: string): VisibleCartState {
  const nextItems = current.items.filter((it) => it.sku !== sku);
  const nextSubtotal = nextItems.reduce((acc, it) => acc + it.line_total, 0);
  return {
    items: nextItems,
    totals: {
      ...current.totals,
      subtotal: nextSubtotal,
      total: Math.max(0, nextSubtotal + current.totals.shipping - current.totals.discount)
    }
  };
}

export function incrementVisibleCartItem(current: VisibleCartState, sku: string): VisibleCartState {
  const nextItems = current.items.map((it) =>
    it.sku !== sku ? it : { ...it, quantity: it.quantity + 1, line_total: it.unit_price * (it.quantity + 1) }
  );
  const nextSubtotal = nextItems.reduce((acc, it) => acc + it.line_total, 0);
  return {
    items: nextItems,
    totals: {
      ...current.totals,
      subtotal: nextSubtotal,
      total: Math.max(0, nextSubtotal + current.totals.shipping - current.totals.discount)
    }
  };
}

export function decrementVisibleCartItem(current: VisibleCartState, sku: string): VisibleCartState {
  const item = current.items.find((it) => it.sku === sku);
  if (!item) return current;
  if (item.quantity <= 1) return removeVisibleCartItem(current, sku);
  const nextItems = current.items.map((it) =>
    it.sku !== sku ? it : { ...it, quantity: it.quantity - 1, line_total: it.unit_price * (it.quantity - 1) }
  );
  const nextSubtotal = nextItems.reduce((acc, it) => acc + it.line_total, 0);
  return {
    items: nextItems,
    totals: {
      ...current.totals,
      subtotal: nextSubtotal,
      total: Math.max(0, nextSubtotal + current.totals.shipping - current.totals.discount)
    }
  };
}

export function bubbleKey(turn: { role: string; text: string; occurredAt: string }, index: number): string {
  return `${turn.role}-${index}-${turn.occurredAt}`;
}

export function agentGivenAndRest(fullName: string): { given: string; rest: string } {
  const parts = fullName.split(" ");
  return {
    given: parts[0] || "",
    rest: parts.slice(1).join(" ")
  };
}

/** Removes legacy "AgentName: " prefixes from stored agent turns. */
export function stripAgentMessagePrefix(text: string, agentName: string): string {
  const trimmed = text.trimStart();
  const candidates = [agentName, agentGivenAndRest(agentName).given].filter(Boolean);
  for (const name of candidates) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = trimmed.match(new RegExp(`^${escaped}\\s*:\\s*`, "i"));
    if (match) return trimmed.slice(match[0].length).trimStart();
  }
  return trimmed;
}

export function agentTypingLine(agentName: string): string {
  const { given } = agentGivenAndRest(agentName);
  return `${given} está digitando...`;
}

export function quickReplyId(reply: QuickReplyChoice): string {
  return reply.label + (reply.event ?? "") + (reply.offerId ?? "");
}

const GOOGLE_FONT_WEIGHTS = "400;500;600;700;800";
export const THEME_STUDIO_FONT_OPTIONS = [
  { label: "Inter", value: "Inter, ui-sans-serif, system-ui, sans-serif" },
  { label: "Manrope", value: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif" },
  { label: "Plus Jakarta Sans", value: "\"Plus Jakarta Sans\", Inter, ui-sans-serif, system-ui, sans-serif" },
  { label: "DM Sans", value: "\"DM Sans\", Inter, ui-sans-serif, system-ui, sans-serif" },
  { label: "IBM Plex Sans", value: "\"IBM Plex Sans\", ui-sans-serif, system-ui, sans-serif" },
  { label: "Sora", value: "Sora, Inter, ui-sans-serif, system-ui, sans-serif" },
  { label: "Space Grotesk", value: "\"Space Grotesk\", Inter, ui-sans-serif, system-ui, sans-serif" },
  { label: "Outfit", value: "Outfit, Inter, ui-sans-serif, system-ui, sans-serif" },
] as const;

const GOOGLE_FONT_FAMILIES = new Set([
  "Inter", "Manrope", "Plus Jakarta Sans", "DM Sans", "Poppins",
  "Roboto", "Sora", "Space Grotesk", "Montserrat", "Outfit", "Raleway",
  "IBM Plex Sans"
]);

function extractPrimaryFontFamily(fontFamily: string): string {
  return fontFamily.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") || "";
}

export function injectGoogleFont(fontFamily: string): void {
  if (typeof document === "undefined") return;
  const family = extractPrimaryFontFamily(fontFamily);
  if (!family || !GOOGLE_FONT_FAMILIES.has(family)) return;
  const id = `aacp-font-${family.toLowerCase().replace(/\s+/g, "-")}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${GOOGLE_FONT_WEIGHTS}&display=swap`;
  document.head.appendChild(link);
}

/** Loads the exact Pulse skin type pairing: Space Grotesk + Space Mono. */
export function injectPulseFonts(): void {
  if (typeof document === "undefined") return;
  const id = "aacp-font-pulse";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap";
  document.head.appendChild(link);
}

export function fallbackExperience(config: WidgetConfig & { cart: Cart }): CheckoutExperienceSnapshot {
  // Shipping cost is always 0 until user explicitly selects a method via ShippingSelector
  const shipping = 0;
  const discount = config.cart.currentDiscount ?? 0;
  return {
    brand: {
      merchant_id: config.merchantId,
      name: config.merchantId,
      subtitle: config.copy?.headline ?? "Checkout assistido por IA",
      support_label: "Sincronizando",
      theme: DEFAULT_MERCHANT_THEME
    },
    items: config.cart.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.price,
      line_total: item.price * item.quantity,
      image_url: item.imageUrl,
      product_url: item.productUrl,
      category: item.category,
      variant: item.variant
    })),
    totals: {
      currency: config.cart.currency,
      subtotal: config.cart.total,
      shipping,
      discount,
      total: Math.max(0, config.cart.total + shipping - discount)
    },
    shipping: undefined,
    customer: config.customer,
    agent: {
      name: config.agent?.name ?? "Assistente AACP",
      greeting: config.agent?.greeting ?? "Estou conectando com a API da loja para carregar o pedido.",
      tone: (config.agent?.tone as never) ?? "consultative",
      language: config.agent?.language ?? "pt-BR"
    },
    copy: {
      headline: config.copy?.headline ?? "Checkout assistido por IA",
      subheadline: config.copy?.subheadline ?? "Carregando contexto real do pedido.",
      trust_badges: config.copy?.trust_badges ?? ["Sessão será sincronizada pela API"],
      quick_replies: config.copy?.quick_replies ?? ["Olá!", "Quero finalizar agora"],
      expected_input_type: undefined
    },
    rules: { couponBoxEnabled: true }
  };
}

export function filterSuggestedQuickReplies(
  replies: QuickReplyChoice[],
  stage: string
): QuickReplyChoice[] {
  return filterCheckoutQuickReplies(replies, {
    stage,
    prePaymentStep: stage === "payment" ? "payment_method" : undefined
  });
}

export function buildEmptyCompletedExperience(
  experience: CheckoutExperienceSnapshot,
  currency: CheckoutExperienceSnapshot["totals"]["currency"]
): CheckoutExperienceSnapshot {
  return {
    ...experience,
    stage: "completed",
    items: [],
    suggestedProducts: [],
    shipping: undefined,
    totals: {
      currency,
      subtotal: 0,
      shipping: 0,
      discount: 0,
      total: 0
    },
    copy: {
      ...experience.copy,
      quick_replies: [],
      focus_input: false
    }
  };
}

export function filterCheckoutQuickReplies(
  replies: QuickReplyChoice[],
  context: { stage: string; missingField?: string; prePaymentStep?: string; suggestedProducts?: SuggestedProduct[] }
): QuickReplyChoice[] {
  if (context.stage === "payment") {
    if (context.prePaymentStep === "cross_sell") {
      const productChips = (context.suggestedProducts ?? []).map((product) => ({
        label: `Adicionar ${product.name}`
      }));
      return [...productChips, { label: "Não agora" }, { label: "Ir para pagamento" }];
    }
    if (context.prePaymentStep === "coupon_gate") return [{ label: "Sim" }, { label: "Não" }];
    if (context.prePaymentStep === "coupon_entry") return [{ label: COUPON_SKIP_REPLY_LABEL }];
    if (context.prePaymentStep !== "payment_method") return [];
    return replies.filter((reply) => {
      const label = normalizeQuickReplyLabel(reply.label);
      return !hasCouponIntent(label) && isPaymentOrOfferLabel(label);
    });
  }

  return replies.filter((reply) => {
    const label = normalizeQuickReplyLabel(reply.label);
    if (!label) return false;
    if (isPaymentOrOfferLabel(label) || hasCouponIntent(label)) return false;
    if (context.stage === "data_collection") return !isShippingSelectionLabel(label);
    if (context.stage !== "shipping") return true;
    if (normalizeQuickReplyLabel(context.missingField) === "frete") return true;
    return !isShippingSelectionLabel(label);
  });
}

export function normalizeQuickReplyLabel(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function hasCouponIntent(value: string | undefined): boolean {
  return /\bcupom\b/.test(normalizeQuickReplyLabel(value));
}

function isPaymentOrOfferLabel(label: string): boolean {
  return /\b(pix|boleto|pagamento|pagar|finalizar|cartao|credito|debito|desconto|oferta|crypto|cripto)\b/.test(label);
}

function isShippingSelectionLabel(label: string): boolean {
  return /\b(pac|sedex|correios|transportadora|entrega padrao|\d+\s*dias|r\$)\b/.test(label);
}

/** Skip auto "Iniciar cadastro" when checkout already has email progress. */
export function shouldSkipAutoRegistration(customer?: CustomerHints | null): boolean {
  if (!customer) return false;
  if (customer.recognized_buyer && isBuyerRegistrationComplete(customer)) return true;
  if (customer.email_verified) return true;
  if (customer.email && (customer.otp_code || customer.fullName)) return true;
  return false;
}

/** Returning buyer with complete profile should open shipping, not cadastro. */
export function shouldBootstrapShippingSelection(
  customer?: CustomerHints | null,
  stage?: string | null
): boolean {
  return Boolean(
    customer?.recognized_buyer &&
    isBuyerRegistrationComplete(customer) &&
    stage === "shipping"
  );
}

/** Mirrors API CheckoutCustomerService.isRegistrationComplete */
export function isBuyerRegistrationComplete(customer?: CustomerHints | null): boolean {
  if (!customer) return false;
  return Boolean(
    customer.fullName &&
    customer.email &&
    customer.email_verified &&
    customer.cpf &&
    customer.phone &&
    customer.phone_verified
  );
}

/** Buyer hub / login-from-session can run once email is verified. */
export function isBuyerHubEligible(customer?: CustomerHints | null): boolean {
  return Boolean(customer?.email?.trim() && customer.email_verified);
}

export function matchShippingOptionFromLabel(label: string, options: ShippingQuote[]): ShippingQuote | undefined {
  const normalized = normalizeQuickReplyLabel(label);
  if (!normalized) return undefined;
  return options.find((option) => {
    const method = normalizeQuickReplyLabel(option.method);
    const carrier = normalizeQuickReplyLabel(option.carrier);
    const combined = normalizeQuickReplyLabel(`${option.carrier ?? ""} ${option.method ?? ""}`);
    return (
      (method && normalized.includes(method)) ||
      (carrier && normalized.includes(carrier)) ||
      (combined && normalized.includes(combined))
    );
  });
}
