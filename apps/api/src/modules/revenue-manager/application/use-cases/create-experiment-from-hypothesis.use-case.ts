import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { AdvancedRule, CheckoutSettings } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { HYPOTHESIS_REPOSITORY_PORT, type HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import { CreateExperimentUseCase } from "../../../experiments/application/use-cases/create-experiment.use-case.js";
import { StartExperimentUseCase } from "../../../experiments/application/use-cases/start-experiment.use-case.js";
import {
  CHECKOUT_SETTINGS_REPOSITORY,
  type CheckoutSettingsRepository,
} from "../../../checkout-settings/domain/ports/checkout-settings-repository.port.js";
import { CheckoutSettingsEntity } from "../../../checkout-settings/domain/entities/checkout-settings.entity.js";

export interface CreateExperimentFromHypothesisInput {
  merchant_id: string;
  hypothesis_id: string;
}

export interface CreateExperimentFromHypothesisOutput {
  experiment_id: string;
  hypothesis_id: string;
  status: "created" | "failed";
  applied_rule_id?: string;
  error?: string;
}

/**
 * CreateExperimentFromHypothesisUseCase — Wraps approved hypothesis into experiment.
 *
 * Prompt hypotheses (hypothesis_type === "prompt"): control vs treatment differ
 * by system_prompt only (legacy behaviour).
 *
 * F4-T03 — Discount-rule hypotheses (hypothesis_type === "discount_rule"):
 * 1. Persist the candidate AdvancedRule as a DRAFT (enabled=false) in the
 *    merchant's checkout-settings advancedRules. The rule only becomes live for
 *    a session that is assigned the treatment variant (via applied_rule_id +
 *    AdvancedRuleEvaluator + rules-engine — INV-01/INV-04 still enforced there).
 * 2. Create a control variant with applied_rule_id = null and a treatment
 *    variant with applied_rule_id = <ruleId>. The rule is the tested variable.
 *
 * Holdout (5%) never receives a variant (INV-07) — enforced upstream by the
 * HoldoutGroupService before assignment.
 */
@Injectable()
export class CreateExperimentFromHypothesisUseCase {
  private readonly logger = new Logger(CreateExperimentFromHypothesisUseCase.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(HYPOTHESIS_REPOSITORY_PORT) private readonly hypothesisRepo: HypothesisRepositoryPort,
    private readonly createExperimentUseCase: CreateExperimentUseCase,
    private readonly startExperimentUseCase: StartExperimentUseCase,
    @Optional()
    @Inject(CHECKOUT_SETTINGS_REPOSITORY)
    private readonly checkoutSettingsRepo?: CheckoutSettingsRepository,
  ) {}

  async execute(input: CreateExperimentFromHypothesisInput): Promise<CreateExperimentFromHypothesisOutput> {
    try {
      // Fetch hypothesis
      const hypothesis = await this.hypothesisRepo.findById(input.hypothesis_id, input.merchant_id);
      if (!hypothesis) {
        throw new Error(`HYPOTHESIS_NOT_FOUND: ${input.hypothesis_id}`);
      }

      if (hypothesis.status !== "approved") {
        throw new Error(`HYPOTHESIS_NOT_APPROVED: status=${hypothesis.status}`);
      }

      // Check if already has an experiment (idempotent)
      if (hypothesis.snapshot().created_experiment_id) {
        this.logger.log(`Hypothesis ${input.hypothesis_id} already has experiment ${hypothesis.snapshot().created_experiment_id}`);
        return {
          experiment_id: hypothesis.snapshot().created_experiment_id!,
          hypothesis_id: input.hypothesis_id,
          status: "created",
        };
      }

      const isDiscountRule = hypothesis.hypothesis_type === "discount_rule";

      let appliedRuleId: string | undefined;

      if (isDiscountRule) {
        const rule = hypothesis.discount_rule_json;
        if (!rule) {
          throw new Error("DISCOUNT_RULE_MISSING: hypothesis_type=discount_rule requires discount_rule_json");
        }
        // Persist the candidate rule as a disabled draft on the merchant.
        appliedRuleId = await this.persistDraftRule(input.merchant_id, rule);
      }

      // Resolve the variant template. Prompt hypotheses carry an explicit
      // template.variant_a/variant_b. Discount-rule hypotheses vary by the
      // PRESENCE of the rule (control = no rule, treatment = rule), not by
      // prompt text — so synthesize a default A/B template when absent.
      const template = (hypothesis.template && hypothesis.template.variant_a && hypothesis.template.variant_b)
        ? hypothesis.template
        : {
            name: hypothesis.snapshot().hypothesis_text?.slice(0, 60) || "Experimento de regra",
            description: hypothesis.snapshot().reasoning || "",
            variant_a: { name: "Controle (sem regra)", system_prompt: "default", weight: 50, is_control: true },
            variant_b: { name: "Tratamento (com regra)", system_prompt: "default", weight: 50, is_control: false },
          };

      // Build variants. Control never carries a rule (applied_rule_id=null);
      // treatment carries the rule id only for discount_rule hypotheses.
      const variantA = {
        name: template.variant_a.name,
        system_prompt: template.variant_a.system_prompt,
        weight: template.variant_a.weight,
        is_control: template.variant_a.is_control,
        // control (is_control) → never a rule; treatment → rule if discount_rule
        applied_rule_id:
          !template.variant_a.is_control && isDiscountRule ? appliedRuleId : undefined,
      };
      const variantB = {
        name: template.variant_b.name,
        system_prompt: template.variant_b.system_prompt,
        weight: template.variant_b.weight,
        is_control: template.variant_b.is_control,
        applied_rule_id:
          !template.variant_b.is_control && isDiscountRule ? appliedRuleId : undefined,
      };

      // Create experiment
      const result = await this.createExperimentUseCase.execute({
        merchant_id: input.merchant_id,
        name: template.name,
        description: template.description,
        variants: [variantA, variantB],
      });

      const experimentId = result.experiment_id;

      // Start experiment
      await this.startExperimentUseCase.execute({
        experiment_id: experimentId,
        merchant_id: input.merchant_id,
      });

      // Update hypothesis with created experiment id
      const updated = hypothesis.markExperimentCreated(experimentId);
      await this.hypothesisRepo.save(updated);

      this.logger.log(
        `Created and started experiment for hypothesis ${input.hypothesis_id}: exp=${experimentId}` +
          (isDiscountRule ? ` (discount_rule, applied_rule_id=${appliedRuleId})` : ""),
      );

      return {
        experiment_id: experimentId,
        hypothesis_id: input.hypothesis_id,
        status: "created",
        ...(appliedRuleId ? { applied_rule_id: appliedRuleId } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to create experiment for hypothesis ${input.hypothesis_id}: ${message}`,
      );

      // Mark hypothesis as failed
      try {
        const hypothesis = await this.hypothesisRepo.findById(input.hypothesis_id, input.merchant_id);
        if (hypothesis && hypothesis.status === "approved") {
          const failed = hypothesis.markExperimentFailed(message);
          await this.hypothesisRepo.save(failed);
        }
      } catch (updateErr) {
        this.logger.warn(`Failed to mark hypothesis as failed: ${updateErr instanceof Error ? updateErr.message : String(updateErr)}`);
      }

      return {
        experiment_id: "",
        hypothesis_id: input.hypothesis_id,
        status: "failed",
        error: message,
      };
    }
  }

  /**
   * Persists the candidate AdvancedRule as a DRAFT (enabled=false) on the
   * merchant's checkout-settings. Draft ensures the rule is inert until a
   * session is assigned the treatment variant. Idempotent: replaces any
   * existing rule with the same id. Returns the rule id used as applied_rule_id.
   */
  private async persistDraftRule(merchantId: string, rule: AdvancedRule): Promise<string> {
    if (!this.checkoutSettingsRepo) {
      // Repo not wired (e.g. isolated unit context) — still thread the id
      // through so the treatment variant carries the rule reference.
      this.logger.warn(
        `CheckoutSettingsRepository not available; skipping draft persistence for rule ${rule.id}`,
      );
      return rule.id;
    }

    const draftRule: AdvancedRule = {
      ...rule,
      // A draft is never live on its own. Activation happens per-session via the
      // treatment variant's applied_rule_id, not via this flag.
      enabled: false,
      conditions: rule.conditions.map((c) => ({ ...c })),
      action: { ...rule.action, params: { ...rule.action.params } },
    };

    const existing = await this.checkoutSettingsRepo.get(merchantId);
    const base: CheckoutSettings =
      existing ?? CheckoutSettingsEntity.createDefault({ merchantId }).snapshot();

    const nextRules = [
      ...base.advancedRules.filter((r) => r.id !== draftRule.id),
      draftRule,
    ];

    const nextSettings = CheckoutSettingsEntity.rehydrate(base)
      .update({ advancedRules: nextRules })
      .snapshot();

    await this.checkoutSettingsRepo.save(nextSettings, existing?.updatedAt);

    this.logger.log(
      `Persisted draft AdvancedRule ${draftRule.id} (enabled=false) for merchant ${merchantId}`,
    );

    return draftRule.id;
  }
}
