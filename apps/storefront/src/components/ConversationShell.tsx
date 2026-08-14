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
          trackBeginCheckout(0, 0);
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

  // Get merchant initial (first letter capitalized)
  const merchantInitial = storeName.charAt(0).toUpperCase();

  return (
    <div
      className="pulse-widget-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--aacp-bg)",
        boxShadow: "none",
        borderRadius: 0,
        overflow: "hidden",
      }}
    >
      {/* HEADER: matches PulseWidget structure exactly */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "11px",
          padding: "12px 14px",
          borderBottom: "none",
          zIndex: 9,
          background: "var(--aacp-surface)",
          flex: "none",
        }}
      >
        {/* Merchant Avatar: 34px container with initials or image */}
        <div
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "12px",
            border: "1px solid var(--aacp-line)",
            background: "var(--aacp-accent)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            overflow: "hidden",
            fontSize: "13px",
            fontWeight: 800,
            letterSpacing: "-.2px",
          }}
        >
          {logo ? (
            <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            merchantInitial
          )}
        </div>

        {/* Store name + status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "13.5px",
              fontWeight: 700,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {storeName}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "10.5px",
              color: "var(--aacp-muted)",
              marginTop: "1px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "var(--aacp-success)",
                animation: "pulseDot 2.2s ease-in-out infinite",
                flex: "none",
              }}
            />
            Online
          </div>
        </div>
      </div>

      {/* MESSAGES AREA */}
      <div
        ref={listRef}
        style={{
          position: "relative",
          zIndex: 1,
          flex: "0 0 auto",
          minHeight: "220px",
          maxHeight: "calc(100% - 180px)",
          overflowY: "auto",
          overflowX: "hidden",
          padding: "20px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          scrollBehavior: "smooth",
        }}
      >
        {/* Scrollbar styling */}
        <style>{`
          .pulse-widget-shell > div:nth-child(2)::-webkit-scrollbar {
            width: 6px;
          }
          .pulse-widget-shell > div:nth-child(2)::-webkit-scrollbar-track {
            background: transparent;
          }
          .pulse-widget-shell > div:nth-child(2)::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.08);
            border-radius: 999px;
          }
          .pulse-widget-shell > div:nth-child(2)::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.15);
          }
          @keyframes pulseDot {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
          @keyframes bubble-in {
            from {
              opacity: 0;
              transform: translateY(8px) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          @keyframes dot {
            0%, 80%, 100% {
              opacity: 0.3;
              transform: scale(0.65);
            }
            40% {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}</style>

        {messages.map((m) => {
          if (m.role === "agent") {
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  maxWidth: "min(82%, 520px)",
                  alignSelf: "flex-start",
                  animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
                }}
              >
                {m.text && (
                  <div
                    style={{
                      maxWidth: "100%",
                      padding: "14px 18px",
                      borderRadius: "16px",
                      fontSize: "14px",
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      background: "var(--aacp-surface)",
                      border: "1px solid var(--aacp-line-strong)",
                      color: "var(--aacp-fg)",
                      borderTopLeftRadius: "10px",
                      boxShadow: "var(--aacp-shadow-sm)",
                      wordWrap: "break-word",
                    }}
                  >
                    {m.text}
                  </div>
                )}
                {m.blocks &&
                  m.blocks
                    .filter((b) => b.type !== "quick_replies")
                    .map((block, idx) => (
                      <div key={idx} style={{ maxWidth: "100%" }}>
                        <BlockRenderer
                          block={block}
                          onQuickReply={handleQuickReply}
                        />
                      </div>
                    ))}
              </div>
            );
          } else {
            // User message
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  maxWidth: "min(82%, 520px)",
                  alignSelf: "flex-end",
                  animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
                }}
              >
                {m.text && (
                  <div
                    style={{
                      maxWidth: "100%",
                      padding: "14px 18px",
                      borderRadius: "16px",
                      fontSize: "14px",
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      background: "var(--aacp-accent)",
                      color: "#fff",
                      border: "1px solid color-mix(in srgb, var(--aacp-accent) 80%, #000)",
                      borderTopRightRadius: "10px",
                      boxShadow: "var(--aacp-shadow-sm)",
                      wordWrap: "break-word",
                    }}
                  >
                    {m.text}
                  </div>
                )}
              </div>
            );
          }
        })}

        {/* Typing indicator */}
        {isLoading && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              maxWidth: "min(82%, 520px)",
              alignSelf: "flex-start",
              animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                padding: "12px 16px",
                background: "var(--aacp-surface)",
                border: "1px solid var(--aacp-line-strong)",
                borderRadius: "16px",
                borderTopLeftRadius: "10px",
                fontSize: "12px",
                color: "var(--aacp-muted)",
                animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
              }}
            >
              <div style={{ display: "inline-flex", gap: "4px" }}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: "6px",
                      height: "6px",
                      background: "var(--aacp-accent-strong)",
                      borderRadius: "999px",
                      animation: `dot 1.2s infinite ease-in-out`,
                      animationDelay: `${i * 0.15}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* QUICK REPLIES */}
      {lastQuickReplies && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "16px",
            padding: "8px 16px",
            flex: "none",
            background: "var(--aacp-bg)",
            borderTop: "1px solid var(--aacp-line)",
            overflowX: "auto",
            animation: "bubble-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
          }}
        >
          <BlockRenderer
            block={lastQuickReplies}
            onQuickReply={handleQuickReply}
          />
        </div>
      )}

      {/* INPUT BAR */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "16px 32px 16px",
          borderTop: "1px solid var(--aacp-line)",
          background: "var(--aacp-surface-2)",
          marginTop: "auto",
          flex: "none",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua mensagem…"
          aria-label="Mensagem"
          disabled={isLoading}
          style={{
            flex: 1,
            border: "1px solid var(--aacp-line-strong)",
            background: "rgba(255, 255, 255, 0.04)",
            padding: "10px 14px",
            fontSize: "14px",
            outline: "none",
            boxShadow: "none",
            minWidth: 0,
            color: "var(--aacp-fg)",
            borderRadius: "16px",
            fontFamily: "var(--aacp-font)",
            transition: "all 0.2s",
          }}
          onFocus={(e) => {
            (e.target as HTMLInputElement).style.borderColor = "var(--aacp-line-strong)";
            (e.target as HTMLInputElement).style.background = "rgba(255, 255, 255, 0.04)";
            (e.target as HTMLInputElement).style.boxShadow = "0 0 0 3px color-mix(in srgb, var(--aacp-fg) 8%, transparent)";
          }}
          onBlur={(e) => {
            (e.target as HTMLInputElement).style.borderColor = "var(--aacp-line-strong)";
            (e.target as HTMLInputElement).style.background = "rgba(255, 255, 255, 0.04)";
            (e.target as HTMLInputElement).style.boxShadow = "none";
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "12px",
            background: "var(--aacp-grad-primary)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.2s",
            flexShrink: 0,
            boxShadow: "0 6px 16px var(--aacp-accent-shadow-strong)",
            border: "none",
            cursor: "pointer",
            fontSize: "16px",
            fontWeight: 600,
            opacity: !input.trim() || isLoading ? 0.4 : 1,
          }}
          onMouseEnter={(e) => {
            if (!(!input.trim() || isLoading)) {
              (e.target as HTMLButtonElement).style.transform = "translateY(-1px) scale(1.03)";
            }
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.transform = "none";
          }}
        >
          ↑
        </button>
      </form>
    </div>
  );
}
