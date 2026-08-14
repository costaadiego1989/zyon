"use client";

import { useCallback, useRef, useState } from "react";
import ProductCard from "./ProductCard";

type Message = {
  id: string;
  role: "user" | "agent";
  text: string;
};

type Product = {
  id: string;
  name: string;
  price: number;
  image?: string;
};

export default function ConversationShell({ storeName }: { storeName: string }) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "agent",
      text: `Olá! Eu sou o assistente da ${storeName}. Como posso ajudar hoje?`,
    },
  ]);
  const [input, setInput] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
  };

  const sendMessage = useCallback(
    async (text: string) => {
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

      const ack: Message = {
        id: `a-${Date.now()}`,
        role: "agent",
        text: `Recebemos sua mensagem: "${trimmed}"`,
      };
      setMessages((prev) => [...prev, ack]);
      scrollToBottom();
    },
    [],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    const base =
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
    try {
      const res = await fetch(`${base}/merchants/me/products`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { products?: Product[] };
        setProducts((data.products ?? []).slice(0, 6));
      } else {
        setProducts([]);
      }
    } catch {
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  const handleQuickReply = (label: string) => {
    if (label === "Ver produtos") {
      const userMsg: Message = {
        id: `u-${Date.now()}`,
        role: "user",
        text: label,
      };
      setMessages((prev) => [...prev, userMsg]);
      scrollToBottom();
      void fetchProducts();
    } else {
      void sendMessage(label);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          padding: "14px 20px",
          borderRadius: 999,
          border: "none",
          background: "var(--color-primary)",
          color: "#fff",
          fontWeight: 600,
          boxShadow: "var(--shadow-md)",
          zIndex: 50,
        }}
      >
        💬 Conversar
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Chat com assistente"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: "min(380px, calc(100vw - 32px))",
        height: "min(560px, calc(100vh - 48px))",
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-md)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 50,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-soft)",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "var(--color-primary)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
          }}
        >
          🤖
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{storeName}</div>
          <div
            style={{
              fontSize: 12,
              color: "var(--color-fg-soft)",
            }}
          >
            Assistente online
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Fechar chat"
          style={{
            background: "transparent",
            border: "none",
            fontSize: 18,
            color: "var(--color-fg-soft)",
            padding: 4,
          }}
        >
          ✕
        </button>
      </header>

      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          background: "var(--color-bg)",
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "10px 12px",
                borderRadius: 12,
                background:
                  m.role === "user"
                    ? "var(--color-primary)"
                    : "var(--color-bg-soft)",
                color: m.role === "user" ? "#fff" : "var(--color-fg)",
                fontSize: 14,
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {m.text}
            </div>
          </div>
        ))}

        {loadingProducts && (
          <div
            style={{
              fontSize: 12,
              color: "var(--color-muted)",
              textAlign: "center",
              padding: 8,
            }}
          >
            Carregando produtos…
          </div>
        )}

        {products.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 8,
              marginTop: 4,
            }}
          >
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}

        {messages.length === 1 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 4,
            }}
          >
            <button
              type="button"
              onClick={() => handleQuickReply("Ver produtos")}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                fontSize: 13,
                color: "var(--color-fg)",
              }}
            >
              Ver produtos
            </button>
            <button
              type="button"
              onClick={() => handleQuickReply("Falar com humano")}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                fontSize: 13,
                color: "var(--color-fg)",
              }}
            >
              Falar com humano
            </button>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: 8,
          padding: 12,
          borderTop: "1px solid var(--color-border)",
          background: "var(--color-bg-soft)",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua mensagem…"
          aria-label="Mensagem"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg)",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--color-primary)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            opacity: input.trim() ? 1 : 0.5,
            cursor: input.trim() ? "pointer" : "not-allowed",
          }}
        >
          Enviar
        </button>
      </form>
    </div>
  );
}