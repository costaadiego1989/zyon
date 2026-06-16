import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import type { SupportFabModel } from "../models/support-fab.model.js";

export function selectSupportFabModel(vm: CheckoutAgentViewModel): SupportFabModel {
  return {
    supportOpen: vm.supportOpen,
    onToggle: () => vm.setSupportOpen(!vm.supportOpen),
  };
}
