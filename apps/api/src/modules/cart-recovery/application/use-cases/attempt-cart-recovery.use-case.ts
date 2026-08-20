import { RecoveryAttempt } from "../../domain/entities/recovery-attempt.entity.js";
import type { RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";
import { AbandonmentReasonClassifier } from "../../domain/services/abandonment-reason-classifier.service.js";
import { RecoveryStrategySelector, type StrategySelectionInput } from "../../domain/services/recovery-strategy-selector.service.js";

export interface AttemptCartRecoveryInput {
  merchantId: string;
  sessionId: string;
  globalUserId: string;
  abandonmentScore: number;
  events: string[];
  buyerHistory: StrategySelectionInput["buyerHistory"];
  merchantRules: StrategySelectionInput["merchantRules"];
}

export interface Clock {
  now(): Date;
}

const MINIMUM_SCORE_THRESHOLD = 0.55;

export class AttemptCartRecoveryUseCase {
  constructor(
    private readonly repository: RecoveryAttemptRepositoryPort,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  async execute(input: AttemptCartRecoveryInput): Promise<{ created: boolean; attemptId?: string }> {
    // Below threshold → skip
    if (input.abandonmentScore < MINIMUM_SCORE_THRESHOLD) {
      return { created: false };
    }

    // Dedup: if attempt already exists for this session, skip
    const exists = await this.repository.existsForSession(input.merchantId, input.sessionId);
    if (exists) {
      return { created: false };
    }

    // Classify abandonment reason
    const reason = AbandonmentReasonClassifier.classify(input.events);

    // Select strategy
    const strategy = RecoveryStrategySelector.select({
      session: { abandonmentScore: input.abandonmentScore },
      buyerHistory: input.buyerHistory,
      merchantRules: input.merchantRules,
      abandonmentReason: reason,
    });

    // no_action → skip writing attempt
    if (strategy.type === "no_action") {
      return { created: false };
    }

    const attemptId = `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const attempt = new RecoveryAttempt({
      id: attemptId,
      merchantId: input.merchantId,
      sessionId: input.sessionId,
      globalUserId: input.globalUserId,
      abandonmentReason: reason,
      abandonmentScore: input.abandonmentScore,
      strategy,
      channel: "in_session",
      sentAt: null,
      status: "pending",
      recoveredAt: null,
      recoveredOrderId: null,
      createdAt: this.clock.now(),
    });

    await this.repository.save(attempt);
    return { created: true, attemptId };
  }
}
