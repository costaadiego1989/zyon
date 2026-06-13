import { ChatThread } from "../../components/checkout/ChatThread.js";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";

export function DecisionStage({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <section
      className="aacp-decision-stage"
      aria-label="Decisao atual do checkout"
      data-stage={vm.checkoutStage}
    >
      <ChatThread vm={vm} />
    </section>
  );
}
