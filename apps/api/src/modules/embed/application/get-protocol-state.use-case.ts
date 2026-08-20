import { Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { AgentSessionTokenService, type AgentSessionTokenClaims } from "../domain/agent-session-token.service.js";
import { AgentCheckoutStateService } from "../domain/agent-checkout-state.service.js";
import { PROTOCOL_SESSION_REPOSITORY, type ProtocolSessionRepository } from "../infrastructure/protocol-session.repository.js";

export interface GetProtocolStateOutput {
  session_id: string;
  current_state: string;
  state_history: Array<{ state: string; entered_at: string }>;
  allowed_next_actions: string[];
  expires_at: string;
}

@Injectable()
export class GetProtocolStateUseCase {
  private readonly logger = new Logger(GetProtocolStateUseCase.name);

  constructor(
    private readonly tokenService: AgentSessionTokenService,
    private readonly stateService: AgentCheckoutStateService,
    @Inject(PROTOCOL_SESSION_REPOSITORY) private readonly sessions: ProtocolSessionRepository
  ) {}

  async execute(sessionToken: string): Promise<GetProtocolStateOutput> {
    let claims: AgentSessionTokenClaims;
    try {
      claims = this.tokenService.verify(sessionToken);
    } catch (err: unknown) {
      throw new UnauthorizedException((err as Error).message);
    }

    const session = await this.sessions.findById(claims.session_id);
    if (!session) {
      throw new UnauthorizedException("protocol_session_not_found");
    }

    return {
      session_id: session.id,
      current_state: session.currentState,
      state_history: session.stateHistory as Array<{ state: string; entered_at: string }>,
      allowed_next_actions: this.stateService.getAllowedNextActions(session.currentState),
      expires_at: session.expiresAt.toISOString(),
    };
  }
}
