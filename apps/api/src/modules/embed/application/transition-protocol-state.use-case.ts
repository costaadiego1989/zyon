import { ConflictException, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AgentSessionTokenService, type AgentSessionTokenClaims } from "../domain/agent-session-token.service.js";
import { AgentCheckoutStateService, type StateHistoryEntry } from "../domain/agent-checkout-state.service.js";
import { PROTOCOL_SESSION_REPOSITORY, type ProtocolSessionRepository } from "../infrastructure/protocol-session.repository.js";

export interface TransitionProtocolStateInput {
  session_token: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface TransitionProtocolStateOutput {
  session_id: string;
  session_token: string;
  current_state: string;
  previous_state: string;
  expires_at: string;
  allowed_next_actions: string[];
  payload?: Record<string, unknown>;
}

/**
 * Maps endpoint actions to required current state and target state.
 */
const ACTION_MAP: Record<string, { requiredState: string; targetState: string }> = {
  discover: { requiredState: "idle", targetState: "discovered" },
  negotiate: { requiredState: "discovered", targetState: "negotiated" },
  quote: { requiredState: "negotiated", targetState: "quoted" },
  checkout: { requiredState: "quoted", targetState: "confirmed" },
  pay: { requiredState: "confirmed", targetState: "payment_pending" },
  payment_confirm: { requiredState: "payment_pending", targetState: "paid" },
  track: { requiredState: "paid", targetState: "tracking" },
};

@Injectable()
export class TransitionProtocolStateUseCase {
  private readonly logger = new Logger(TransitionProtocolStateUseCase.name);

  constructor(
    private readonly tokenService: AgentSessionTokenService,
    private readonly stateService: AgentCheckoutStateService,
    @Inject(PROTOCOL_SESSION_REPOSITORY) private readonly sessions: ProtocolSessionRepository
  ) {}

  async execute(input: TransitionProtocolStateInput): Promise<TransitionProtocolStateOutput> {
    // 1. Verify token
    let claims: AgentSessionTokenClaims;
    try {
      claims = this.tokenService.verify(input.session_token);
    } catch (err: unknown) {
      throw new UnauthorizedException((err as Error).message);
    }

    // 2. Load session
    const session = await this.sessions.findById(claims.session_id);
    if (!session) {
      throw new UnauthorizedException("protocol_session_not_found");
    }
    if (session.currentState === "expired") {
      throw new UnauthorizedException("protocol_session_expired");
    }

    // 3. Determine target state from action
    const actionDef = ACTION_MAP[input.action];
    if (!actionDef) {
      throw new ConflictException({
        error: "INVALID_STATE_TRANSITION",
        current_state: session.currentState,
        attempted_action: input.action,
        required_state: "unknown",
        message: `Unknown action: ${input.action}`,
      });
    }

    // 4. Validate transition
    this.stateService.validateTransition(
      session.currentState,
      actionDef.targetState,
      input.action
    );

    // Additional check: the action requires a specific source state
    if (session.currentState !== actionDef.requiredState) {
      throw new ConflictException({
        error: "INVALID_STATE_TRANSITION",
        current_state: session.currentState,
        attempted_action: input.action,
        required_state: actionDef.requiredState,
        message: `Cannot ${input.action} without completing ${actionDef.requiredState} first`,
      });
    }

    // 5. Record transition
    const previousState = session.currentState;
    const newState = actionDef.targetState;
    const newHistory = this.stateService.recordStateTransition(
      session.stateHistory as StateHistoryEntry[],
      newState
    );

    // 6. Merge payload into session data
    const newSessionData = {
      ...session.sessionData,
      ...(input.payload ? { [`${input.action}_data`]: input.payload } : {}),
    };

    // 7. Refresh token TTL (+30 min)
    const now = Math.floor(Date.now() / 1000);
    const newExpiresAtUnix = now + 30 * 60;
    const newExpiresAt = new Date(newExpiresAtUnix * 1000);

    // 8. Issue new token with updated state
    const newClaims: AgentSessionTokenClaims = {
      typ: "aacp_agent_protocol_v1",
      session_id: session.id,
      merchant_id: session.merchantId,
      agent_id: session.agentId,
      current_state: newState,
      issued_at_unix: now,
      expires_at_unix: newExpiresAtUnix,
      nonce: crypto.randomUUID(),
    };

    const newToken = this.tokenService.sign(newClaims);

    // 9. Persist state update
    await this.sessions.updateState(
      session.id,
      newState,
      newHistory,
      newSessionData,
      newExpiresAt
    );

    this.logger.log({
      event: "protocol.state_changed",
      sessionId: session.id,
      previousState,
      newState,
      merchantId: session.merchantId,
    });

    return {
      session_id: session.id,
      session_token: newToken,
      current_state: newState,
      previous_state: previousState,
      expires_at: newExpiresAt.toISOString(),
      allowed_next_actions: this.stateService.getAllowedNextActions(newState),
      payload: input.payload,
    };
  }
}
