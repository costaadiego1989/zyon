import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";
import { FloatingCheckout } from "../components/checkout/FloatingCheckout.js";
import { ChatCheckoutExperience } from "./ChatCheckoutExperience.js";
import { VoiceCheckoutExperience } from "../features/onboarding/VoiceCheckoutExperience.js";

export function CheckoutExperience({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.isConversational) return <FloatingCheckout vm={vm} />;

  if (vm.purchaseChannel === "voice" && !vm.showChannelWelcome) {
    return <VoiceCheckoutExperience vm={vm} />;
  }

  return <ChatCheckoutExperience vm={vm} />;
}

export type { CheckoutExperienceSnapshotModel } from "./ChatCheckoutExperience.js";
