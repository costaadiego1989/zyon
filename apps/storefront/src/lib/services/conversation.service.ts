import { Message, Mode, Channel } from "@/lib/viewmodels/useConversationViewModel";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
export const CONVERSATION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function trackFunnelEvent(merchantId: string, sessionId: string, event: string) {
  fetch(`${API_BASE}/v1/storefront/conversations/${encodeURIComponent(sessionId)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merchant_id: merchantId, event, metadata: { timestamp: new Date().toISOString() } }),
  }).catch(() => {});
}

export function restoreConversation(merchantId: string | undefined, stateKey: (mid: string) => string): {
  conversationId: string | null;
  messages: Message[];
  mode: Mode | null;
  channel: Channel | null;
} | null {
  if (!merchantId || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(stateKey(merchantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      conversationId?: string | null;
      messages?: Message[];
      mode?: Mode;
      channel?: Channel | null;
      savedAt?: number;
    };
    if (!Array.isArray(parsed.messages)) return null;
    if (parsed.savedAt && Date.now() - parsed.savedAt > CONVERSATION_MAX_AGE_MS) {
      sessionStorage.removeItem(stateKey(merchantId));
      return null;
    }
    return {
      conversationId: parsed.conversationId ?? null,
      messages: parsed.messages,
      mode: parsed.mode ?? null,
      channel: parsed.channel ?? null,
    };
  } catch {
    return null;
  }
}

export function saveConversationState(merchantId: string, stateKey: (mid: string) => string, state: { conversationId: string | null; messages: Message[]; mode: Mode; channel: Channel | null }) {
  if (!merchantId || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      stateKey(merchantId),
      JSON.stringify({ ...state, savedAt: Date.now() }),
    );
  } catch {}
}

const DEFAULT_QUICK_REPLIES = ["Ver Produtos", "Encontrar Produto", "Categorias", "Prazo de Entrega", "Trocas e Devoluções", "Rastrear Pedido", "Meus Dados", "Ofertas"];

export function buildWelcomeMessage(params: {
  agent: string;
  storeName: string;
  agentGreeting?: string;
  quickReplies?: string[];
  expGreetingMessage?: string;
  expSuggestedNext?: string[];
}): Message {
  const { agent, storeName, agentGreeting, quickReplies, expGreetingMessage, expSuggestedNext } = params;
  const persuasiveFallback = `Oi! Sou ${agent}, sua vendedora pessoal aqui na ${storeName}. 💚 Me conta o que você procura — eu encontro o produto ideal, garanto o melhor preço com cupons, calculo o frete e fecho seu pedido em segundos, tudo por aqui. Bora começar?`;
  const greeting = expGreetingMessage || agentGreeting || persuasiveFallback;
  const replies = expSuggestedNext ?? quickReplies ?? DEFAULT_QUICK_REPLIES;
  return {
    id: "welcome",
    role: "agent",
    text: greeting,
    blocks: [{ type: "quick_replies", data: { options: replies } }],
  };
}

export function narrateStorefrontBlock(type: string | undefined): string | undefined {
  switch (type) {
    case "product_carousel":
    case "marketplace_products":
      return "Separei estes produtos pra você:";
    case "product_card":
      return "Encontrei este produto:";
    case "product_comparison":
      return "Aqui está a comparação entre os produtos:";
    case "category_carousel":
      return "Estas são as categorias disponíveis:";
    case "cart_summary":
      return "Aqui está o resumo do seu carrinho:";
    case "shipping_options":
      return "Estas são as opções de entrega:";
    case "cross_sell":
      return "Separei alguns itens que combinam com sua compra:";
    default:
      return undefined;
  }
}

export const THEME_TOKENS: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    "--aacp-bg": "#08080c",
    "--aacp-surface": "#0f0f16",
    "--aacp-surface-2": "rgba(255, 255, 255, 0.05)",
    "--aacp-surface-3": "rgba(255, 255, 255, 0.08)",
    "--aacp-fg": "#f5f5f7",
    "--aacp-muted": "#8b8b95",
    "--aacp-faint": "#6c6a72",
    "--aacp-line": "rgba(255, 255, 255, 0.1)",
    "--aacp-line-strong": "rgba(255, 255, 255, 0.12)",
    "--aacp-card": "rgba(255, 255, 255, 0.05)",
    "--aacp-success": "#34d399",
    "--aacp-panel-bg": "#0f0f16",
    "--aacp-shell-bg": "#08080c",
  },
  light: {
    "--aacp-bg": "#ffffff",
    "--aacp-surface": "#ffffff",
    "--aacp-surface-2": "#f6f5f2",
    "--aacp-surface-3": "#efeee9",
    "--aacp-fg": "#141418",
    "--aacp-muted": "#71717a",
    "--aacp-faint": "#9a978e",
    "--aacp-line": "rgba(15, 15, 25, 0.09)",
    "--aacp-line-strong": "rgba(15, 15, 25, 0.1)",
    "--aacp-card": "#f7f6f3",
    "--aacp-success": "#10b981",
    "--aacp-panel-bg": "#ffffff",
    "--aacp-shell-bg": "#ffffff",
  },
};

export function applyThemeToDOM(theme: "dark" | "light") {
  if (typeof document === "undefined") return;
  const tokens = THEME_TOKENS[theme];
  for (const [key, val] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(key, val);
  }
}

export function restoreChannelPreference(): ("chat" | "voice" | null) {
  try {
    const saved = localStorage.getItem("pulse-channel-pref") as ("chat" | "voice" | null);
    return (saved === "chat" || saved === "voice") ? saved : null;
  } catch {
    return null;
  }
}

export function saveChannelPreference(channel: "chat" | "voice") {
  try {
    localStorage.setItem("pulse-channel-pref", channel);
  } catch {}
}

export function restoreThemePreference(): ("dark" | "light" | null) {
  try {
    const saved = localStorage.getItem("zyon-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  return null;
}

export function saveThemePreference(theme: "dark" | "light") {
  try {
    localStorage.setItem("zyon-theme", theme);
  } catch {}
}
