export const PROMPT_EXPERIMENT_PORT = Symbol("PROMPT_EXPERIMENT_PORT");

/**
 * Fetches running prompt experiments for A/B testing LLM behavior.
 * Domain logic (hash-based variant selection) remains in use-case;
 * this port only fetches experiment metadata.
 */
export interface PromptExperimentPort {
  /**
   * Find running prompt experiment for a merchant.
   * @param merchantId - Merchant to find experiment for
   * @returns Running experiment with variants, or undefined if none active
   */
  findRunningExperiment(
    merchantId: string
  ): Promise<{ id: string; variants: Array<{ id: string; name: string; weight: number; systemPrompt: string }> } | undefined>;
}
