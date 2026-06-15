import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import type { UserPanelModel } from "../models/user-panel.model.js";

export function selectUserPanelModel(vm: CheckoutAgentViewModel): UserPanelModel | null {
  if (!vm.userPanelOpen || !vm.auth.session?.global_user_id) return null;

  const hub = vm.buyerHub;
  const displayName =
    hub.profile?.display_name || vm.activeExperience?.customer?.fullName || "Cliente";
  const email =
    hub.profile?.email ||
    vm.auth.session?.email ||
    vm.activeExperience?.customer?.email ||
    "";

  return {
    activeTab: vm.userTab,
    displayName,
    email,
    avatarLetter: displayName[0]?.toUpperCase() ?? "C",
    colorMode: vm.colorMode,
    buyerHub: hub,
    auth: vm.auth,
    activeExperience: vm.activeExperience,
    onClose: () => vm.setUserPanelOpen(false),
    onSelectTab: vm.setUserTab,
    onToggleColorMode: vm.toggleColorMode,
  };
}
