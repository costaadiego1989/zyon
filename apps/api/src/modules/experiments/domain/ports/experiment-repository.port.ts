import type { PromptExperimentEntity } from "../entities/prompt-experiment.entity.js";

export const EXPERIMENT_REPOSITORY_PORT = Symbol("EXPERIMENT_REPOSITORY_PORT");

export interface ExperimentRepositoryPort {
  save(experiment: PromptExperimentEntity): Promise<void>;
  findById(id: string, merchantId: string): Promise<PromptExperimentEntity | null>;
  findByMerchant(merchantId: string): Promise<PromptExperimentEntity[]>;
  findRunning(merchantId: string): Promise<PromptExperimentEntity | null>;
  delete(id: string, merchantId: string): Promise<void>;
}
