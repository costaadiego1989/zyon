import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from "@nestjs/common";
import { PROTOCOL_SESSION_REPOSITORY, type ProtocolSessionRepository } from "./protocol-session.repository.js";
import { ProtocolWebhookPublisher } from "./protocol-webhook-publisher.js";

const REAP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Reaps expired protocol sessions every 15 minutes.
 * Marks them as "expired" and publishes protocol.session_expired webhook event.
 */
@Injectable()
export class ProtocolSessionExpiryReaper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProtocolSessionExpiryReaper.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PROTOCOL_SESSION_REPOSITORY) private readonly sessions: ProtocolSessionRepository,
    private readonly webhookPublisher: ProtocolWebhookPublisher
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.reapExpiredSessions(), REAP_INTERVAL_MS);
    this.logger.log({
      event: "protocol.session_expiry_reaper.started",
      intervalMs: REAP_INTERVAL_MS,
    });
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async reapExpiredSessions(): Promise<void> {
    try {
      const now = new Date();
      const expiredIds = await this.sessions.listExpired(now);

      if (expiredIds.length === 0) {
        return;
      }

      for (const sessionId of expiredIds) {
        const session = await this.sessions.findById(sessionId);
        if (!session) continue;

        await this.webhookPublisher.publishSessionExpired({
          sessionId: session.id,
          merchantId: session.merchantId,
          agentId: session.agentId,
          callbackUrl: session.sessionData.callback_url as string | undefined,
        });

        await this.sessions.markExpired(sessionId);

        this.logger.log({
          event: "protocol.session.expired_reaped",
          sessionId,
          merchantId: session.merchantId,
        });
      }
    } catch (err: unknown) {
      this.logger.error({
        event: "protocol.session_expiry_reaper.error",
        error: (err as Error).message,
      });
    }
  }
}
