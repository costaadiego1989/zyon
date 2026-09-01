import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { ObserveMetricsUseCase } from "../../application/use-cases/observe-metrics.use-case.js";
import { GenerateHypothesisUseCase } from "../../application/use-cases/generate-hypothesis.use-case.js";
import { CreateExperimentFromHypothesisUseCase } from "../../application/use-cases/create-experiment-from-hypothesis.use-case.js";
import { DiscountRuleHypothesisService } from "../../domain/services/discount-rule-hypothesis.service.js";
import { HypothesisEntity } from "../../domain/entities/hypothesis.entity.js";
import { HYPOTHESIS_REPOSITORY_PORT, type HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";

export const REVENUE_MANAGER_OBSERVATION_QUEUE = "revenue-manager-observations";
const JOB_NAME = "daily-observation-compile";
const RECURRING_JOB_KEY = "revenue-manager-observations:cron";
const CRON_DAILY_2AM_UTC = "0 2 * * *"; // 2 AM UTC

interface DailyObservationJobData {
  triggeredAt: string;
}

function redisConnection(): RedisOptions | null {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

/**
 * Scheduler for DailyObservationJob.
 * Registers a recurring BullMQ job to run daily at 2 AM UTC.
 */
@Injectable()
export class DailyObservationScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(DailyObservationScheduler.name);
  private readonly queue: Queue<DailyObservationJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection
      ? new Queue<DailyObservationJobData>(REVENUE_MANAGER_OBSERVATION_QUEUE, { connection })
      : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(JOB_NAME, { triggeredAt: new Date().toISOString() }, {
        jobId: RECURRING_JOB_KEY,
        repeat: { pattern: CRON_DAILY_2AM_UTC },
        removeOnComplete: 100,
        removeOnFail: 1_000,
      });
      this.logger.log(`Scheduled recurring daily observation (cron=${CRON_DAILY_2AM_UTC})`);
    } catch (err) {
      this.logger.warn(
        `Failed to register recurring daily observation: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

/**
 * DailyObservationWorker — Background Job (every day 2 AM UTC)
 *
 * For each merchant:
 * 1. Fetch merchant config + current metrics (funnel, abandonment, etc)
 * 2. Call ObserveMetricsUseCase to create/deduplicate observation
 * 3. If observation is new: call GenerateHypothesisUseCase
 * 4. If hypothesis is low-risk: auto-approve + create experiment
 *
 * Falls back to setInterval when Redis is not configured.
 * Timeout: 10 minutes per job.
 */
@Injectable()
export class DailyObservationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailyObservationWorker.name);
  private worker: Worker<DailyObservationJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly observeMetricsUseCase: ObserveMetricsUseCase,
    private readonly generateHypothesisUseCase: GenerateHypothesisUseCase,
    private readonly createExperimentUseCase: CreateExperimentFromHypothesisUseCase,
    private readonly discountRuleHypothesisService: DiscountRuleHypothesisService,
    @Inject(HYPOTHESIS_REPOSITORY_PORT) private readonly hypothesisRepository: HypothesisRepositoryPort,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      this.worker = new Worker<DailyObservationJobData>(
        REVENUE_MANAGER_OBSERVATION_QUEUE,
        async (job) => this.process(job),
        { connection, concurrency: 1 },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Daily observation job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
      this.logger.log("DailyObservationWorker started (BullMQ)");
    } else {
      // Fallback to setInterval
      this.timer = setInterval(
        () => {
          void this.runObservationCycle().catch((err) => {
            this.logger.warn(`Daily observation timer failed: ${err instanceof Error ? err.message : String(err)}`);
          });
        },
        24 * 60 * 60 * 1_000, // Run every 24 hours
      );
      this.logger.log("DailyObservationWorker started (setInterval fallback, every 24h)");
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<DailyObservationJobData>): Promise<void> {
    const count = await this.runObservationCycle();
    this.logger.log(`Daily observation job ${job.id ?? "n/a"} processed ${count} merchants`);
  }

  /**
   * Exposed for testability.
   * Run one observation cycle for all merchants.
   */
  async runObservationCycle(): Promise<number> {
    try {
      const merchants = await this.prisma.merchant.findMany({
        take: 100, // batch limit
      });

      let processedCount = 0;

      for (const merchant of merchants) {
        try {
          await this.processMerchant(merchant.id);
          processedCount++;
        } catch (err) {
          this.logger.warn(`Failed to process merchant ${merchant.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return processedCount;
    } catch (err) {
      this.logger.warn(`Failed to run observation cycle: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }

  /**
   * Full pipeline per merchant:
   * 1. Observe metrics → deduplicate by fingerprint
   * 2. Generate hypothesis → LLM call (skip if fails)
   * 3. If auto-approved → create experiment (skip if running experiment exists)
   * 4. (F2-T05) Generate discount rule hypothesis if enabled
   */
  private async processMerchant(merchantId: string): Promise<void> {
    // Calculate observation window (last 24 hours)
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1_000);

    // Step 1: Observe metrics
    const observation = await this.observeMetricsUseCase.execute({
      merchant_id: merchantId,
      window_start: windowStart,
      window_end: windowEnd,
    });

    // If observation already existed (fingerprint dedup), skip
    if (!observation.is_new) {
      this.logger.debug(`Merchant ${merchantId}: observation unchanged (fingerprint dedup)`);
      return;
    }

    // Step 2: Generate hypothesis (LLM call — skip on failure)
    let hypothesis;
    try {
      hypothesis = await this.generateHypothesisUseCase.execute({
        merchant_id: merchantId,
        observation_id: observation.observation_id,
      });
    } catch (err) {
      this.logger.warn(`Merchant ${merchantId}: hypothesis generation failed, skipping: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Step 3: If auto-approved (low risk), create experiment immediately
    if (hypothesis.approval_strategy === "auto") {
      try {
        const result = await this.createExperimentUseCase.execute({
          merchant_id: merchantId,
          hypothesis_id: hypothesis.hypothesis_id,
        });

        if (result.status === "created") {
          this.logger.log(`Merchant ${merchantId}: auto-created experiment ${result.experiment_id} from hypothesis ${hypothesis.hypothesis_id}`);
        } else {
          this.logger.warn(`Merchant ${merchantId}: experiment creation failed: ${result.error}`);
        }
      } catch (err) {
        // Constraint: merchant already has running experiment — expected, skip silently
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("MERCHANT_ALREADY_HAS_RUNNING_EXPERIMENT")) {
          this.logger.debug(`Merchant ${merchantId}: already has running experiment, skipping`);
        } else {
          this.logger.warn(`Merchant ${merchantId}: experiment creation failed: ${message}`);
        }
      }
    } else {
      this.logger.log(`Merchant ${merchantId}: hypothesis ${hypothesis.hypothesis_id} needs manual approval (risk=${hypothesis.risk_level})`);
    }

    // Step 4: (F2-T05) Generate discount rule hypothesis if autonomous engine enabled
    await this.generateDiscountRuleHypothesis(merchantId, observation.observation_id);
  }

  /**
   * F2-T05: Generate discount rule hypothesis.
   *
   * 1. Fetch merchant rules (kill-switch check)
   * 2. If autonomousEngineEnabled=false, skip
   * 3. Fetch cohort stats (reuse observation metrics)
   * 4. Call DiscountRuleHypothesisService.generate()
   * 5. If candidate: create HypothesisEntity type='discount_rule' status='pending_review'
   * 6. Create MerchantNotification type='ai_rule_suggestion'
   */
  private async generateDiscountRuleHypothesis(merchantId: string, observationId: string): Promise<void> {
    try {
      // Fetch merchant rules to check kill-switch
      const merchantRules = await this.prisma.merchantRule.findUnique({
        where: { merchantId },
      });

      if (!merchantRules) {
        this.logger.debug(`Merchant ${merchantId}: no rules configured, skipping discount rule generation`);
        return;
      }

      // ADI-F2-05: kill-switch — skip if disabled
      if (!merchantRules.autonomousEngineEnabled) {
        this.logger.debug(`Merchant ${merchantId}: autonomous engine disabled (kill-switch), skipping discount rule generation`);
        return;
      }

      // Fetch cohort stats aggregated by intent (conversion × margin per cohort).
      const cohortStats = await this.loadCohortStats(merchantId);

      // ADI-F2-01..03: call DiscountRuleHypothesisService to generate a safe candidate.
      // Prisma Decimal caps are coerced to number for the pure domain service.
      const candidate = this.discountRuleHypothesisService.generate(
        cohortStats,
        {
          maxDiscountPercent: Number(merchantRules.maxDiscountPercent),
          minimumMarginPercent: Number(merchantRules.minimumMarginPercent),
          autonomousEngineEnabled: merchantRules.autonomousEngineEnabled,
        } as unknown as Parameters<DiscountRuleHypothesisService["generate"]>[1],
        parseInt(process.env.RULE_OPTIMIZER_MIN_SAMPLES ?? "30", 10)
      );

      if (!candidate) {
        this.logger.debug(`Merchant ${merchantId}: no discount rule candidate generated (no eligible cohorts or all rejected)`);
        return;
      }

      // ADI-F2-04: candidate → HypothesisEntity type='discount_rule', pending_review.
      const hypothesisEntity = HypothesisEntity.create({
        merchant_id: merchantId,
        observation_id: observationId,
        hypothesis_text: candidate.rationale,
        reasoning: `Auto-generated discount rule for ${candidate.rule.name}`,
        expected_lift_percent: candidate.projectedLiftPercent,
        risk_level: "low",
        approval_strategy: "manual", // ADI-F3-01/INV-08: always merchant-approved
        hypothesis_type: "discount_rule",
        discount_rule_json: candidate.rule,
        template: {
          name: "discount_rule_system",
          description: "System-generated discount rule",
          variant_a: { name: "control", system_prompt: "", weight: 0.5, is_control: true },
          variant_b: { name: "treatment", system_prompt: "", weight: 0.5, is_control: false },
        },
      });

      // Persist via repository (embeds hypothesis_type + discount_rule_json in templateJson).
      await this.hypothesisRepository.save(hypothesisEntity);

      // ADI-F3-01: notify merchant — same pattern as handle-asaas-webhook.use-case.ts.
      await this.prisma.merchantNotification.create({
        data: {
          merchantId,
          type: "ai_rule_suggestion",
          title: "Sugestão de IA: Regra de Desconto",
          body: candidate.rationale,
          metadata: { hypothesisId: hypothesisEntity.id },
        },
      });

      this.logger.log(
        `Merchant ${merchantId}: generated discount rule hypothesis ${hypothesisEntity.id} (${candidate.rule.name}), sent notification`
      );
    } catch (err) {
      this.logger.warn(
        `Merchant ${merchantId}: discount rule generation failed: ${err instanceof Error ? err.message : String(err)}`
      );
      // Don't throw — allow observation cycle to continue
    }
  }

  /**
   * Load cohort stats (conversion × margin per intent) for the discount rule
   * generator. Returns empty when analytics are unavailable, in which case the
   * generator produces no candidate (safe no-op).
   *
   * TODO: wire to a real cohort-stats query once the intent × conversion read
   * model is available. Kept as a seam so the integration is testable now.
   */
  private async loadCohortStats(
    _merchantId: string,
  ): Promise<Parameters<DiscountRuleHypothesisService["generate"]>[0]> {
    return [];
  }
}
