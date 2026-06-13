import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import {
  CheckoutExperience,
  type CheckoutExperienceSnapshotModel,
} from "../../app/CheckoutExperience.js";

export function CheckoutShell({ vm }: { vm: CheckoutAgentViewModel }) {
  return <CheckoutExperience vm={vm} />;
}

export type CheckoutShellExperience = CheckoutExperienceSnapshotModel;
