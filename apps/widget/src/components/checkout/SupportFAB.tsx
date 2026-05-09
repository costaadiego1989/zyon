import React from "react";
import { MessageSquare, X, Sparkles } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";

export function SupportFAB({ vm }: { vm: CheckoutAgentViewModel }) {
  const [showTooltip, setShowTooltip] = React.useState(true);

  React.useEffect(() => {
    const timer = setTimeout(() => setShowTooltip(false), 8000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="aacp-fab-container">
      {showTooltip && (
        <div className="aacp-fab-tooltip">
          <Sparkles size={12} className="text-purple-400" />
          <span>Precisa de ajuda com o pedido?</span>
          <button onClick={() => setShowTooltip(false)}><X size={10} /></button>
        </div>
      )}
      <button 
        className="aacp-fab" 
        onClick={() => vm.setSupportOpen(true)}
        aria-label="Suporte AI"
      >
        <div className="aacp-fab-pulse" />
        <MessageSquare size={24} />
      </button>
    </div>
  );
}
