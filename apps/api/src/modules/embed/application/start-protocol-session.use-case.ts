import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AgentSessionTokenService, type AgentSessionTokenClaims } from "../domain/agent-session-token.service.js";
import { AgentCheckoutStateService, type StateHistoryEntry } from "../domain/agent-checkout-state.service.js";
import { PROTOCOL_SESSION_REPOSITORY, type ProtocolSessionRepository } from "../infrastructure/protocol-session.repository.js";
import { Inject } from "@nestjs/common";

export interface StartProtocolSessionInput {
  merchant_id: string;
  agent_id: string;
  callback_url?: string;
}

export interface StartProtocolSessionOutput {
  session_token: string;
  session_id: string;
  current_state: string;
  expires_at: string;
  allowed_next_actions: string[];
}

@Injectable()
export class StartProtocolSessionUseCase {
  private readonly logger = new Logger(StartProtocolSessionUseCase.name);

  constructor(
    private readonly tokenService: AgentSessionTokenService,
    private readonly stateService: AgentCheckoutStateService,
    @Inject(PROTOCOL_SESSION_REPOSITORY) private readonly sessions: ProtocolSessionRepository
  ) {}

  async execute(input: StartProtocolSessionInput): Promise<StartProtocolSessionOutput> {
    const sessionId = `proto_${crypto.randomUUID().substring(0, 12)}`;
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = 30 * 60; // 30 minutes
    const expiresAtUnix = now + ttlSeconds;

    const initialState = "idle";
    const stateHistory: StateHistoryEntry[] = [
      {
        state: initialState,
        entered_at: new Date().toISOString(),
      },
    ];

    const claims: AgentSessionTokenClaims = {
      typ: "aacp_agent_protocol_v1",
      session_id: sessionId,
      merchant_id: input.merchant_id,
      agent_id: input.agent_id,
      current_state: initialState,
      issued_at_unix: now,
      expires_at_unix: expiresAtUnix,
      nonce: crypto.randomUUID(),
    };

    const token = this.tokenService.sign(claims);
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const sessionData: Record<string, unknown> = {
      callback_url: input.callback_url ?? null,
    };

    const expiresAt = new Date(expiresAtUnix * 1000);

    // Persist session
    await this.sessions.create({
      id: sessionId,
      merchantId: input.merchant_id,
      agentId: input.agent_id,
      currentState: initialState,
      stateHistory,
      sessionData,
      tokenHash,
      expiresAt,
    });

    this.logger.log({
      event: "protocol.session.started",
      sessionId,
      merchantId: input.merchant_id,
      agentId: input.agent_id,
    });

    return {
      session_token: token,
      session_id: sessionId,
      current_state: initialState,
      expires_at: expiresAt.toISOString(),
      allowed_next_actions: this.stateService.getAllowedNextActions(initialState),
    };
  }
}
