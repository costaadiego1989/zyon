import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import type { ChannelWelcomeModel } from "../models/channel-welcome.model.js";

export function selectChannelWelcomeModel(vm: CheckoutAgentViewModel): ChannelWelcomeModel {
  const configuredAgentName = vm.theme.agentName || vm.activeExperience.agent.name;

  return {
    visible: vm.showChannelWelcome,
    colorMode: vm.colorMode,
    agentName: configuredAgentName.trim() || "seu assistente",
    merchantName: vm.activeExperience.brand.name,
    agentAvatarUrl: vm.theme.agentAvatarUrl,
    channelReady: Boolean(vm.session) && !vm.networkError,
    busy: vm.busy,
    networkError: vm.networkError,
    onRetry: vm.retryStartCheckout,
    onSelectVoice: () => vm.selectPurchaseChannel("voice"),
    onSelectChat: () => vm.selectPurchaseChannel("chat"),
  };
}
