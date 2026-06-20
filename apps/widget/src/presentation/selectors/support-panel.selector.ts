import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import type { SupportPanelModel } from "../models/support-panel.model.js";

export function selectSupportPanelModel(vm: CheckoutAgentViewModel): SupportPanelModel {
  return {
    open: vm.supportOpen,
    apiOrigin: vm.apiOrigin,
    merchantId: vm.config.merchantId,
    sessionId: vm.session?.session_id,
    embedToken: vm.config.embedSessionToken,
    brandName: vm.activeExperience?.brand?.name || "a loja",
    onClose: () => vm.setSupportOpen(false),
  };
}
