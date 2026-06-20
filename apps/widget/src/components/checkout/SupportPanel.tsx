import React, { useRef, useEffect, useState } from "react";
import { X, Send, Sparkles, ShieldCheck, Truck, CreditCard, Package, Headphones, ArrowRight, ArrowLeft, MessageCircle } from "lucide-react";
import type { SupportFaqItem } from "@aacp/shared-types";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { useSupportChat } from "../../hooks/use-support-chat.js";
import { useSupportFaq } from "../../hooks/use-support-faq.js";
import { selectSupportPanelModel } from "../../presentation/selectors/support-panel.selector.js";
import type { SupportPanelModel } from "../../presentation/models/support-panel.model.js";

const DEFAULT_SUGGESTIONS = [
  { icon: <Truck size={14} />, label: "Qual o prazo de entrega?" },
  { icon: <CreditCard size={14} />, label: "Quais formas de pagamento?" },
  { icon: <ShieldCheck size={14} />, label: "É seguro comprar aqui?" },
  { icon: <Package size={14} />, label: "Posso trocar ou devolver?" },
  { icon: <Sparkles size={14} />, label: "Preciso de ajuda com meu pedido" },
];

export function SupportPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  const model = selectSupportPanelModel(vm);
  return <SupportPanelView model={model} />;
}

function SupportPanelView({ model }: { model: SupportPanelModel }) {
  const [input, setInput] = useState("");
  const [inputReady, setInputReady] = useState(true);
  const [selectedFaq, setSelectedFaq] = useState<SupportFaqItem | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const chat = useSupportChat({
    apiBaseUrl: model.apiOrigin,
    merchantId: model.merchantId,
    sessionId: model.sessionId,
    embedToken: model.embedToken,
  });

  const faq = useSupportFaq(model.apiOrigin, model.merchantId, model.open, model.embedToken);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [chat.messages]);

  useEffect(() => {
    if (chat.loading) {
      setInputReady(false);
      return;
    }
    const t = setTimeout(() => {
      setInputReady(true);
      inputRef.current?.focus();
    }, 1000);
    return () => clearTimeout(t);
  }, [chat.loading]);

  useEffect(() => {
    if (!model.open) {
      setInput("");
      setSelectedFaq(null);
      chat.reset();
    }
  }, [model.open]);

  const handleSend = (text: string) => {
    if (!text.trim() || chat.loading) return;
    setInput("");
    setSelectedFaq(null);
    void chat.send(text);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(input);
  };

  const handleFaqClick = (item: SupportFaqItem) => {
    setSelectedFaq(item);
  };

  const handleEscalateToAI = () => {
    if (selectedFaq) {
      handleSend(selectedFaq.question);
    }
  };

  const brandName = model.brandName;
  const hasMessages = chat.messages.length > 0;
  const hasMerchantFaq = faq.items.length > 0;

  const faqCards = hasMerchantFaq
    ? faq.items.map((item) => ({
        icon: <MessageCircle size={14} />,
        label: item.question,
        item,
      }))
    : DEFAULT_SUGGESTIONS.map((s) => ({ ...s, item: null }));

  return (
    <>
      <div
        className={model.open ? "aacp-support-backdrop open" : "aacp-support-backdrop"}
        onClick={model.onClose}
      />
      <aside
        id="aacp-support-panel"
        className={`aacp-ai-panel ${model.open ? "open" : ""}`}
        aria-label="Central de ajuda"
        aria-hidden={!model.open}
      >
        {/* Header */}
        <div className="aacp-ai-head">
          {(hasMessages || selectedFaq) && (
            <button
              className="aacp-ai-close"
              onClick={() => { setSelectedFaq(null); chat.reset(); setInput(""); }}
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
          <button
            className="aacp-ai-close"
            onClick={model.onClose}
            aria-label="Fechar suporte"
          >
            <X size={18} />
          </button>
        </div>

        {/* Thread / Body */}
        <div className="aacp-ai-thread" ref={threadRef}>
          {selectedFaq ? (
            /* FAQ answer view */
            <div className="aacp-ai-welcome-section">
              <div className="aacp-ai-welcome-avatar">
                <ShieldCheck size={24} />
              </div>
              <h3 className="aacp-ai-welcome-title" style={{ fontSize: "0.95rem" }}>
                {selectedFaq.question}
              </h3>
              <p className="aacp-ai-welcome-desc" style={{ textAlign: "left", fontSize: "0.9rem" }}>
                {selectedFaq.answer}
              </p>
              <button
                className="aacp-ai-faq-card"
                style={{ marginTop: 12, width: "100%" }}
                onClick={handleEscalateToAI}
                disabled={chat.loading}
              >
                <span className="aacp-ai-faq-icon"><MessageCircle size={14} /></span>
                <span className="aacp-ai-faq-label">Isso não respondeu minha dúvida</span>
                <ArrowRight size={12} className="aacp-ai-faq-arrow" />
              </button>
              <div className="aacp-ai-trust-footer" style={{ marginTop: 12 }}>
                <ShieldCheck size={12} />
                <span>Respostas verificadas · Atendimento humano disponível</span>
              </div>
            </div>
          ) : !hasMessages ? (
            /* Welcome / FAQ list view */
            <div className="aacp-ai-welcome-section">
              <div className="aacp-ai-welcome-avatar">
                <Sparkles size={24} />
              </div>
              <h3 className="aacp-ai-welcome-title">Olá! Sou o assistente de suporte.</h3>
              <p className="aacp-ai-welcome-desc">
                Posso te ajudar com dúvidas sobre entrega, pagamento, segurança e muito mais. Escolha uma opção abaixo ou envie sua pergunta.
              </p>

              <div className="aacp-ai-faq-grid">
                {faqCards.map((s) => (
                  <button
                    key={s.label}
                    className="aacp-ai-faq-card"
                    disabled={chat.loading || (hasMerchantFaq && faq.loading)}
                    onClick={() => s.item ? handleFaqClick(s.item) : handleSend(s.label)}
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
            /* Chat thread view */
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
              {chat.handoffPending && chat.latestTicketId && (
                <div className="aacp-support-ticket-note" role="status">
                  Chamado aberto: {chat.latestTicketId}
                </div>
              )}
            </>
          )}
        </div>

        {/* Composer */}
        <div className="aacp-ai-footer">
          <form className="aacp-ai-composer" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              className="aacp-input"
              aria-label="Mensagem para o suporte"
              placeholder="Digite sua dúvida aqui..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!inputReady}
              style={{
                opacity: inputReady ? 1 : 0,
                pointerEvents: inputReady ? "auto" : "none",
                transform: inputReady ? "translateY(0)" : "translateY(4px)",
                transition: "opacity 0.2s ease, transform 0.2s ease",
              }}
            />
            <button
              type="submit"
              className="aacp-send"
              disabled={!input.trim() || chat.loading}
              aria-label="Enviar mensagem ao suporte"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
