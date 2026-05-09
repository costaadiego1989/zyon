import React from "react";
import { X, Send, Sparkles, MessageCircle } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";

export function SupportPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.supportOpen) return null;

  return (
    <>
      <div className="aacp-side-backdrop" onClick={() => vm.setSupportOpen(false)} />
      <aside className="aacp-ai-panel">
        <div className="aacp-ai-head">
          <div className="aacp-ai-brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="aacp-ai-avatar">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="aacp-ai-title">Assistência Especializada</div>
              <div className="aacp-ai-sub">
                <span className="live-dot" /> Sempre online
              </div>
            </div>
          </div>
          <button className="aacp-ai-close" onClick={() => vm.setSupportOpen(false)} style={{ marginLeft: 'auto' }}>
            <X size={20} />
          </button>
        </div>

        <div className="aacp-ai-body">
          <div className="aacp-ai-welcome">
            <h3>Olá! Como posso te ajudar?</h3>
            <p>Sou o assistente de suporte da {vm.activeExperience?.brand?.name}. Posso tirar dúvidas sobre entrega, pagamentos ou produtos.</p>

            <div className="aacp-ai-suggestions">
              {["Qual o prazo de entrega?", "Quais formas de pagamento?", "É seguro comprar aqui?"].map(s => (
                <button key={s} className="aacp-ai-suggest">{s}</button>
              ))}
            </div>
          </div>

          <div className="aacp-ai-empty">
            <MessageCircle size={32} strokeWidth={1.5} />
            <p>Envie uma mensagem para começar...</p>
          </div>
        </div>

        <div className="aacp-ai-footer">
          <div className="aacp-ai-composer">
            <input placeholder="Digite sua dúvida aqui..." />
            <button className="aacp-ai-send"><Send size={18} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}
