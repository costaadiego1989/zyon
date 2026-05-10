import React, { useRef, useEffect, useState } from "react";
import { X, Send, Sparkles, ShieldCheck, Truck, CreditCard, Package, Headphones, ArrowRight, ArrowLeft } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { useSupportChat } from "../../hooks/use-support-chat.js";

const SUGGESTIONS = [
  { icon: <Truck size={14} />, label: "Qual o prazo de entrega?" },
  { icon: <CreditCard size={14} />, label: "Quais formas de pagamento?" },
  { icon: <ShieldCheck size={14} />, label: "É seguro comprar aqui?" },
  { icon: <Package size={14} />, label: "Posso trocar ou devolver?" },
  { icon: <Sparkles size={14} />, label: "Preciso de ajuda com meu pedido" },
];

export function SupportPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  const [input, setInput] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);

  const chat = useSupportChat({
    apiBaseUrl: vm.apiOrigin,
    merchantId: vm.config.merchantId,
    sessionId: vm.session?.session_id,
  });

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [chat.messages]);

  useEffect(() => {
    if (!vm.supportOpen) {
      setInput("");
      chat.reset();
    }
  }, [vm.supportOpen]);

  const handleSend = (text: string) => {
    if (!text.trim() || chat.loading) return;
    setInput("");
    void chat.send(text);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(input);
  };

  const brandName = vm.activeExperience?.brand?.name || "a loja";
  const hasMessages = chat.messages.length > 0;

  return (
    <>
      <div
        className={vm.supportOpen ? "aacp-support-backdrop open" : "aacp-support-backdrop"}
        onClick={() => vm.setSupportOpen(false)}
      />
      <aside className={`aacp-ai-panel ${vm.supportOpen ? "open" : ""}`}>
        {/* Header */}
        <div className="aacp-ai-head">
          {hasMessages && (
            <button
              className="aacp-ai-close"
              onClick={() => { chat.reset(); setInput(""); }}
              aria-label="Voltar"
              style={{ marginRight: 4 }}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
            <div className="aacp-ai-avatar">
              <Headphones size={18} />
            </div>
            <div>
              <div className="aacp-ai-title">Central de Ajuda</div>
              <div className="aacp-ai-sub">
                <span className="live-dot" /> {brandName} · suporte 24h
              </div>
            </div>
          </div>
          <button className="aacp-ai-close" onClick={() => vm.setSupportOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {/* Thread / Body */}
        <div className="aacp-ai-thread" ref={threadRef}>
          {!hasMessages ? (
            <div className="aacp-ai-welcome-section">
              <div className="aacp-ai-welcome-avatar">
                <Sparkles size={24} />
              </div>
              <h3 className="aacp-ai-welcome-title">Olá! Sou o assistente de suporte.</h3>
              <p className="aacp-ai-welcome-desc">
                Posso te ajudar com dúvidas sobre entrega, pagamento, segurança e muito mais. Escolha uma opção abaixo ou envie sua pergunta.
              </p>

              <div className="aacp-ai-faq-grid">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    className="aacp-ai-faq-card"
                    disabled={chat.loading}
                    onClick={() => handleSend(s.label)}
                  >
                    <span className="aacp-ai-faq-icon">{s.icon}</span>
                    <span className="aacp-ai-faq-label">{s.label}</span>
                    <ArrowRight size={12} className="aacp-ai-faq-arrow" />
                  </button>
                ))}
              </div>

              <div className="aacp-ai-trust-footer">
                <ShieldCheck size={12} />
                <span>Respostas verificadas · Atendimento humano disponível</span>
              </div>
            </div>
          ) : (
            <>
              {chat.messages.map((msg, i) => (
                <div
                  key={i}
                  className={`aacp-bubble aacp-bubble-${msg.role === "user" ? "buyer" : "agent"}`}
                >
                  {msg.text}
                </div>
              ))}
              {chat.loading && (
                <div className="aacp-bubble aacp-bubble-agent" style={{ opacity: 0.5 }}>
                  Digitando...
                </div>
              )}
            </>
          )}
        </div>

        {/* Composer */}
        <div className="aacp-ai-footer">
          <form className="aacp-ai-composer" onSubmit={handleSubmit}>
            <input
              className="aacp-input"
              placeholder="Digite sua dúvida aqui..."
              value={input}
              disabled={chat.loading}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className="aacp-send" disabled={!input.trim() || chat.loading}>
              <Send size={16} />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
