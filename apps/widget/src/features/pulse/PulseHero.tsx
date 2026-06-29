import { Check, Star, Tag, Truck } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";

type PulseAction = {
  key: string;
  variant: "find" | "coupon" | "shipping" | "checkout";
  label: string;
  prompt: string;
  icon: typeof Star;
};

const ACTIONS: PulseAction[] = [
  { key: "find", variant: "find", label: "Encontrar a melhor opção", prompt: "Quero ver a melhor opção para mim", icon: Star },
  { key: "coupon", variant: "coupon", label: "Aplicar cupom", prompt: "Tenho um cupom para aplicar", icon: Tag },
  { key: "shipping", variant: "shipping", label: "Calcular frete", prompt: "Quero calcular o frete", icon: Truck },
  { key: "checkout", variant: "checkout", label: "Finalizar compra", prompt: "Quero finalizar a compra agora", icon: Check },
];

/**
 * Pulse signature hero — gradient orb + headline + quick-action grid.
 * Shown only on the conversational empty state; each action sends a
 * deterministic PT-BR prompt through the existing chat pipeline. The agent
 * (never this component) decides what to do with it.
 */
export function PulseHero({ vm }: { vm: CheckoutAgentViewModel }) {
  const disabled = vm.busy;

  return (
    <section className="pulse-hero" aria-label="Comece sua compra com a Pulse">
      <div className="pulse-orb" aria-hidden="true">
        <span className="pulse-orb__halo" />
        <span className="pulse-orb__core" />
        <span className="pulse-orb__eyes">
          <span />
          <span />
        </span>
      </div>

      <h2 className="pulse-hero__title">
        IA que <span className="pulse-grad-text">vende.</span>
        <br />
        Você que <span className="pulse-grad-text">decide.</span>
      </h2>

      <p className="pulse-hero__lede">
        Oi, sou a Pulse. Ajudo você a achar a melhor opção, aplicar descontos,
        calcular o frete e fechar o pedido.
      </p>

      <div className="pulse-actions" role="group" aria-label="Ações rápidas">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.key}
              type="button"
              className={`pulse-action pulse-action--${action.variant}`}
              onClick={() => void vm.sendMessageWithOverride(action.prompt)}
              disabled={disabled}
            >
              <span className="pulse-action__icon" aria-hidden="true">
                <Icon size={14} strokeWidth={2} />
              </span>
              {action.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
