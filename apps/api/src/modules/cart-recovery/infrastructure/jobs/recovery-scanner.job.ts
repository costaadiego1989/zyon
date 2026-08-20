import { Injectable, Inject, Logger, Optional, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { AbandonmentReasonClassifier } from "../../domain/services/abandonment-reason-classifier.service.js";
import { RecoveryStrategySelector } from "../../domain/services/recovery-strategy-selector.service.js";
import { AttemptCartRecoveryUseCase } from "../../application/use-cases/attempt-cart-recovery.use-case.js";
import { RECOVERY_ATTEMPT_REPOSITORY, type RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";

const SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * RecoveryScannerJob
 *
 * Runs every 15 min: polls for abandoned sessions (triggerAgent=true, no existing attempt),
 * classifies reason, selects strategy, creates recovery attempt, updates session with offer.
 *
 * Widget polls session state → sees new authorizedOffer → conversation-engine generates recovery message.
 */
@Injectable()
export class RecoveryScannerJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecoveryScannerJob.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(RECOVERY_ATTEMPT_REPOSITORY) private readonly attempts: RecoveryAttemptRepositoryPort,
    @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRules: MerchantRulesRepository,
  ) {}

  /**
   * Start the interval on module init (NestJS lifecycle hook).
   * Runs every 15 min.
   */
  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      this.scan().catch((err) => {
        this.logger.error(
          "recovery-scanner: unhandled error in scheduled scan",
          { error: err instanceof Error ? err.message : String(err) }
        );
      });
    }, SCAN_INTERVAL_MS);
    this.logger.log("recovery-scanner: scheduled for every 15 minutes", { intervalMs: SCAN_INTERVAL_MS });
  }

  /**
   * Clean up interval on module destroy (NestJS lifecycle hook).
   */
  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.logger.log("recovery-scanner: interval cleared");
    }
  }

  /**
   * Main scan loop. Called by job scheduler (every 15 min).
   * Isolated: each session is processed independently; failures are logged, not fatal.
   */
  async scan(): Promise<{ scanned: number; attempted: number; errors: number }> {
    const stats = { scanned: 0, attempted: 0, errors: 0 };

    try {
      // Query sessions with triggerAgent=true
      const candidates = await this.sessions.findSessionsWithTrigger();
      stats.scanned = candidates.length;

      for (const session of candidates) {
        try {
          await this.processSession(session);
          stats.attempted++;
        } catch (err) {
          stats.errors++;
          this.logger.error(
            `recovery-scanner: failed to process session`,
            {
              merchantId: session.merchantId,
              sessionId: session.sessionId,
              error: err instanceof Error ? err.message : String(err)
            }
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `recovery-scanner: query failed`,
        { error: err instanceof Error ? err.message : String(err) }
      );
    }

    return stats;
  }

  private async processSession(session: CheckoutSession): Promise<void> {
    // Dedup: skip if attempt already exists for this session
    const existingAttempt = await this.attempts.existsForSession(session.merchantId, session.sessionId);
    if (existingAttempt) {
      this.logger.debug(`recovery-scanner: attempt already exists`, {
        merchantId: session.merchantId,
        sessionId: session.sessionId
      });
      return;
    }

    // Threshold check
    const MINIMUM_SCORE = 0.55;
    if (session.abandonmentScore < MINIMUM_SCORE) {
      return;
    }

    // Load buyer history for strategy selection
    const globalUserId = session.globalUserId;
    if (!globalUserId) {
      this.logger.warn(
        `recovery-scanner: session missing globalUserId`,
        { merchantId: session.merchantId, sessionId: session.sessionId }
      );
      return;
    }

    // TODO: Fetch buyer history from record — this.purchaseHistory doesn't expose purchase context yet
    // For now, use default buyer history
    const buyerHistoryContext = {
      known_buyer: false,
      discount_sensitivity: "low" as const,
      recent_skus: []
    };

    const merchantPolicy = await this.merchantRules.getRules(session.merchantId);
    if (!merchantPolicy) {
      this.logger.warn(
        `recovery-scanner: merchant policy not found`,
        { merchantId: session.merchantId }
      );
      return;
    }

    // Classify reason from session event log (rebuild from recorded events)
    // Note: session doesn't store raw events, only summary scores; this is simplified for MVP
    const reason = AbandonmentReasonClassifier.classify(["exit_intent_detected"]);

    // Select strategy
    const strategy = RecoveryStrategySelector.select({
      session: { abandonmentScore: session.abandonmentScore },
      buyerHistory: buyerHistoryContext,
      merchantRules: {
        allowFreeShipping: merchantPolicy.allowFreeShipping,
        maxDiscountPercent: merchantPolicy.maxDiscountPercent
      },
      abandonmentReason: reason
    });

    // If no_action, skip
    if (strategy.type === "no_action") {
      return;
    }

    // Create attempt
    const useCase = new AttemptCartRecoveryUseCase(this.attempts);
    const result = await useCase.execute({
      merchantId: session.merchantId,
      sessionId: session.sessionId,
      globalUserId,
      abandonmentScore: session.abandonmentScore,
      events: ["exit_intent_detected"],
      buyerHistory: buyerHistoryContext,
      merchantRules: {
        allowFreeShipping: merchantPolicy.allowFreeShipping,
        maxDiscountPercent: merchantPolicy.maxDiscountPercent
      }
    });

    if (!result.created) {
      return;
    }

    this.logger.log(
      `recovery-scanner: attempt created`,
      {
        merchantId: session.merchantId,
        sessionId: session.sessionId,
        attemptId: result.attemptId,
        strategy: strategy.type,
        reason
      }
    );
  }
}
