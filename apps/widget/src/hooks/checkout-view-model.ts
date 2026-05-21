import type {
  Cart,
  ChatAction,
  CheckoutEventName,
  CheckoutExperienceSnapshot,
  MerchantTheme
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

export const STAGE_FLOW = [
  { key: "data_collection", label: "Cadastro", shortLabel: "Cadastro" },
  { key: "shipping", label: "Entrega", shortLabel: "Entrega" },
  { key: "payment", label: "Pagamento", shortLabel: "Pagamento" },
  { key: "completed", label: "Concluído", shortLabel: "Concluído" }
] as const;

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

export function themeStyle(theme: MerchantTheme, isForcedMode = false): React.CSSProperties {
  const merged: MerchantTheme = {
    ...DEFAULT_MERCHANT_THEME,
    ...(theme ?? {})
  };
  const accent = merged.accentColor || "#0F766E";
  const surface = merged.surfaceColor ?? "#FFFFFF";
  const elevated = merged.surfaceElevatedColor ?? "#F8FAFC";
  const border = merged.borderColor ?? "#D9E2EC";
  const text = merged.textColor ?? "#111827";
  const muted = merged.mutedTextColor ?? "#64748B";
  const background = merged.backgroundColor ?? "#F7F8FA";
  const radius = `${merged.borderRadius ?? 8}px`;
  const density = merged.density ?? "comfortable";
  const hasBackgroundImage = typeof merged.backgroundImageUrl === "string" && merged.backgroundImageUrl.startsWith("https://");

  const styles: Record<string, string> = {
    "--aacp-accent": accent,
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
    "--aacp-grad-primary": `linear-gradient(135deg, ${accent} 0%, ${accent}cc 50%, ${accent}99 100%)`,
    "--aacp-grad-soft": `linear-gradient(135deg, ${accent}26, ${accent}1a)`,
    "--aacp-grad-bubble-buyer": `linear-gradient(135deg, ${accent}dd 0%, ${accent} 60%, ${accent}99 100%)`,
    "--aacp-grad-glow": `radial-gradient(60% 60% at 50% 0%, ${accent}2e, transparent 70%)`,
    "--aacp-glow": `0 0 40px ${accent}59`,
  };

  if (hasBackgroundImage && merged.backgroundImageUrl) {
    styles["--aacp-bg-image"] = `url("${merged.backgroundImageUrl.replace(/"/g, "%22")}")`;
  }

  if (isForcedMode) {
    styles["--aacp-shell-bg"] = `linear-gradient(180deg, ${surface}f2, ${elevated}f2)`;
  }
  return styles as unknown as React.CSSProperties;
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

export function agentTypingLine(agentName: string): string {
  const { given } = agentGivenAndRest(agentName);
  return `${given} está digitando...`;
}

export function quickReplyId(reply: QuickReplyChoice): string {
  return reply.label + (reply.event ?? "") + (reply.offerId ?? "");
}

const GOOGLE_FONT_WEIGHTS = "400;500;600;700;800";
const GOOGLE_FONT_FAMILIES = new Set([
  "Inter", "Manrope", "Plus Jakarta Sans", "DM Sans", "Poppins",
  "Roboto", "Sora", "Space Grotesk", "Montserrat", "Outfit", "Raleway"
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
  if (stage === "data_collection") {
    return replies.filter(r => !/frete|pagamento|cartao|pix|cupom/i.test(r.label));
  }
  if (stage === "shipping") {
    return replies.filter(r => !/cadastro|identificar|cupom/i.test(r.label));
  }
  if (stage === "payment") {
    const filtered = replies.filter(r => /pagamento|finalizar|cartao|pix|cupom/i.test(r.label));
    // Add coupon option if not already present
    const hasCoupon = filtered.some(r => /cupom/i.test(r.label));
    if (!hasCoupon) {
      filtered.push({ label: "Não possuo cupom" });
    }
    return filtered;
  }
  return replies;
}
