import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn } from "../../hooks/checkout-presentation.js";
import { selectCartOverlayModel } from "../../presentation/selectors/cart-panel.selector.js";
import { CartPanel } from "../../components/checkout/CartPanel.js";
import { UserPanel } from "../../components/checkout/UserPanel.js";

type CheckoutExperienceShellProps = {
  vm: CheckoutAgentViewModel;
  className?: string;
};

export function CheckoutExperienceShell({ vm, className }: CheckoutExperienceShellProps) {
  const overlay = selectCartOverlayModel(vm);

  return (
    <>
      <CartPanel vm={vm} />
      <UserPanel vm={vm} />

      <div
        className={cn("aacp-cart-overlay", overlay.open ? "open" : "", className)}
        onClick={overlay.onClose}
        aria-label="Fechar resumo do pedido"
      />
    </>
  );
}
