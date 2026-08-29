"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { FaqItem } from "@/lib/services/support.service";
import {
  fetchCheckoutToken,
  fetchPublicFaq,
  sendSupportChat,
} from "@/lib/services/support.service";
import {
  buildFallbackResponse,
  connectSupportSocket,
  DEFAULT_FAQ_ITEMS,
  enrichFaqItems,
  isHandoffRequest,
} from "@/lib/handlers/support.handlers";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

export interface SupportMessage {
  id: string;
  role: "user" | "agent" | "merchant";
  text: string;
  agentName?: string;
}

const SESSION_KEY = "zyon_support_messages";
const TICKET_KEY = "zyon_support_ticket";

interface UseSupportPanelProps {
  open: boolean;
  merchantId?: string;
  agentName?: string;
}

interface UseSupportPanelReturn {
  messages: SupportMessage[];
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  view: "welcome" | "chat" | "return";
  setView: (view: "welcome" | "chat" | "return") => void;
  returnDone: boolean;
  setReturnDone: (done: boolean) => void;
  faqItems: FaqItem[];
  threadRef: React.RefObject<HTMLDivElement>;
  inputRef: React.RefObject<HTMLInputElement>;
  handleSubmit: (e: React.FormEvent) => void;
  handleFaqClick: (label: string) => void;
}

export function useSupportPanel({
  open,
  merchantId,
}: UseSupportPanelProps): UseSupportPanelReturn {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [view, setView] = useState<"welcome" | "chat" | "return">("welcome");
  const [returnDone, setReturnDone] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [faqItems, setFaqItems] = useState<FaqItem[]>(DEFAULT_FAQ_ITEMS);
  const embedTokenRef = useRef<string | null>(null);
  const sessionIdRef = useRef(`support_${Date.now()}`);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          setView("chat");
        }
      }
      const savedTicket = sessionStorage.getItem(TICKET_KEY);
      if (savedTicket) {
        setTicketId(savedTicket);
        setView("chat");
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages));
      } catch {}
    }
  }, [messages]);

  useEffect(() => {
    try {
      if (ticketId) sessionStorage.setItem(TICKET_KEY, ticketId);
    } catch {}
  }, [ticketId]);

  useEffect(() => {
    if (!merchantId || embedTokenRef.current) return;
    void (async () => {
      const token = await fetchCheckoutToken(merchantId);
      embedTokenRef.current = token;
    })();
  }, [merchantId]);

  useEffect(() => {
    if (!merchantId || !open) return;
    let cancelled = false;
    void (async () => {
      const items = await fetchPublicFaq(merchantId);
      if (!cancelled && items.length > 0) {
        setFaqItems(enrichFaqItems(items));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [merchantId, open]);

  useEffect(() => {
    if (!ticketId) return;
    let socket: Socket | null = null;
    void (async () => {
      socket = await connectSupportSocket(API_BASE, ticketId, {
        onMerchantMessage: (content, senderName) => {
          setMessages((prev) => [
            ...prev,
            {
              id: `m-${Date.now()}`,
              role: "merchant",
              text: content,
              agentName: senderName,
            },
          ]);
        },
        onAgentJoined: (name) => {
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-${Date.now()}`,
              role: "agent",
              text: `${name} entrou no chat.`,
            },
          ]);
        },
        onTicketClosed: () => {
          setMessages([]);
          setView("welcome");
          setTicketId(null);
          setIsLoading(false);
          try {
            sessionStorage.removeItem(SESSION_KEY);
            sessionStorage.removeItem(TICKET_KEY);
          } catch {}
        },
      });
      socketRef.current = socket;
    })();

    return () => {
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [ticketId]);

  useEffect(() => {
    if (threadRef.current) {
      requestAnimationFrame(() => {
        if (threadRef.current)
          threadRef.current.scrollTop = threadRef.current.scrollHeight;
      });
    }
  }, [messages]);

  useEffect(() => {
    if (!open) {
      setInput("");
    }
  }, [open]);

  useEffect(() => {
    if (open && view === "chat" && inputRef.current) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, view]);

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
      setIsLoading(true);

      try {
        const handoff = isHandoffRequest(trimmed);
        if (isFaqClick && !handoff) {
          const fallbackText = buildFallbackResponse(trimmed, faqItems);
          setTimeout(() => {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "agent",
                text: fallbackText,
              },
            ]);
            setIsLoading(false);
          }, 500);
          return;
        }

        if (merchantId) {
          try {
            const data = await sendSupportChat({
              merchant_id: merchantId,
              message: trimmed,
              session_id: sessionIdRef.current,
            });

            if (data.handoff?.ticketId) {
              setTicketId(data.handoff.ticketId);
            }
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "agent",
                text: data.reply || data.message || data.response || "Mensagem recebida.",
              },
            ]);
            setIsLoading(false);
            return;
          } catch {}
        }

        const fallbackText = `Entendi, "${trimmed}". Um atendente será designado em breve.`;
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "agent",
            text: fallbackText,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "agent",
            text: "Desculpe, houve um erro. Tente novamente.",
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [merchantId, faqItems],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input, false);
  };

  const handleFaqClick = (label: string) => {
    void sendMessage(label, true);
  };

  return {
    messages,
    input,
    setInput,
    isLoading,
    view,
    setView,
    returnDone,
    setReturnDone,
    faqItems,
    threadRef,
    inputRef,
    handleSubmit,
    handleFaqClick,
  };
}
