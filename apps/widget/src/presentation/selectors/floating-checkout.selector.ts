import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { themeStyle } from "../../hooks/checkout-presentation.js";
import type { FloatingCheckoutModel } from "../models/floating-checkout.model.js";

export function selectFloatingCheckoutModel(vm: CheckoutAgentViewModel): FloatingCheckoutModel {
  return {
    open: vm.open,
    colorMode: vm.colorMode,
    style: themeStyle(vm.theme, false, vm.colorMode),
    theme: vm.theme,
    themeStudio: vm.themeStudio,
    sessionLabel: vm.session?.global_user_id
      ? `Cliente ${vm.session.global_user_id.slice(0, 12)}`
      : "Conectando a API...",
    turns: vm.turns.map((turn) => ({
      role: turn.role,
      text: turn.text,
      occurredAt: turn.occurredAt,
    })),
    message: vm.message,
    busy: vm.busy,
    composerDisabled: vm.busy || Boolean(vm.networkError),
    onToggleOpen: vm.setOpen,
    onMessageChange: vm.setMessage,
    onSend: () => vm.sendMessage(),
  };
}
