import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { CheckoutStageProgress } from "./CheckoutStageProgress.js";

export function CheckoutStepper({ vm }: { vm: CheckoutAgentViewModel }) {
  return <CheckoutStageProgress activeStage={vm.checkoutStage} />;
}
