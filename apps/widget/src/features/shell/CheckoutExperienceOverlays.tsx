import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { BuyerGuestModal } from "../../components/checkout/BuyerGuestModal.js";
import { CartFAB } from "../../components/checkout/CartFAB.js";
import { GlobalAuthModal } from "../../components/checkout/GlobalAuthModal.js";
import { SupportPanel } from "../../components/checkout/SupportPanel.js";
import { ThemeStudio } from "../../components/checkout/ThemeStudio.js";
import { AgentChannelWelcome } from "../onboarding/AgentChannelWelcome.js";

export function CheckoutExperienceOverlays({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <>
      <SupportPanel vm={vm} />
      <CartFAB vm={vm} />
      <ThemeStudio studio={vm.themeStudio} theme={vm.theme} />
      <BuyerGuestModal vm={vm} />
      <GlobalAuthModal auth={vm.auth} hub={vm.hub} />
      <AgentChannelWelcome vm={vm} />
    </>
  );
}
