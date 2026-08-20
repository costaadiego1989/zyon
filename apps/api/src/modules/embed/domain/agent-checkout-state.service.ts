import { ConflictException, Injectable, Logger } from "@nestjs/common";

export type ProtocolStateTransition = {
  from: string;
  to: string;
  action: string;
};

export interface StateHistoryEntry {
  state: string;
  entered_at: string;
}

/**
 * Enforces the protocol state machine per spec section 1.
 * States: idle → discovered → negotiated → quoted → confirmed → payment_pending → paid → tracking
 */
@Injectable()
export class AgentCheckoutStateService {
  private readonly logger = new Logger(AgentCheckoutStateService.name);

  private readonly validTransitions: Map<string, Set<string>> = new Map([
    ["idle", new Set(["discovered"])],
    ["discovered", new Set(["negotiated", "discovered"])], // can re-browse (back to discovered)
    ["negotiated", new Set(["quoted", "discovered"])],
    ["quoted", new Set(["confirmed", "discovered"])],
    ["confirmed", new Set(["payment_pending", "discovered"])],
    ["payment_pending", new Set(["paid", "discovered"])],
    ["paid", new Set(["tracking", "discovered"])],
    ["tracking", new Set()], // terminal state
  ]);

  /**
   * Maps actions to their required source state and target state.
   */
  private readonly actionToTransition: Map<string, { from: string; to: string }> = new Map([
    ["discover", { from: "idle", to: "discovered" }],
    ["negotiate", { from: "discovered", to: "negotiated" }],
    ["quote", { from: "negotiated", to: "quoted" }],
    ["checkout", { from: "quoted", to: "confirmed" }],
    ["pay", { from: "confirmed", to: "payment_pending" }],
    ["payment_confirm", { from: "payment_pending", to: "paid" }],
    ["track", { from: "paid", to: "tracking" }],
    ["back_to_discovered", { from: "discovered", to: "discovered" }],
    ["re_browse", { from: "negotiated", to: "discovered" }],
    ["re_browse_from_quoted", { from: "quoted", to: "discovered" }],
    ["re_browse_from_payment", { from: "payment_pending", to: "discovered" }],
    ["re_browse_from_paid", { from: "paid", to: "discovered" }],
  ]);

  private readonly nextAllowedByState: Map<string, string[]> = new Map([
    ["idle", ["discover"]],
    ["discovered", ["negotiate"]],
    ["negotiated", ["quote"]],
    ["quoted", ["checkout"]],
    ["confirmed", ["pay"]],
    ["payment_pending", ["payment_confirm"]],
    ["paid", ["track"]],
    ["tracking", []],
  ]);

  /**
   * Validates a state transition.
   * @throws ConflictException if transition is invalid
   */
  validateTransition(currentState: string, targetState: string, action?: string): void {
    const allowed = this.validTransitions.get(currentState);
    if (!allowed) {
      throw new ConflictException({
        error: "INVALID_STATE_TRANSITION",
        current_state: currentState,
        attempted_action: action ?? targetState,
        required_state: "unknown",
        message: `Unknown state: ${currentState}`,
      });
    }

    if (!allowed.has(targetState)) {
      const nextAllowed = this.nextAllowedByState.get(currentState) ?? [];
      throw new ConflictException({
        error: "INVALID_STATE_TRANSITION",
        current_state: currentState,
        attempted_action: action ?? targetState,
        required_state: nextAllowed[0] ?? "terminal",
        message: `Cannot transition from ${currentState} to ${targetState}. ` +
          `Allowed: ${Array.from(allowed).join(", ")}`,
      });
    }
  }

  /**
   * Gets the next allowed actions from the given state.
   */
  getAllowedNextActions(currentState: string): string[] {
    return this.nextAllowedByState.get(currentState) ?? [];
  }

  /**
   * Records a state transition in the history.
   */
  recordStateTransition(history: StateHistoryEntry[], newState: string): StateHistoryEntry[] {
    return [
      ...history,
      {
        state: newState,
        entered_at: new Date().toISOString(),
      },
    ];
  }

  /**
   * Checks if a state is terminal (no further transitions allowed).
   */
  isTerminal(state: string): boolean {
    const allowed = this.validTransitions.get(state);
    return allowed ? allowed.size === 0 : false;
  }
}
