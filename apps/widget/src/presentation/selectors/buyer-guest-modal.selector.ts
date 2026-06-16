import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import type { BuyerGuestModalModel } from "../models/buyer-guest-modal.model.js";

export function selectBuyerGuestModalModel(vm: CheckoutAgentViewModel): BuyerGuestModalModel {
  const firstName = vm.activeExperience?.customer?.fullName?.split(" ")[0];
  const checkoutEmail = vm.activeExperience?.customer?.email;

  return {
    open: vm.buyerGuestModalOpen,
    firstName,
    checkoutEmail,
    emailConfirmed: vm.activeExperience?.customer?.email_verified === true,
    onClose: () => vm.setBuyerGuestModalOpen(false),
    onLogin: () => {
      vm.setBuyerGuestModalOpen(false);
      vm.auth.openLogin();
    },
  };
}
