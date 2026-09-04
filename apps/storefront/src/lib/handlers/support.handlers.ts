import type { Socket } from "socket.io-client";
import type { FaqItem } from "@/lib/services/support.service";

interface SupportSocketHandlers {
  onMerchantMessage: (content: string, senderName?: string) => void;
  onAgentJoined: (agentName: string) => void;
  onTicketClosed: () => void;
}

export async function connectSupportSocket(
  apiBase: string,
  ticketId: string,
  handlers: SupportSocketHandlers,
): Promise<Socket> {
  const { io } = await import("socket.io-client");
  const socket = io(`${apiBase}/support`, {
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    socket.emit("join_ticket", { ticketId });
  });

  socket.on(
    "new_message",
    (msg: { senderType: string; content: string; senderName?: string }) => {
      if (msg.senderType === "merchant") {
        handlers.onMerchantMessage(msg.content, msg.senderName);
      }
    },
  );

  socket.on("agent_joined", (data: { agentName: string }) => {
    handlers.onAgentJoined(data.agentName);
  });

  socket.on("ticket_closed", () => {
    handlers.onTicketClosed();
  });

  return socket;
}

export const DEFAULT_FAQ_ITEMS: FaqItem[] = [
  {
    icon: "🚚",
    question: "Prazo de entrega",
    answer: "De 2 a 10 dias úteis, dependendo da região e modalidade de envio escolhida.",
  },
  {
    icon: "🔄",
    question: "Política de trocas",
    answer: "Aceitamos trocas dentro de 7 dias após o recebimento. Produto em perfeitas condições.",
  },
  {
    icon: "💳",
    question: "Formas de pagamento",
    answer: "Cartão de crédito, PIX, boleto bancário e crypto USDC.",
  },
  {
    icon: "👤",
    question: "Falar com atendente",
    answer: "Um atendente humano será acionado em breve.",
  },
];

export function buildFallbackResponse(
  label: string,
  faqItems: FaqItem[],
): string {
  const match = faqItems.find((item) => item.question === label);
  if (match) return match.answer;
  return "Entendi sua dúvida. Deixe-me verificar...";
}

export function isHandoffRequest(text: string): boolean {
  return /atendente|humano|suporte/i.test(text);
}

export function hasHandoffFaqItem(items: FaqItem[]): boolean {
  return items.some((i) => /atendente|humano/i.test(i.question));
}

export function enrichFaqItems(items: FaqItem[]): FaqItem[] {
  const withDefaults: FaqItem[] = items.map((it) => ({
    ...it,
    icon: it.icon || "❓",
  }));

  const alreadyHasHandoff = hasHandoffFaqItem(withDefaults);
  if (alreadyHasHandoff) return withDefaults;

  return [
    ...withDefaults,
    {
      icon: "👤",
      question: "Falar com atendente",
      answer: "Um atendente humano será acionado em breve.",
    },
  ];
}
