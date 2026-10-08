import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { useCheckoutStore } from "@/store/checkout-store";
import { fetchPublicFaq, sendSupportChat } from "@/api/support";
import { reportError } from "@/lib/error-handler";
import type { FaqItem, SupportMessage, SupportViewModelInterface } from "./types";

const DEFAULT_FAQ_ITEMS: FaqItem[] = [
  { icon: "🚚", question: "Prazo de entrega", answer: "De 2 a 10 dias úteis, dependendo da região e modalidade de envio escolhida." },
  { icon: "🔄", question: "Política de trocas", answer: "Aceitamos trocas dentro de 7 dias após o recebimento. Produto em perfeitas condições." },
  { icon: "💳", question: "Formas de pagamento", answer: "As formas de pagamento disponíveis aparecem antes da finalização do pedido." },
  { icon: "👤", question: "Falar com atendente", answer: "Um atendente humano será acionado em breve." },
];

const SESSION_KEY = "zyon_support_messages";
const TICKET_KEY = "zyon_support_ticket";

export function useSupportViewModel(): SupportViewModelInterface {
  const api = useCheckoutStore((s) => s.api);
  const checkoutSessionId = useCheckoutStore(s => s.sessionId);
  const merchantId = api?.currentMerchantId ?? null;
  const apiBaseUrl = api?.apiBaseUrl ?? "http://localhost:3009";
  const scope = merchantId && checkoutSessionId ? `${merchantId}:${checkoutSessionId}` : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const messageKey = `${SESSION_KEY}:${scope}`;
  const ticketKey = `${TICKET_KEY}:${scope}`;
  const [loadedScope, setLoadedScope] = useState<string | null>(null);

  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"welcome" | "chat">("welcome");
  const [faqItems, setFaqItems] = useState<FaqItem[]>(DEFAULT_FAQ_ITEMS);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const sessionIdRef = useRef(`support_${Date.now()}`);

  useEffect(() => {
    setMessages([]); setTicketId(null); setView("welcome"); setError(null); setLoading(false); setFaqItems(DEFAULT_FAQ_ITEMS);
    setLoadedScope(scope);
    if (!scope) return;
    try {
      const saved = sessionStorage.getItem(messageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          setView("chat");
        }
      }
      const savedTicket = sessionStorage.getItem(ticketKey);
      if (savedTicket) {
        setTicketId(savedTicket);
        setView("chat");
      }
    } catch {
    }
  }, [scope, messageKey, ticketKey]);

  useEffect(() => {
    if (scope && loadedScope === scope && messages.length > 0) {
      try {
        sessionStorage.setItem(messageKey, JSON.stringify(messages));
      } catch {
      }
    }
  }, [messages, scope, loadedScope, messageKey]);

  useEffect(() => {
    try {
      if (scope && loadedScope === scope && ticketId) sessionStorage.setItem(ticketKey, ticketId);
    } catch {
    }
  }, [ticketId, scope, loadedScope, ticketKey]);

  const loadFaq = useCallback(async () => {
    if (!merchantId) return;
    let cancelled = false;
    try {
      const items = await fetchPublicFaq(apiBaseUrl, merchantId);
      if (!cancelled && scopeRef.current === scope && items.length > 0) {
        const hasHandoff = items.some((i) => /atendente|humano/i.test(i.question));
        const withHandoff: FaqItem[] = [
          ...items.map((it) => ({ ...it, icon: it.icon || "❓" })),
          ...(!hasHandoff ? [{ icon: "👤", question: "Falar com atendente", answer: "Um atendente humano será acionado em breve." }] : []),
        ];
        setFaqItems(withHandoff);
      }
    } catch (err) {
      reportError(err, "useSupportViewModel.loadFaq");
    }
  }, [merchantId, apiBaseUrl, scope]);

  useEffect(() => {
    void loadFaq();
  }, [loadFaq]);

  useEffect(() => {
    if (!ticketId || !scope || loadedScope !== scope) return;
    let socket: Socket | null = null;
    let cancelled = false;
    const current = () => !cancelled && scopeRef.current === scope;

    void (async () => {
      try {
        const { io } = await import("socket.io-client");
        if (!current()) return;
        socket = io(`${apiBaseUrl}/support`, { transports: ["websocket", "polling"] });
        socketRef.current = socket;

        socket.on("connect", () => {
          if (!current()) return;
          socket!.emit("join_ticket", { ticketId });
        });

        socket.on("new_message", (msg: { senderType: string; content: string; senderName?: string }) => {
          if (current() && msg.senderType === "merchant") {
            setMessages((prev) => [
              ...prev,
              {
                id: `m-${Date.now()}`,
                role: "merchant",
                text: msg.content,
                agentName: msg.senderName,
              },
            ]);
          }
        });

        socket.on("agent_joined", (data: { agentName: string }) => {
          if (!current()) return;
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-${Date.now()}`,
              role: "agent",
              text: `${data.agentName} entrou no chat.`,
            },
          ]);
        });

        socket.on("ticket_closed", () => {
          if (!current()) return;
          setMessages([]);
          setView("welcome");
          setTicketId(null);
          setLoading(false);
          try {
            sessionStorage.removeItem(messageKey);
            sessionStorage.removeItem(ticketKey);
          } catch {
          }
        });
      } catch (err) {
        reportError(err, "useSupportViewModel.socketConnect");
      }
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [ticketId, apiBaseUrl, scope, loadedScope, messageKey, ticketKey]);

  const getFallbackResponse = useCallback(
    (label: string): string => {
      const match = faqItems.find((item) => item.question === label);
      if (match) return match.answer;
      return "Entendi sua dúvida. Deixe-me verificar...";
    },
    [faqItems]
  );

  const sendMessage = useCallback(
    async (text: string, isFaqClick = false) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userMsg: SupportMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        text: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setView("chat");
      setLoading(true);
      setError(null);

      try {
        const isHandoffRequest = /atendente|humano|suporte/i.test(trimmed);
        if (isFaqClick && !isHandoffRequest) {
          const fallbackText = getFallbackResponse(trimmed);
          setTimeout(() => {
            if (scopeRef.current !== scope) return;
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "agent",
                text: fallbackText,
              },
            ]);
            setLoading(false);
          }, 500);
          return;
        }

        if (merchantId) {
          try {
            const data = await sendSupportChat(apiBaseUrl, {
              merchantId,
              message: trimmed,
              sessionId: checkoutSessionId ?? sessionIdRef.current,
              headers: api?.supportHeaders(),
            });
            if (scopeRef.current !== scope) return;

            if (data) {
              if (data.ticketId) {
                setTicketId(data.ticketId);
              }
              setMessages((prev) => [
                ...prev,
                {
                  id: `a-${Date.now()}`,
                  role: "agent",
                  text: data.reply || "Mensagem recebida.",
                },
              ]);
              setLoading(false);
              return;
            }
          } catch (err) {
            if (scopeRef.current !== scope) return;
            reportError(err, "useSupportViewModel.sendSupportChat");
          }
        }

        if (scopeRef.current !== scope) return;
        const fallbackText = "Não consegui enviar sua mensagem à equipe da loja. Tente novamente em instantes.";
        setError("Mensagem não enviada");
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "agent",
            text: fallbackText,
          },
        ]);
      } catch (err) {
        if (scopeRef.current !== scope) return;
        reportError(err, "useSupportViewModel.sendMessage");
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "agent",
            text: "Desculpe, houve um erro. Tente novamente.",
          },
        ]);
        setError("Erro ao enviar mensagem");
      } finally {
        if (scopeRef.current === scope) setLoading(false);
      }
    },
    [merchantId, apiBaseUrl, api, getFallbackResponse, checkoutSessionId, scope]
  );

  const switchToChat = useCallback(() => {
    setView("chat");
  }, []);

  const switchToWelcome = useCallback(() => {
    setView("welcome");
  }, []);

  return {
    messages,
    input,
    loading,
    view,
    faqItems,
    ticketId,
    error,
    loadFaq,
    setInput,
    sendMessage,
    switchToChat,
    switchToWelcome,
    hasTicket: ticketId !== null,
  };
}
