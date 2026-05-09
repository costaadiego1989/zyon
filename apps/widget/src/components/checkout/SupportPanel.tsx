import React, { useState, useRef, useEffect } from "react";
import { X, Send, Sparkles, ShieldCheck, Truck, CreditCard, Package, Headphones, ArrowRight } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";

interface MockMessage {
  role: "user" | "assistant";
  text: string;
}

const FAQ_ANSWERS: Record<string, string> = {
  "Qual o prazo de entrega?":
    "O prazo de entrega varia conforme sua região e a modalidade escolhida. Com PAC, o prazo médio é de 5 a 8 dias úteis; com SEDEX, de 2 a 3 dias úteis. Após a confirmação do pagamento, o produto é enviado em até 24h.",
  "Quais formas de pagamento?":
    "Aceitamos PIX (com aprovação instantânea), cartão de crédito (em até 12x sem juros, dependendo do valor) e boleto bancário (com prazo de compensação de 1 a 3 dias úteis).",
  "É seguro comprar aqui?":
    "Sim! Sua compra é protegida com criptografia SSL de 256 bits. Não armazenamos dados de cartão — todas as transações são processadas por gateways certificados PCI-DSS. Você também conta com nossa política de devolução em até 7 dias.",
  "Posso trocar ou devolver?":
    "Claro! Você tem até 7 dias corridos após o recebimento para solicitar a troca ou devolução do produto. Basta entrar em contato conosco que enviaremos a etiqueta de postagem sem custo.",
  "Tem desconto disponível?":
    "Nosso agente de vendas pode verificar se há ofertas especiais para o seu pedido. Volte ao chat principal e pergunte sobre promoções — nosso sistema de ofertas é personalizado para cada compra!"
};

const SUGGESTIONS = [
  { icon: <Truck size={14} />, label: "Qual o prazo de entrega?" },
  { icon: <CreditCard size={14} />, label: "Quais formas de pagamento?" },
  { icon: <ShieldCheck size={14} />, label: "É seguro comprar aqui?" },
  { icon: <Package size={14} />, label: "Posso trocar ou devolver?" },
  { icon: <Sparkles size={14} />, label: "Tem desconto disponível?" }
];

export function SupportPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  const [messages, setMessages] = useState<MockMessage[]>([]);
  const [input, setInput] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  // No conditional return here so the panel can animate out

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    const userMsg: MockMessage = { role: "user", text: text.trim() };
    const answer = FAQ_ANSWERS[text.trim()] || `Entendi sua dúvida sobre "${text.trim()}". Para uma resposta mais detalhada, recomendo falar com nosso agente no chat principal. Ele pode te ajudar em tempo real!`;
    const assistantMsg: MockMessage = { role: "assistant", text: answer };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(input);
  };

  const brandName = vm.activeExperience?.brand?.name || "a loja";
  const hasMessages = messages.length > 0;

  return (
    <>
      <div 
        className={vm.supportOpen ? "aacp-support-backdrop open" : "aacp-support-backdrop"} 
        onClick={() => vm.setSupportOpen(false)} 
      />
      <aside className={`aacp-ai-panel ${vm.supportOpen ? "open" : ""}`}>
        {/* Header */}
        <div className="aacp-ai-head">
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
              <h3 className="aacp-ai-welcome-title">
                Olá! Sou o assistente de suporte.
              </h3>
              <p className="aacp-ai-welcome-desc">
                Posso te ajudar com dúvidas sobre entrega, pagamento, segurança e muito mais. Escolha uma opção abaixo ou envie sua pergunta.
              </p>

              <div className="aacp-ai-faq-grid">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    className="aacp-ai-faq-card"
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
            messages.map((msg, i) => (
              <div
                key={i}
                className={`aacp-bubble aacp-bubble-${msg.role === "user" ? "buyer" : "agent"}`}
              >
                {msg.text}
              </div>
            ))
          )}
        </div>

        {/* Composer */}
        <div className="aacp-ai-footer">
          <form className="aacp-ai-composer" onSubmit={handleSubmit}>
            <input
              className="aacp-input"
              placeholder="Digite sua dúvida aqui..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              className="aacp-send"
              disabled={!input.trim()}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
