import { randomUUID } from "node:crypto";

export type PromptVariantSnapshot = {
  id: string;
  experiment_id: string;
  name: string;
  system_prompt: string;
  weight: number;
  is_control: boolean;
  applied_rule_id?: string | null;
  created_at: string;
  updated_at: string;
};

export class PromptVariantEntity {
  private constructor(private readonly s: PromptVariantSnapshot) {}

  static create(input: {
    experiment_id: string;
    name: string;
    system_prompt: string;
    weight: number;
    is_control: boolean;
    applied_rule_id?: string;
  }): PromptVariantEntity {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error("VARIANT_NAME_REQUIRED");
    }
    if (!input.system_prompt || input.system_prompt.trim().length === 0) {
      throw new Error("VARIANT_SYSTEM_PROMPT_REQUIRED");
    }
    if (input.weight < 0 || input.weight > 100) {
      throw new Error("VARIANT_WEIGHT_OUT_OF_RANGE");
    }
    const now = new Date().toISOString();
    return new PromptVariantEntity({
      id: randomUUID(),
      experiment_id: input.experiment_id,
      name: input.name.trim(),
      system_prompt: input.system_prompt.trim(),
      weight: input.weight,
      is_control: input.is_control,
      applied_rule_id: input.applied_rule_id ?? null,
      created_at: now,
      updated_at: now,
    });
  }

  static rehydrate(s: PromptVariantSnapshot): PromptVariantEntity {
    return new PromptVariantEntity(s);
  }

  update(input: { name?: string; system_prompt?: string; weight?: number }): PromptVariantEntity {
    const name = input.name !== undefined ? input.name.trim() : this.s.name;
    const systemPrompt = input.system_prompt !== undefined ? input.system_prompt.trim() : this.s.system_prompt;
    const weight = input.weight !== undefined ? input.weight : this.s.weight;

    if (!name || name.length === 0) throw new Error("VARIANT_NAME_REQUIRED");
    if (!systemPrompt || systemPrompt.length === 0) throw new Error("VARIANT_SYSTEM_PROMPT_REQUIRED");
    if (weight < 0 || weight > 100) throw new Error("VARIANT_WEIGHT_OUT_OF_RANGE");

    return new PromptVariantEntity({
      ...this.s,
      name,
      system_prompt: systemPrompt,
      weight,
      updated_at: new Date().toISOString(),
    });
  }

  snapshot(): PromptVariantSnapshot { return { ...this.s }; }
  get id(): string { return this.s.id; }
  get experiment_id(): string { return this.s.experiment_id; }
  get name(): string { return this.s.name; }
  get system_prompt(): string { return this.s.system_prompt; }
  get weight(): number { return this.s.weight; }
  get is_control(): boolean { return this.s.is_control; }
  get applied_rule_id(): string | null | undefined { return this.s.applied_rule_id; }
}
