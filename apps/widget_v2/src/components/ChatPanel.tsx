import { useState, useRef, useEffect } from "react";
import { useCheckoutStore } from "@/store/checkout-store";
import { AgentAvatar } from "./AgentAvatar";
import { PulseAgentOrb } from "./PulseAgentOrb";
import type { ChatBlock } from "@/api/checkout-session";

function translateShippingLabel(label: string): string {
  const translations: Record<string, string> = {
    own_delivery_flat: "Entrega própria",
    own_delivery: "Entrega própria",
    correios_pac: "PAC",
    correios_sedex: "Sedex",
    jadlog_package: "Jadlog",
    free_shipping: "Frete grátis",
  };
  if (label.includes("_")) {
    return translations[label] ?? label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return label;
}

/* ─── Block Renderers ─── */

function CartSummaryBlock({ data }: { data?: Record<string, unknown> }) {
  if (!data) return null;
  const items = (data.items as Array<{ name: string; qty?: number; quantity?: number; total?: string; price?: number }>) ?? [];
  const total = data.total as number | undefined;
  const discount = data.discount as number | undefined;

  const formatPrice = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>Resumo do carrinho</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--mut)", padding: "4px 0" }}>
          <span>{item.name} x{item.qty ?? item.quantity ?? 1}</span>
          <span>{item.total ?? (item.price != null ? formatPrice(item.price) : "")}</span>
        </div>
      ))}
      {discount != null && discount > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--aacp-accent, #0f766e)", padding: "4px 0" }}>
          <span>Desconto</span>
          <span>-{formatPrice(discount)}</span>
        </div>
      )}
      {total != null && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: 600, borderTop: "1px solid var(--bd)", paddingTop: "8px", marginTop: "8px" }}>
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      )}
    </div>
  );
}

function ShippingOptionsBlock({ options }: { options?: unknown }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const selectShipping = useCheckoutStore((s) => s.selectShipping);
  const opts = (options as Array<{ key: string; label: string; tag?: string; sub?: string; cost?: number }>) ?? [];

  const handleSelect = async (opt: (typeof opts)[0]) => {
    await selectShipping(opt.key);
    void sendMessage(`Entrega · ${translateShippingLabel(opt.label)}`);
  };

  const formatPrice = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>Escolha o frete:</div>
      {opts.map((opt) => (
        <button
          key={opt.key}
          onClick={() => void handleSelect(opt)}
          style={{
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            cursor: "pointer",
            textAlign: "left",
            fontSize: "13px",
          }}
        >
          <div style={{ fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
            <span>{translateShippingLabel(opt.label)}</span>
            <span style={{ fontSize: "12px", color: "var(--aacp-accent, #0f766e)" }}>
              {opt.cost === 0 ? "Grátis" : opt.cost != null ? formatPrice(opt.cost / 100) : ""}
            </span>
          </div>
          {opt.sub && <div style={{ fontSize: "11px", color: "var(--mut)", marginTop: "2px" }}>{opt.sub}</div>}
        </button>
      ))}
    </div>
  );
}

function PaymentMethodsBlock({ methods }: { methods?: unknown }) {
  const pay = useCheckoutStore((s) => s.pay);
  const meths = (methods as Array<{ key: string; label: string; sub?: string }>) ?? [];

  const handleSelect = (method: (typeof meths)[0]) => {
    void pay(method.key as "pix" | "credito" | "debito" | "crypto");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>Forma de pagamento:</div>
      {meths.map((m) => (
        <button
          key={m.key}
          onClick={() => handleSelect(m)}
          style={{
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            cursor: "pointer",
            textAlign: "left",
            fontSize: "13px",
          }}
        >
          <div style={{ fontWeight: 600 }}>{m.label}</div>
          {m.sub && <div style={{ fontSize: "11px", color: "var(--mut)" }}>{m.sub}</div>}
        </button>
      ))}
    </div>
  );
}

function PixPaymentBlock({ data }: { data?: Record<string, unknown> }) {
  const pollPayment = useCheckoutStore((s) => s.pollPayment);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    pollPayment();
  }, [pollPayment]);

  if (!data) return null;

  const handleCopy = async () => {
    const code = String(data.pix_code ?? "");
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for iframe/insecure context
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>Pague com Pix</div>
      <p style={{ fontSize: "12px", color: "var(--mut)", margin: "0 0 8px", lineHeight: 1.4 }}>
        Escaneie o QR Code no app do seu banco. Pedido confirmado assim que o pagamento cai.
      </p>
      {data.pix_qr_url ? (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "10px" }}>
          <img src={String(data.pix_qr_url)} alt="QR Code Pix" style={{ width: "160px", height: "160px", borderRadius: "8px" }} />
        </div>
      ) : null}
      {data.pix_code != null && (
        <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
          <code style={{ flex: 1, minWidth: 0, background: "var(--chip, var(--card))", padding: "8px 10px", borderRadius: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", fontFamily: "var(--aacp-font, inherit)" }}>
            {String(data.pix_code).slice(0, 50)}...
          </code>
          <button
            onClick={handleCopy}
            style={{ padding: "8px 14px", borderRadius: "8px", background: "var(--aacp-accent, #0f766e)", color: "#fff", border: "none", fontSize: "13px", fontWeight: 600, fontFamily: "var(--aacp-font, inherit)", cursor: "pointer", flex: "none", transition: "opacity 0.2s" }}
          >
            {copied ? "✓ Copiado" : "Copiar Pix"}
          </button>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "16px" }}>
        <PulseAgentOrb placement="chatLoading" active />
        <p style={{ fontSize: "13px", color: "var(--mut)", margin: 0, textAlign: "center" }}>
          Aguardando pagamento...
        </p>
      </div>
    </div>
  );
}

function OrderConfirmationBlock({ data }: { data?: Record<string, unknown> }) {
  if (!data) return null;
  return (
    <div style={{ padding: "16px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--aacp-accent, #0f766e)", textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
        <div style={{ animation: "bounce 0.6s ease infinite alternate" }}>
          <PulseAgentOrb placement="chatBubble" active />
        </div>
      </div>
      <div style={{ fontSize: "28px", marginBottom: "6px" }}>✓</div>
      <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--tx)" }}>
        {(data.title as string) || "Pedido confirmado!"}
      </div>
      {data.order_id ? (
        <div style={{ fontSize: "12px", color: "var(--mut)", marginTop: "4px" }}>
          Pedido #{String(data.order_id)}
        </div>
      ) : null}
      {data.message ? (
        <div style={{ fontSize: "13px", color: "var(--mut)", marginTop: "8px", lineHeight: 1.4 }}>
          {String(data.message)}
        </div>
      ) : null}
    </div>
  );
}

function CrossSellBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  if (!data) return null;
  const products = (data.products as Array<{ name: string; price?: number }>) ?? [];
  const formatPrice = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>Você também pode gostar:</div>
      {products.map((p, i) => (
        <button
          key={i}
          onClick={() => void sendMessage(`Adicionar ${p.name}`)}
          style={{ display: "flex", justifyContent: "space-between", width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--bd)", background: "transparent", color: "var(--tx)", cursor: "pointer", fontSize: "12px", marginBottom: "6px", textAlign: "left" }}
        >
          <span>{p.name}</span>
          {p.price != null && <span style={{ color: "var(--aacp-accent, #0f766e)", fontWeight: 600 }}>{formatPrice(p.price)}</span>}
        </button>
      ))}
    </div>
  );
}

function OfferCouponBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  if (!data) return null;
  const code = (data.code as string) || "";
  const description = (data.description as string) || "";

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--aacp-accent, #0f766e)" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "4px", color: "var(--aacp-accent, #0f766e)" }}>Cupom disponivel</div>
      {description && <div style={{ fontSize: "12px", color: "var(--mut)", marginBottom: "6px" }}>{description}</div>}
      <button
        onClick={() => void sendMessage(`Aplicar cupom ${code}`)}
        style={{ padding: "8px 14px", borderRadius: "8px", background: "var(--aacp-accent, #0f766e)", color: "#fff", border: "none", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
      >
        Aplicar {code}
      </button>
    </div>
  );
}

function AddressConfirmationBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  if (!data) return null;
  const formatted = (data.formatted as string) || "";

  const handleYes = () => {
    void sendMessage("Sim");
  };

  const handleNo = () => {
    void sendMessage("Não");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {formatted && (
        <div style={{ padding: "10px 12px", borderRadius: "8px", background: "var(--chip)", fontSize: "13px", color: "var(--tx)" }}>
          {formatted}
        </div>
      )}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={handleYes}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: "8px",
            border: "none",
            background: "var(--aacp-accent, #0f766e)",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sim
        </button>
        <button
          onClick={handleNo}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Não
        </button>
      </div>
    </div>
  );
}

function FormFieldBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const [value, setValue] = useState("");
  if (!data) return null;
  const label = (data.label as string) || (data.field as string) || "";
  const placeholder = (data.placeholder as string) || "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      void sendMessage(value.trim());
      setValue("");
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {label && <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>{label}</label>}
      <div style={{ display: "flex", gap: "6px" }}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--bd)", background: "var(--chip)", color: "var(--tx)", fontSize: "13px", fontFamily: "inherit" }}
        />
        <button
          type="submit"
          disabled={!value.trim()}
          style={{ padding: "8px 12px", borderRadius: "8px", background: value.trim() ? "var(--aacp-accent, #0f766e)" : "var(--bd)", color: "#fff", border: "none", fontSize: "12px", fontWeight: 600, cursor: value.trim() ? "pointer" : "not-allowed" }}
        >
          Enviar
        </button>
      </div>
    </form>
  );
}

function BlockRenderer({ block }: { block: ChatBlock }) {
  switch (block.type) {
    case "text":
    case "message":
      return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{String(block.data?.content || block.text || "")}</p>;
    case "cart_summary":
      return <CartSummaryBlock data={block.data} />;
    case "address_confirmation":
      return <AddressConfirmationBlock data={block.data} />;
    case "shipping_options":
      return <ShippingOptionsBlock options={block.data?.options} />;
    case "payment_methods":
      return <PaymentMethodsBlock methods={block.data?.methods} />;
    case "pix_payment":
      return <PixPaymentBlock data={block.data} />;
    case "order_confirmation":
      return <OrderConfirmationBlock data={block.data} />;
    case "order_summary":
      return <CartSummaryBlock data={block.data} />;
    case "cross_sell":
      return <CrossSellBlock data={block.data} />;
    case "offer_coupon":
      return <OfferCouponBlock data={block.data} />;
    case "form_field":
      return <FormFieldBlock data={block.data} />;
    default:
      // Fallback: render text content if available
      if (block.text) return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{block.text}</p>;
      if (block.data?.text || block.data?.content) return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{String(block.data.text || block.data.content)}</p>;
      return null;
  }
}

/* ─── Main ChatPanel Component ─── */

export function ChatPanel() {
  const messages = useCheckoutStore((s) => s.messages);
  const isTyping = useCheckoutStore((s) => s.isTyping);
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    void sendMessage(input.trim());
    setInput("");
  };

  const handleQuickReply = (text: string) => {
    void sendMessage(text);
  };

  // Find quick replies from the last agent message
  const lastAgentMsg = [...messages].reverse().find((m) => m.role === "agent");
  const activeQuickReplies = lastAgentMsg?.quickReplies ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Messages area */}
      <div
        style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}
        role="log"
        aria-label="Mensagens do chat"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "8px",
              width: "100%",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
            }}
          >
            {msg.role === "agent" && (
              <AgentAvatar active />
            )}

            <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
              {msg.text && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                    background: msg.role === "user" ? "var(--aacp-accent, #0f766e)" : "var(--card)",
                    color: msg.role === "user" ? "#fff" : "var(--tx)",
                    fontSize: "13px",
                    lineHeight: 1.5,
                    wordBreak: "break-word",
                    border: msg.role === "agent" ? "1px solid var(--bd)" : "none",
                  }}
                >
                  {msg.text}
                </div>
              )}
              {msg.blocks?.map((block, j) => (
                <div key={j} style={{ padding: "10px 12px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--bd)" }}>
                  <BlockRenderer block={block} />
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Quick Replies — rendered below last agent message */}
        {activeQuickReplies.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingLeft: "36px" }}>
            {activeQuickReplies.map((qr) => (
              <button
                key={qr}
                onClick={() => handleQuickReply(qr)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "20px",
                  border: "1px solid var(--bd)",
                  background: "var(--chip)",
                  color: "var(--tx)",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--aacp-accent, #0f766e)";
                  e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent, #0f766e) 10%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--bd)";
                  e.currentTarget.style.background = "var(--chip)";
                }}
              >
                {qr}
              </button>
            ))}
          </div>
        )}

        {isTyping && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <AgentAvatar active />
            <div style={{ padding: "10px 12px", borderRadius: "12px", background: "var(--card)", color: "var(--mut)", border: "1px solid var(--bd)" }}>
              <span style={{ animation: "dot-pulse 1.2s infinite" }}>●</span>
              <span style={{ animation: "dot-pulse 1.2s infinite", animationDelay: "0.2s" }}>●</span>
              <span style={{ animation: "dot-pulse 1.2s infinite", animationDelay: "0.4s" }}>●</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: "8px",
          flexShrink: 0,
          padding: "10px 0 0",
          borderTop: "1px solid var(--bd)",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua mensagem..."
          aria-label="Mensagem"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            fontSize: "13px",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          aria-label="Enviar mensagem"
          style={{
            padding: "10px 16px",
            borderRadius: "10px",
            background: input.trim() ? "var(--aacp-accent, #0f766e)" : "var(--bd)",
            color: "#fff",
            border: "none",
            fontSize: "12px",
            fontWeight: 600,
            cursor: input.trim() ? "pointer" : "not-allowed",
            flex: "none",
          }}
        >
          Enviar
        </button>
      </form>

      <style>{`
        @keyframes bubble-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes dot-pulse { 0%,80%,100% { opacity: .3; } 40% { opacity: 1; } }
        @keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-8px); } }
      `}</style>
    </div>
  );
}
