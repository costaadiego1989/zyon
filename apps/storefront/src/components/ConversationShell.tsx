"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CartSummaryBlock,
  CheckoutRedirectBlock,
  ConversationBlock,
  ProductCardBlock,
  ProductCarouselBlock,
  QuickRepliesBlock,
} from "@/lib/types";
import {
  trackBeginCheckout,
  trackConversationStart,
  trackProductView,
  trackPurchase,
} from "@/lib/analytics";
import BlockRenderer from "./blocks/BlockRenderer";

type Message = {
  id: string;
  role: "user" | "agent";
  text?: string;
  blocks?: ConversationBlock[];
};

export default function ConversationShell({
  storeName,
  logo,
  returnOrderId,
}: {
  storeName: string;
  logo?: string;
  returnOrderId?: string;
}) {
  const [messages, setMessages] = useState<Message[]>(() => {
    const initial: Message[] = [];

    if (returnOrderId) {
      initial.push({
        id: "order-confirmation",
        role: "agent",
        text: `Pedido #${returnOrderId} confirmado! Posso ajudar com mais alguma coisa?`,
        blocks: [
          {
            type: "quick_replies",
            data: {
              options: ["Rastrear pedido", "Ver mais produtos", "Falar com humano"],
            },
          },
        ],
      });
    } else {
      initial.push({
        id: "welcome",
        role: "agent",
        text: `Olá! Eu sou o assistente da ${storeName}. Como posso ajudar hoje?`,
        blocks: [
          {
            type: "quick_replies",
            data: {
              options: ["Ver produtos", "Promoções", "Rastrear pedido", "Falar com humano"],
            },
          },
        ],
      });
    }

    return initial;
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Analytics: fire conversation_start once on mount.
  useEffect(() => {
    trackConversationStart(storeName);
  }, [storeName]);

  // Analytics: fire purchase once when an order confirmation is returned.
  const trackedOrderRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!returnOrderId) return;
    if (trackedOrderRef.current === returnOrderId) return;
    trackedOrderRef.current = returnOrderId;
    trackPurchase(returnOrderId, 0);
  }, [returnOrderId]);

  // Analytics: dedupe by id so we don't double-fire when the same block
  // re-renders. Track when product cards, checkout redirects, and cart
  // summaries appear in any message.
  const trackedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      if (!m.blocks) continue;
      for (const block of m.blocks) {
        const id = `${m.id}::${block.type}`;
        if (trackedIdsRef.current.has(id)) continue;
        trackedIdsRef.current.add(id);

        if (block.type === "product_card") {
          const p = (block as ProductCardBlock).data;
          trackProductView(p.id, p.name, p.price);
        } else if (block.type === "product_carousel") {
          const c = (block as ProductCarouselBlock).data;
          for (const p of c.products) {
            trackProductView(p.id, p.name, p.price);
          }
        } else if (block.type === "checkout_redirect") {
          const cr = (block as CheckoutRedirectBlock).data;
          // We don't have the cart value here at render time; defer to
          // a cart summary if present, otherwise send 0.
          trackBeginCheckout(0, 0);
          // Touch cr.sessionId so the lint doesn't flag unused destructure.
          // It's intentionally not used yet — session URL itself is the
          // merchant's redirect target.
          void cr.sessionId;
        } else if (block.type === "cart_summary") {
          const cs = (block as CartSummaryBlock).data;
          trackBeginCheckout(cs.total, cs.itemCount);
        }
      }
    }
  }, [messages]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
  };

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    scrollToBottom();

    setIsLoading(true);

    // Placeholder: echo response. Will be replaced by real API call.
    setTimeout(() => {
      const ack: Message = {
        id: `a-${Date.now()}`,
        role: "agent",
        text: `Entendi, "${trimmed}". Deixa eu verificar para você...`,
      };
      setMessages((prev) => [...prev, ack]);
      setIsLoading(false);
      scrollToBottom();
    }, 800);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const handleQuickReply = (option: string) => {
    void sendMessage(option);
  };

  // Extract last quick replies from last agent message (if present)
  const lastMessage = messages[messages.length - 1];
  const lastQuickReplies =
    lastMessage?.role === "agent"
      ? lastMessage.blocks?.find(
          (b): b is QuickRepliesBlock => b.type === "quick_replies",
        )
      : undefined;

  return (
    <div className="conversation-shell">
      {/* Header */}
      <header className="conversation-header">
        <div className="conversation-header__avatar">
          {logo ? (
            <img
              src={logo}
              alt={storeName}
              style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }}
            />
          ) : (
            <span aria-hidden>🤖</span>
          )}
        </div>
        <div className="conversation-header__info">
          <div className="conversation-header__name">{storeName}</div>
          <div className="conversation-header__status">Assistente online</div>
        </div>
      </header>

      {/* Messages */}
      <div ref={listRef} className="conversation-messages">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`message message--${m.role}`}
          >
            {m.role === "agent" && (
              <div className="message__avatar">🤖</div>
            )}
            <div className="message__content">
              {m.text && (
                <div className="message__bubble">{m.text}</div>
              )}
              {m.blocks &&
                m.blocks
                  .filter((b) => b.type !== "quick_replies")
                  .map((block, idx) => (
                    <div key={idx} className="message__block">
                      <BlockRenderer
                        block={block}
                        onQuickReply={handleQuickReply}
                      />
                    </div>
                  ))}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="message message--agent">
            <div className="message__avatar">🤖</div>
            <div className="message__content">
              <div className="message__bubble message__bubble--typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Replies above input */}
      {lastQuickReplies && (
        <div className="conversation-quick-replies">
          <BlockRenderer
            block={lastQuickReplies}
            onQuickReply={handleQuickReply}
          />
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSubmit} className="conversation-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua mensagem…"
          aria-label="Mensagem"
          className="conversation-input__field"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="conversation-input__send"
          aria-label="Enviar"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
