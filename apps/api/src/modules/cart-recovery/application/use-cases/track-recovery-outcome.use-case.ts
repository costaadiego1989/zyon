import type { RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";
import type { Clock } from "./attempt-cart-recovery.use-case.js";

const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface TrackRecoveryOutcomeInput {
  merchantId: string;
  sessionId: string;
  reactivatedAt?: Date;
  orderId?: string;
}

export class TrackRecoveryOutcomeUseCase {
  constructor(
    private readonly repository: RecoveryAttemptRepositoryPort,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  async execute(input: TrackRecoveryOutcomeInput): Promise<{ status: string; attemptId?: string }> {
    const attempts = await this.repository.findBySessionId(input.merchantId, input.sessionId);
    if (attempts.length === 0) {
      return { status: "no_attempt" };
    }

    // Find the latest sent attempt
    const sentAttempts = attempts
      .filter((a) => a.status === "sent" && a.sentAt !== null)
      .sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime());

    if (sentAttempts.length === 0) {
      return { status: "no_sent_attempt" };
    }

    const latestAttempt = sentAttempts[0]!;
    const now = input.reactivatedAt ?? this.clock.now();
    const deltaMs = now.getTime() - latestAttempt.sentAt!.getTime();

    // Reactivation before attempt was sent → invalid
    if (deltaMs < 0) {
      const failed = latestAttempt.markFailed();
      await this.repository.save(failed);
      return { status: "failed", attemptId: latestAttempt.id };
    }

    // Within attribution window → recovered
    if (deltaMs <= ATTRIBUTION_WINDOW_MS) {
      const recovered = latestAttempt.markRecovered(now, input.orderId);
      await this.repository.save(recovered);
      return { status: "recovered", attemptId: latestAttempt.id };
    }

    // Outside window → expired
    const expired = latestAttempt.markExpired();
    await this.repository.save(expired);
    return { status: "expired", attemptId: latestAttempt.id };
  }
}
