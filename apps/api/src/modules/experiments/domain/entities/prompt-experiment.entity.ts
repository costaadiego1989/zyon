import { randomUUID } from "node:crypto";
import { PromptVariantEntity, type PromptVariantSnapshot } from "./prompt-variant.entity.js";

export type ExperimentStatus = "draft" | "running" | "completed" | "archived";

const LEGAL_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  draft: ["running"],
  running: ["completed"],
  completed: ["archived"],
  archived: [],
};

export type PromptExperimentSnapshot = {
  id: string;
  merchant_id: string;
  name: string;
  description: string | null;
  status: ExperimentStatus;
  variants: PromptVariantSnapshot[];
  started_at: string | null;
  completed_at: string | null;
  winner_variant_id: string | null;
  created_at: string;
  updated_at: string;
};

export class PromptExperimentEntity {
  private constructor(private readonly s: PromptExperimentSnapshot) {}

  static create(input: {
    merchant_id: string;
    name: string;
    description?: string | null;
    variants: Array<{
      name: string;
      system_prompt: string;
      weight: number;
      is_control: boolean;
    }>;
  }): PromptExperimentEntity {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error("EXPERIMENT_NAME_REQUIRED");
    }
    if (!input.variants || input.variants.length < 2) {
      throw new Error("EXPERIMENT_REQUIRES_AT_LEAST_TWO_VARIANTS");
    }
    const controls = input.variants.filter((v) => v.is_control);
    if (controls.length !== 1) {
      throw new Error("EXPERIMENT_REQUIRES_EXACTLY_ONE_CONTROL");
    }
    const totalWeight = input.variants.reduce((sum, v) => sum + v.weight, 0);
    if (totalWeight !== 100) {
      throw new Error("VARIANT_WEIGHTS_MUST_SUM_TO_100");
    }
    // Validate each prompt is non-empty
    for (const v of input.variants) {
      if (!v.system_prompt || v.system_prompt.trim().length === 0) {
        throw new Error("VARIANT_SYSTEM_PROMPT_REQUIRED");
      }
    }

    const experimentId = randomUUID();
    const now = new Date().toISOString();
    const variants = input.variants.map((v) =>
      PromptVariantEntity.create({
        experiment_id: experimentId,
        name: v.name,
        system_prompt: v.system_prompt,
        weight: v.weight,
        is_control: v.is_control,
      }).snapshot()
    );

    return new PromptExperimentEntity({
      id: experimentId,
      merchant_id: input.merchant_id,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      status: "draft",
      variants,
      started_at: null,
      completed_at: null,
      winner_variant_id: null,
      created_at: now,
      updated_at: now,
    });
  }

  static rehydrate(s: PromptExperimentSnapshot): PromptExperimentEntity {
    return new PromptExperimentEntity(s);
  }

  start(): PromptExperimentEntity {
    this.assertTransition("running");
    return new PromptExperimentEntity({
      ...this.s,
      status: "running",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  complete(): PromptExperimentEntity {
    this.assertTransition("completed");
    return new PromptExperimentEntity({
      ...this.s,
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  archive(): PromptExperimentEntity {
    this.assertTransition("archived");
    return new PromptExperimentEntity({
      ...this.s,
      status: "archived",
      updated_at: new Date().toISOString(),
    });
  }

  setWinner(variantId: string): PromptExperimentEntity {
    if (this.s.status !== "completed") {
      throw new Error("CANNOT_SET_WINNER_UNLESS_COMPLETED");
    }
    const exists = this.s.variants.some((v) => v.id === variantId);
    if (!exists) {
      throw new Error("VARIANT_NOT_FOUND_IN_EXPERIMENT");
    }
    return new PromptExperimentEntity({
      ...this.s,
      winner_variant_id: variantId,
      updated_at: new Date().toISOString(),
    });
  }

  update(input: { name?: string; description?: string | null }): PromptExperimentEntity {
    if (this.s.status !== "draft") {
      throw new Error("CANNOT_UPDATE_NON_DRAFT_EXPERIMENT");
    }
    const name = input.name !== undefined ? input.name.trim() : this.s.name;
    if (!name || name.length === 0) throw new Error("EXPERIMENT_NAME_REQUIRED");

    return new PromptExperimentEntity({
      ...this.s,
      name,
      description: input.description !== undefined ? (input.description?.trim() ?? null) : this.s.description,
      updated_at: new Date().toISOString(),
    });
  }

  updateVariants(variants: Array<{
    id?: string;
    name: string;
    system_prompt: string;
    weight: number;
    is_control: boolean;
  }>): PromptExperimentEntity {
    if (this.s.status !== "draft") {
      throw new Error("CANNOT_UPDATE_NON_DRAFT_EXPERIMENT");
    }
    if (variants.length < 2) {
      throw new Error("EXPERIMENT_REQUIRES_AT_LEAST_TWO_VARIANTS");
    }
    const controls = variants.filter((v) => v.is_control);
    if (controls.length !== 1) {
      throw new Error("EXPERIMENT_REQUIRES_EXACTLY_ONE_CONTROL");
    }
    const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
    if (totalWeight !== 100) {
      throw new Error("VARIANT_WEIGHTS_MUST_SUM_TO_100");
    }

    const updatedVariants = variants.map((v) => {
      if (v.id) {
        const existing = this.s.variants.find((ev) => ev.id === v.id);
        if (existing) {
          return PromptVariantEntity.rehydrate(existing).update({
            name: v.name,
            system_prompt: v.system_prompt,
            weight: v.weight,
          }).snapshot();
        }
      }
      return PromptVariantEntity.create({
        experiment_id: this.s.id,
        name: v.name,
        system_prompt: v.system_prompt,
        weight: v.weight,
        is_control: v.is_control,
      }).snapshot();
    });

    return new PromptExperimentEntity({
      ...this.s,
      variants: updatedVariants,
      updated_at: new Date().toISOString(),
    });
  }

  private assertTransition(to: ExperimentStatus): void {
    const allowed = LEGAL_TRANSITIONS[this.s.status];
    if (!allowed.includes(to)) {
      throw new Error(`INVALID_TRANSITION: ${this.s.status} → ${to}`);
    }
  }

  snapshot(): PromptExperimentSnapshot { return { ...this.s, variants: this.s.variants.map((v) => ({ ...v })) }; }
  get id(): string { return this.s.id; }
  get merchant_id(): string { return this.s.merchant_id; }
  get name(): string { return this.s.name; }
  get status(): ExperimentStatus { return this.s.status; }
  get variants(): PromptVariantSnapshot[] { return this.s.variants.map((v) => ({ ...v })); }
  get winner_variant_id(): string | null { return this.s.winner_variant_id; }
  get started_at(): string | null { return this.s.started_at; }
  get completed_at(): string | null { return this.s.completed_at; }
}
