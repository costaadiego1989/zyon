import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { HYPOTHESIS_REPOSITORY_PORT, type HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { CHECKOUT_SETTINGS_REPOSITORY, type CheckoutSettingsRepository } from "../../../checkout-settings/domain/ports/checkout-settings-repository.port.js";
import { CheckoutSettingsEntity } from "../../../checkout-settings/domain/entities/checkout-settings.entity.js";
import { CreateExperimentFromHypothesisUseCase } from "./create-experiment-from-hypothesis.use-case.js";
import type { DomainEventEnvelope } from "@zyon/shared-types";

export interface ApproveHypothesisInput {
  hypothesis_id: string;
  merchant_id: string;
  approved_by: string;
  approval_reason?: string;
  mode: "apply_direct" | "test_ab";
}

export interface ApproveHypothesisOutput {
  hypothesis_id: string;
  status: string;
  approved_at: string;
  mode: "apply_direct" | "test_ab";
  experiment_id?: string;
  rule_id?: string;
}

@Injectable()
export class ApproveHypothesisUseCase {
  private readonly logger = new Logger(ApproveHypothesisUseCase.name);

  constructor(
    @Inject(HYPOTHESIS_REPOSITORY_PORT) private readonly hypothesisRepo: HypothesisRepositoryPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(CHECKOUT_SETTINGS_REPOSITORY) private readonly checkoutSettingsRepo: CheckoutSettingsRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly createExperimentFromHypothesis: CreateExperimentFromHypothesisUseCase,
  ) {}

  async execute(input: ApproveHypothesisInput): Promise<ApproveHypothesisOutput> {
    const hypothesis = await this.hypothesisRepo.findById(input.hypothesis_id, input.merchant_id);
    if (!hypothesis) {
      throw new Error("HYPOTHESIS_NOT_FOUND");
    }

    const updated = hypothesis.approve(input.approved_by, input.approval_reason);
    await this.hypothesisRepo.save(updated);

    const event: DomainEventEnvelope = {
      event_id: `evt_${crypto.randomUUID()}`,
      event_type: "revenue_manager.hypothesis.approved",
      schema_version: 1,
      merchant_id: input.merchant_id,
      occurred_at: new Date().toISOString(),
      correlation_id: `corr_${crypto.randomUUID()}`,
      causation_id: "revenue_manager.approve_hypothesis",
      producer: "revenue-manager",
      payload: {
        hypothesis_id: input.hypothesis_id,
        approved_by: input.approved_by,
        mode: input.mode,
        expected_lift_percent: updated.snapshot().expected_lift_percent,
        risk_level: updated.risk_level,
      },
    };
    await this.outbox.appendOutbox(event);

    this.logger.log(`Hypothesis ${input.hypothesis_id} approved by ${input.approved_by} with mode=${input.mode}`);

    const result: ApproveHypothesisOutput = {
      hypothesis_id: input.hypothesis_id,
      status: updated.status,
      approved_at: updated.snapshot().merchant_approved_at!,
      mode: input.mode,
    };

    // Handle apply_direct: save the advanced rule to checkout-settings
    if (input.mode === "apply_direct") {
      try {
        const discountRule = updated.snapshot().discount_rule_json;
        if (discountRule && updated.hypothesis_type === "discount_rule") {
          // Fetch current checkout settings
          const settings = await this.checkoutSettingsRepo.get(input.merchant_id);
          if (settings) {
            const entity = CheckoutSettingsEntity.rehydrate(settings);
            // Add or update the rule. Approving in apply_direct mode is an
            // explicit merchant activation — the generator emits rules with
            // enabled:false (draft), so we MUST enable it here or it never
            // fires during checkout (AdvancedRuleEvaluator skips disabled rules).
            const activatedRule = { ...discountRule, enabled: true };
            const currentRules = settings.advancedRules ?? [];
            const updatedRules = [
              ...currentRules.filter(r => r.id !== activatedRule.id),
              activatedRule,
            ];
            const patched = entity.update({ advancedRules: updatedRules });
            await this.checkoutSettingsRepo.save(patched.snapshot());
            result.rule_id = discountRule.id;
            this.logger.log(`Advanced rule ${discountRule.id} activated for merchant ${input.merchant_id}`);
          }
        }
      } catch (err) {
        this.logger.error(`Failed to apply direct rule: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    }

    // Handle test_ab: create and start an experiment
    if (input.mode === "test_ab") {
      try {
        const expResult = await this.createExperimentFromHypothesis.execute({
          merchant_id: input.merchant_id,
          hypothesis_id: input.hypothesis_id,
        });
        if (expResult.status === "created") {
          result.experiment_id = expResult.experiment_id;
          this.logger.log(`Experiment ${expResult.experiment_id} created for hypothesis ${input.hypothesis_id}`);
        } else {
          this.logger.warn(`Experiment creation failed for hypothesis ${input.hypothesis_id}: ${expResult.error}`);
        }
      } catch (err) {
        this.logger.error(`Failed to create experiment: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    }

    return result;
  }
}
