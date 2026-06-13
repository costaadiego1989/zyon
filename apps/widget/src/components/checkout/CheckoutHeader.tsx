import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { ExperienceHeader } from "../../features/shell/ExperienceHeader.js";
import { selectExperienceHeader } from "../../presentation/checkout-experience-model.js";

export function CheckoutHeader({ vm }: { vm: CheckoutAgentViewModel }) {
  return <ExperienceHeader model={selectExperienceHeader(vm)} />;
}
