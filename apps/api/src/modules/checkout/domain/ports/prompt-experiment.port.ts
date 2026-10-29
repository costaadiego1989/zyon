export const PROMPT_EXPERIMENT_PORT = Symbol("PROMPT_EXPERIMENT_PORT");

export interface PromptExperimentVariant {
  id: string;
  name: string;
  weight: number;
  systemPrompt: string;
  isControl: boolean;
  appliedRuleId: string | null;
}

export interface PromptExperimentPort {
  findRunningExperiment(
    merchantId: string
  ): Promise<{ id: string; variants: PromptExperimentVariant[] } | undefined>;
}
