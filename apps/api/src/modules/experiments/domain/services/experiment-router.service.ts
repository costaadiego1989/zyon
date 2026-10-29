/**
 * ExperimentRouter — Weighted Random Selection
 *
 * Selects a variant for an experiment using weighted random distribution.
 * Implements caching (5min) for the running experiment to avoid repeated queries.
 */

export interface PromptVariant {
  id: string;
  name: string;
  weight: number;
  systemPrompt: string;
  createdAt: Date;
}

export interface Experiment {
  id: string;
  merchantId: string;
  name: string;
  status: "draft" | "running" | "completed" | "archived";
  variants: PromptVariant[];
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
}

export type ExperimentRepositoryPort = {
  /**
   * Find active (running) experiment for merchant.
   * Returns null if no experiment is running.
   */
  findRunning(merchantId: string): Promise<Experiment | null>;
};

export type ExperimentRouterPort = {
  /**
   * Select variant for buyer session.
   * Returns a variant (with weight-based probability) or null if no experiment running.
   */
  selectVariant(merchantId: string): Promise<PromptVariant | null>;
};

interface CacheEntry {
  experiment: Experiment | null;
  cachedAt: number;
}

export class ExperimentRouterService implements ExperimentRouterPort {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private repo: ExperimentRepositoryPort) {}

  async selectVariant(merchantId: string): Promise<PromptVariant | null> {
    const experiment = await this.getExperimentCached(merchantId);

    if (!experiment) {
      return null;
    }

    // Weighted random selection
    const variant = this.selectWeightedVariant(experiment.variants);
    return variant;
  }

  private async getExperimentCached(merchantId: string): Promise<Experiment | null> {
    const now = Date.now();
    const cached = this.cache.get(merchantId);

    // Return from cache if fresh
    if (cached && now - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.experiment;
    }

    // Fetch and cache
    const experiment = await this.repo.findRunning(merchantId);
    this.cache.set(merchantId, {
      experiment,
      cachedAt: now,
    });

    return experiment;
  }

  private selectWeightedVariant(variants: PromptVariant[]): PromptVariant {
    if (variants.length === 0) {
      throw new Error("Cannot select from empty variants list");
    }

    // Calculate total weight
    const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);

    if (totalWeight <= 0) {
      throw new Error("Total weight must be positive");
    }

    // Generate weighted random
    let random = Math.random() * totalWeight;
    for (const variant of variants) {
      random -= variant.weight;
      if (random <= 0) {
        return variant;
      }
    }

    // Fallback (should never reach in normal flow)
    return variants[0];
  }

  /**
   * Invalidate cache for a merchant (e.g., after experiment state change)
   */
  invalidateCache(merchantId: string): void {
    this.cache.delete(merchantId);
  }

  /**
   * Clear all cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }
}
