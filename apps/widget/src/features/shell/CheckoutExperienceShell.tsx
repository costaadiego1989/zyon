import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn } from "../../hooks/checkout-view-model.js";
import { CartPanel } from "../../components/checkout/CartPanel.js";
import { UserPanel } from "../../components/checkout/UserPanel.js";

type CheckoutExperienceShellProps = {
  vm: CheckoutAgentViewModel;
  className?: string;
};

export function CheckoutExperienceShell({ vm, className }: CheckoutExperienceShellProps) {
  return (
    <>
      <CartPanel vm={vm} />
      <UserPanel vm={vm} />

      <div
        className={cn("aacp-cart-overlay", vm.cartOpen ? "open" : "", className)}
        onClick={() => vm.setCartOpen(false)}
        aria-label="Fechar resumo do pedido"
      />
    </>
  );
}
