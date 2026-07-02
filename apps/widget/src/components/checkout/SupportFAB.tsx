import React from "react";
import { MessageSquare, X, Sparkles } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { selectSupportFabModel } from "../../presentation/selectors/support-fab.selector.js";
import type { SupportFabModel } from "../../presentation/models/support-fab.model.js";

export function SupportFAB({ vm }: { vm: CheckoutAgentViewModel }) {
  const model = selectSupportFabModel(vm);
  return <SupportFABView model={model} />;
}

export function SupportFABView({ model }: { model: SupportFabModel }) {
  const [showTooltip, setShowTooltip] = React.useState(true);

  React.useEffect(() => {
    const timer = setTimeout(() => setShowTooltip(false), 8000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="zyon-fab-container">
      {showTooltip && !model.supportOpen ? (
        <div className="zyon-fab-tooltip">
          <Sparkles size={12} className="text-purple-400" />
          <span>Precisa de ajuda com o pedido?</span>
          <button type="button" onClick={() => setShowTooltip(false)}>
            <X size={10} />
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className={`zyon-fab${model.supportOpen ? " active" : ""}`}
        onClick={model.onToggle}
        aria-label={model.supportOpen ? "Fechar suporte" : "Abrir suporte"}
      >
        {model.supportOpen ? <X size={24} /> : <MessageSquare size={24} />}
      </button>
    </div>
  );
}
