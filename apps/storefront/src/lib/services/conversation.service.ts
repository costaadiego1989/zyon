import { merchantThemeTokens, type MerchantThemeAppearance } from "@zyon/shared-types";
import { THEME_TOKENS } from "@/components/conversation/theme-tokens";
export { THEME_TOKENS } from "@/components/conversation/theme-tokens";

import type { Message, Mode, Channel, ConversationHistoryMessage } from "@/lib/viewmodels/useConversationViewModel/types";
import { conversationFetch } from "@/lib/conversation-access";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
export const CONVERSATION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

type ConversationHistoryEntry = { role: "user" | "assistant"; content: string };

function conversationHistory(value: unknown): ConversationHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  // Keep room for the next buyer message in the API's 100-entry contract.
  return value.filter((entry): entry is ConversationHistoryEntry => entry !== null && typeof entry === "object"
    && (entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string"
    && entry.content.trim().length > 0 && entry.content.length <= 8000)
    .slice(-99).map(entry => ({ role: entry.role, content: entry.content }));
}

function legacyBuyerHistory(messages: Message[]): ConversationHistoryEntry[] {
  // Old UI snapshots have no assistant provenance. Carry only actual buyer
  // utterances; never turn cards, greetings, nudges or local errors into facts.
  return conversationHistory(messages.filter(message => message?.role === "user" && !message.ephemeral)
    .map(message => ({ role: "user", content: message.text })));
}

export function trackFunnelEvent(merchantId: string, sessionId: string, event: string) {
  conversationFetch(sessionId, `${API_BASE}/storefront/conversations/${encodeURIComponent(sessionId)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merchant_id: merchantId, event, metadata: { timestamp: new Date().toISOString() } }),
  }).catch(() => {});
}

export function restoreConversation(merchantId: string | undefined, stateKey: (mid: string) => string): {
  conversationId: string | null;
  messages: Message[];
  history: ConversationHistoryEntry[];
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
      context?: { version?: number; merchantId?: string; conversationId?: string | null; history?: unknown };
    };
    if (!Array.isArray(parsed.messages)) return null;
    if (parsed.savedAt && Date.now() - parsed.savedAt > CONVERSATION_MAX_AGE_MS) {
      sessionStorage.removeItem(stateKey(merchantId));
      return null;
    }
    const conversationId = parsed.conversationId ?? null;
    if (conversationId !== null && (typeof conversationId !== "string" || !conversationId.trim())) return null;
    if (parsed.context !== undefined && (parsed.context?.version !== 1 || parsed.context.merchantId !== merchantId
      || parsed.context.conversationId !== conversationId || !Array.isArray(parsed.context.history))) return null;
    return {
      conversationId,
      messages: parsed.messages,
      history: conversationId ? parsed.context ? conversationHistory(parsed.context.history) : legacyBuyerHistory(parsed.messages) : [],
      mode: parsed.mode ?? null,
      channel: parsed.channel ?? null,
    };
  } catch {
    return null;
  }
}

export function saveConversationState(merchantId: string, stateKey: (mid: string) => string, state: { conversationId: string | null; messages: Message[]; history?: ConversationHistoryEntry[]; mode: Mode; channel: Channel | null }) {
  if (!merchantId || typeof sessionStorage === "undefined") return;
  try {
    const { history, ...displayState } = state;
    sessionStorage.setItem(
      stateKey(merchantId),
      JSON.stringify({ ...displayState, context: { version: 1, merchantId, conversationId: state.conversationId,
        history: state.conversationId ? conversationHistory(history ?? legacyBuyerHistory(state.messages)) : [] }, savedAt: Date.now() }),
    );
  } catch {}
}

const DEFAULT_QUICK_REPLIES = ["Ver Produtos", "Encontrar Produto", "Categorias", "Prazo de Entrega", "Trocas e Devoluções", "Rastrear Pedido", "Meus Dados", "Ofertas"];
export const ATTACHMENT_WELCOME_NOTICE = "Também entendo imagens e listas de compras. Envie uma foto para encontrar produtos semelhantes ou uma lista para eu ajudar a montar seu pedido.";

export function getStorefrontWelcomeDefaults(businessMode?: "products" | "services") {
  const services = businessMode === "services";
  return {
    quickReplies: services
      ? ["Quais serviços vocês oferecem?", "Quais profissionais e horários estão disponíveis?", "Meus Dados", "Falar com Humano"]
      : DEFAULT_QUICK_REPLIES,
    roleLabel: services ? "Assistente de atendimento da" : "Gerente de vendas da",
    introDescription: services
      ? "Conheça nossos serviços, escolha um profissional e consulte datas e horários. Quando decidir agendar, eu ajudo você a continuar."
      : "Eu cuido da sua compra do início ao fim. Acho a melhor opção, aplico promoções, organizo a entrega e finalizo o pagamento com você, passo a passo.",
    channelPrompt: services ? "Como você prefere conversar?" : "Como você prefere comprar?",
    chatGreeting: services
      ? "Posso ajudar você a conhecer os serviços, escolher um profissional e consultar datas e horários. Por onde quer começar?"
      : "A partir de agora serei sua assistente de vendas e irei te ajudar a encontrar produtos, aplicar cupons, calcular frete e finalizar sua compra. Vamos começar!",
    attachmentNotice: services
      ? "Se preferir, envie uma imagem ou uma lista para acompanhar sua mensagem."
      : ATTACHMENT_WELCOME_NOTICE,
    attachmentPrompt: services
      ? "Considere este anexo ao responder sobre os serviços desta empresa. Se faltar contexto, pergunte o que desejo consultar."
      : "Analise este anexo, encontre produtos iguais ou semelhantes disponíveis e me pergunte antes de adicionar qualquer item ao carrinho.",
  };
}

export function buildWelcomeMessage(params: {
  agent: string;
  storeName: string;
  businessMode?: "products" | "services";
  agentGreeting?: string;
  quickReplies?: string[];
  expGreetingMessage?: string;
  expSuggestedNext?: string[];
}): Message {
  const { agent, storeName, businessMode, agentGreeting, quickReplies, expGreetingMessage, expSuggestedNext } = params;
  const defaults = getStorefrontWelcomeDefaults(businessMode);
  const persuasiveFallback = businessMode === "services"
    ? `Olá! Sou ${agent}, assistente da ${storeName}. ${defaults.chatGreeting}`
    : `Oi! Sou ${agent}, sua vendedora pessoal aqui na ${storeName}. 💚 Me conta o que você procura — eu encontro o produto ideal, garanto o melhor preço com cupons, calculo o frete e fecho seu pedido em segundos, tudo por aqui. Bora começar?`;
  const greeting = expGreetingMessage || agentGreeting || persuasiveFallback;
  const replies = expSuggestedNext ?? quickReplies ?? defaults.quickReplies;
  return {
    id: "welcome",
    role: "agent",
    text: `${greeting}\n\n${defaults.attachmentNotice}`,
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
    case "wishlist":
      return "Aqui estão os produtos salvos na sua lista de desejos:";
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


export function applyThemeToDOM(theme: "dark" | "light", merchantTheme?: MerchantThemeAppearance) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.neuTheme = theme;
  const tokens = merchantTheme ? merchantThemeTokens(merchantTheme, theme === "dark" && merchantTheme.mode === "grey" ? "grey" : theme) : THEME_TOKENS[theme];
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

export function decodeConversationHistory(conversationId: string, value: unknown): Message[] {
  const transcript=value as {format?:unknown;conversation_id?:unknown;messages?:ConversationHistoryMessage[]} | null;
  if(transcript?.format==="messages-v1"){
    if(transcript.conversation_id!==conversationId||!Array.isArray(transcript.messages)||transcript.messages.length>200)throw new Error("invalid_conversation_history");
    const ids=new Set<string>();let previous=0;
    return transcript.messages.map(m=>{
      if(!m||typeof m.id!=="string"||!m.id||m.id.length>128||ids.has(m.id)||!["user","assistant"].includes(m.role)
        ||typeof m.content!=="string"||m.content.length>(m.role==="user"?4000:8000)||!Number.isSafeInteger(m.sequence)||m.sequence<=previous
        ||typeof m.timestamp!=="string"||!Number.isFinite(Date.parse(m.timestamp))
        ||m.client_id!==undefined&&!/^[a-zA-Z0-9_-]{1,128}$/.test(m.client_id))throw new Error("invalid_conversation_history");
      ids.add(m.id);previous=m.sequence;
      return {id:m.client_id?`request:${m.client_id}:${m.role}`:m.id,role:m.role==="user"?"user" as const:"agent" as const,text:m.content};
    });
  }
  const data=value as {conversation_id?:unknown;messages?:unknown} | null;
  if (data?.conversation_id === conversationId && Array.isArray(data.messages) && data.messages.length === 0) return [];
  throw new Error("invalid_conversation_history");
}
