import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn } from "../../hooks/checkout-presentation.js";
import { selectCartOverlayModel } from "../../presentation/selectors/cart-panel.selector.js";
import { selectPixWaitingModel } from "../../presentation/selectors/pix-waiting.selector.js";
import { CartPanel } from "../../components/checkout/CartPanel.js";
import { UserPanel } from "../../components/checkout/UserPanel.js";
import { PixWaitingPanel } from "../conversation/PixWaitingPanel.js";

type CheckoutExperienceShellProps = {
  vm: CheckoutAgentViewModel;
  className?: string;
};

export function CheckoutExperienceShell({ vm, className }: CheckoutExperienceShellProps) {
  const overlay = selectCartOverlayModel(vm);
  const pixWaiting = selectPixWaitingModel(vm);

  return (
    <>
      <CartPanel vm={vm} />
      <UserPanel vm={vm} />

      {pixWaiting ? <PixWaitingPanel model={pixWaiting} /> : null}

      <div
        className={cn("aacp-cart-overlay", overlay.open ? "open" : "", className)}
        onClick={overlay.onClose}
        aria-label="Fechar resumo do pedido"
      />
    </>
  );
}
