import { Injectable, Inject, Logger, Optional, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { AbandonmentReasonClassifier } from "../../domain/services/abandonment-reason-classifier.service.js";
import { RecoveryStrategySelector } from "../../domain/services/recovery-strategy-selector.service.js";
import { AttemptCartRecoveryUseCase } from "../../application/use-cases/attempt-cart-recovery.use-case.js";
import { RECOVERY_ATTEMPT_REPOSITORY, type RecoveryAttemptRepositoryPort } from "../../domain/ports/recovery-attempt-repository.port.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import { STRATEGY_PREFERENCES_REPOSITORY, type StrategyPreferencesRepositoryPort } from "../../domain/ports/strategy-preferences-repository.port.js";
import { BUYER_PURCHASE_HISTORY_REPOSITORY, type BuyerPurchaseHistoryRepository } from "../../../buyer-purchase-history/domain/ports/buyer-purchase-history-repository.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { RecoveryStrategy } from "../../domain/values/recovery-strategy.js";

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
    @Inject(STRATEGY_PREFERENCES_REPOSITORY) private readonly strategyPrefs: StrategyPreferencesRepositoryPort,
    @Inject(BUYER_PURCHASE_HISTORY_REPOSITORY) private readonly purchaseHistory: BuyerPurchaseHistoryRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
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
   * Multi-instance safety: use random jitter (0-30s) to minimize collision probability.
   */
  async scan(): Promise<{ scanned: number; attempted: number; errors: number }> {
    // Apply random jitter to minimize multi-instance collisions
    const jitter = Math.random() * 30 * 1000; // 0-30s
    await new Promise(resolve => setTimeout(resolve, jitter));

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

    // Fix #4: Load real buyer purchase history (known_buyer, discount sensitivity, recent SKUs).
    let buyerHistoryContext = {
      known_buyer: false,
      discount_sensitivity: "low" as "low" | "medium" | "high",
      recent_skus: [] as string[],
    };
    try {
      const history = await this.purchaseHistory.getByBuyer({ globalUserId, merchantId: session.merchantId });
      if (history) {
        const ctx = history.toSafeContext().purchase_history;
        buyerHistoryContext = {
          known_buyer: ctx.known_buyer,
          // Strategy selector only knows low/medium/high — map "unknown" → "low".
          discount_sensitivity: ctx.discount_sensitivity === "unknown" ? "low" : ctx.discount_sensitivity,
          recent_skus: ctx.recent_skus,
        };
      }
    } catch (err) {
      this.logger.warn("recovery-scanner: buyer history lookup failed (using defaults)", { error: err instanceof Error ? err.message : String(err) });
    }

    const merchantPolicy = await this.merchantRules.getRules(session.merchantId);
    if (!merchantPolicy) {
      this.logger.warn(
        `recovery-scanner: merchant policy not found`,
        { merchantId: session.merchantId }
      );
      return;
    }

    // Fix #2: Classify reason from the session's real recorded checkout events.
    let eventNames: string[] = [];
    try {
      const rows = await this.prisma.checkoutEvent.findMany({
        where: { merchantId: session.merchantId, sessionId: session.sessionId },
        orderBy: { occurredAt: "asc" },
        select: { eventName: true },
      });
      eventNames = rows.map((r) => r.eventName);
    } catch (err) {
      this.logger.warn("recovery-scanner: event lookup failed", { error: err instanceof Error ? err.message : String(err) });
    }
    if (eventNames.length === 0) eventNames = ["exit_intent_detected"]; // safe default

    // Fix #7: Honor the merchant's dashboard-configured strategy override.
    let forcedStrategy: RecoveryStrategy | undefined;
    try {
      const cfg = await this.strategyPrefs.getConfig(session.merchantId);
      forcedStrategy = this.buildForcedStrategy(cfg, buyerHistoryContext.recent_skus);
    } catch { /* fall back to algorithm */ }

    // Create attempt (use-case classifies + selects internally, or uses forcedStrategy).
    const useCase = new AttemptCartRecoveryUseCase(this.attempts);
    const result = await useCase.execute({
      merchantId: session.merchantId,
      sessionId: session.sessionId,
      globalUserId,
      abandonmentScore: session.abandonmentScore,
      events: eventNames,
      buyerHistory: buyerHistoryContext,
      merchantRules: {
        allowFreeShipping: merchantPolicy.allowFreeShipping,
        maxDiscountPercent: merchantPolicy.maxDiscountPercent
      },
      forcedStrategy,
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
        forced: !!forcedStrategy,
        events: eventNames,
      }
    );
  }

  /**
   * Map the merchant's dashboard strategy config to a concrete RecoveryStrategy.
   * Returns undefined for advanced_rule with no rule_id or unknown config
   * (so the algorithm decides instead).
   */
  private buildForcedStrategy(
    cfg: { active_strategy?: string; coupon_code?: string; rule_id?: string } | null,
    recentSkus: string[],
  ): RecoveryStrategy | undefined {
    if (!cfg?.active_strategy) return undefined;
    switch (cfg.active_strategy) {
      case "offer_free_shipping":
        return { type: "offer_free_shipping", condition: "merchant_allows_free_shipping" };
      case "offer_coupon":
        return cfg.coupon_code
          ? { type: "offer_coupon", coupon_code: cfg.coupon_code }
          : undefined;
      case "personalized_cross_sell":
        return { type: "personalized_cross_sell", suggested_skus: recentSkus };
      case "advanced_rule":
        return cfg.rule_id
          ? { type: "advanced_rule", rule_id: cfg.rule_id }
          : undefined;
      default:
        return undefined;
    }
  }
}
