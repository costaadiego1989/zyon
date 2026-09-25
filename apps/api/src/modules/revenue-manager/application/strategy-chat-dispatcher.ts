import type { ChatLlmGatewayService, PinnedChatResult } from "../../checkout/application/services/chat-llm-gateway.service.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { strategyExecutionEnabled } from "../domain/strategy-execution.js";
import type { StrategyExecutionLedger } from "../infrastructure/strategy-execution-ledger.js";

type DispatchInput<T> = T extends unknown ? Omit<T, "inputHash"> & { userMessage: string } : never;

/** Pinned dispatch boundary. Main chat reaches it only through the experimental
 * text adapter with a durable buyer-message key. A candidate is NOT exposure or permission
 * to execute tools. No text is replayed from a prior/uncertain provider attempt. */
export class StrategyChatDispatcher {
  constructor(private readonly ledger: StrategyExecutionLedger,
    private readonly gateway: Pick<ChatLlmGatewayService, "callPinned">) {}

  async dispatch(input: DispatchInput<Parameters<StrategyExecutionLedger["admitTurn"]>[0]>) {
    input = structuredClone(input);
    if (process.env.REVENUE_STRATEGY_CHAT_DISPATCH_ENABLED !== "true") return { status: "unavailable" as const };
    const admission = await this.ledger.admitTurn({ ...input, inputHash: digest(input.userMessage) });
    if (admission.status !== "admitted") return admission;
    let provider: PinnedChatResult;
    if (!strategyExecutionEnabled(input.merchantId) || process.env.REVENUE_STRATEGY_CHAT_DISPATCH_ENABLED !== "true"
      || (input.chatRequest && input.mainChat && process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED !== "true")) {
      provider = { outcome: "provider_not_dispatched" };
    } else {
      try {
        provider = await this.gateway.callPinned(input.merchantId, admission.baseline, [
          { role: "system", content: admission.systemPrompt }, { role: "user", content: input.userMessage },
        ]);
      } catch { provider = { outcome: "provider_unknown" }; }
    }
    // Persistence failure deliberately propagates. Do not release a candidate
    // without durable evidence and do not resend the admitted request on retry.
    const completion = await this.ledger.completeTurn(input.merchantId, admission.turnId, provider);
    if (provider.outcome !== "provider_completed" || completion.decision !== "eligible_at_recording"
      || process.env.REVENUE_STRATEGY_CHAT_DISPATCH_ENABLED !== "true") {
      return { status: "suppressed" as const, turnId: admission.turnId, completion };
    }
    return { status: "candidate" as const, turnId: admission.turnId, completion, result: provider.result };
  }
}
