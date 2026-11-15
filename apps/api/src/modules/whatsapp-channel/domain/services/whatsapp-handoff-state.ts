export interface HandoffScope { merchantId: string; configId: string; whatsappSessionId: string }
export interface HandoffState extends HandoffScope {
  id: string;
  mode: "ai" | "waiting_human" | "human";
  epoch: number;
  ticketId: string | null;
  assignedOperatorId: string | null;
}
export interface AiTurnToken extends HandoffScope { bindingId: string; epoch: number }
export interface HandoffTransition { state: Readonly<HandoffState>; changed: boolean }

export class HandoffStateError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 191;
const validEpoch = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;
function sameScope(current: HandoffScope, scope: HandoffScope): boolean {
  return current.merchantId === scope.merchantId && current.configId === scope.configId && current.whatsappSessionId === scope.whatsappSessionId;
}
function validState(state: Readonly<HandoffState>): boolean {
  return validId(state.id) && validId(state.merchantId) && validId(state.configId) && validId(state.whatsappSessionId)
    && validEpoch(state.epoch) && ["ai", "waiting_human", "human"].includes(state.mode)
    && (state.ticketId === null || validId(state.ticketId)) && (state.assignedOperatorId === null || validId(state.assignedOperatorId))
    && (state.mode === "human" ? state.ticketId !== null && state.assignedOperatorId !== null
      : state.mode === "waiting_human" ? state.ticketId !== null && state.assignedOperatorId === null : state.assignedOperatorId === null);
}
function assertScope(current: Readonly<HandoffState>, scope: HandoffScope): void {
  if (!validState(current)) throw new HandoffStateError("handoff_invalid_state");
  if (!sameScope(current, scope)) throw new HandoffStateError("handoff_scope_mismatch");
}

/** The transaction writer also validates the canonical ticket and persists an
 * epoch compare-and-set while retaining the conversation routing lock. */
export function beginHumanHandoff(current: Readonly<HandoffState>, scope: HandoffScope, ticketId: string, expectedEpoch: number): HandoffTransition {
  assertScope(current, scope);
  if (!validId(ticketId)) throw new HandoffStateError("handoff_ticket_required");
  if (current.mode !== "ai") {
    if (current.ticketId !== ticketId) throw new HandoffStateError("handoff_already_active");
    return { state: Object.freeze({ ...current }), changed: false };
  }
  if (!validEpoch(expectedEpoch) || current.epoch !== expectedEpoch) throw new HandoffStateError("handoff_epoch_conflict");
  if (current.epoch === 2_147_483_647) throw new HandoffStateError("handoff_epoch_exhausted");
  return { state: Object.freeze({ ...current, mode: "waiting_human", ticketId, assignedOperatorId: null, epoch: current.epoch + 1 }), changed: true };
}

export function captureAiTurn(current: Readonly<HandoffState>, scope: HandoffScope): Readonly<AiTurnToken> {
  assertScope(current, scope);
  if (current.mode !== "ai") throw new HandoffStateError("handoff_ai_paused");
  return Object.freeze({ ...scope, bindingId: current.id, epoch: current.epoch });
}

/** Dispatch must retain the same lock through its admitted submission; a read
 * followed by an unlocked asynchronous send is insufficient. */
export function isCurrentAiTurn(current: Readonly<HandoffState>, token: Readonly<AiTurnToken>): boolean {
  return validState(current) && validEpoch(token.epoch) && current.mode === "ai" && sameScope(current, token)
    && current.id === token.bindingId && current.epoch === token.epoch;
}
