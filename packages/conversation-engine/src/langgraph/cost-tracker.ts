/**
 * Cost tracker — accumulates per-session token usage and enforces the AI cost
 * budget defined by the negotiation policy. Tracks cents spent (not just tokens)
 * so the chat flow can stop before it overruns the merchant's allocation.
 *
 * Pricing is approximate; defaults match Anthropic Claude Sonnet 4 via
 * OpenRouter as of 2026-07.
 */

export interface ModelPricing {
  /** Cost in cents per 1k prompt tokens. */
  promptPer1k: number;
  /** Cost in cents per 1k completion tokens. */
  completionPer1k: number;
}

export const PRICING: Record<string, ModelPricing> = {
  "anthropic/claude-sonnet-4": { promptPer1k: 0.30, completionPer1k: 1.50 },
  "anthropic/claude-3.5-sonnet": { promptPer1k: 0.30, completionPer1k: 1.50 },
  "openai/gpt-4o-mini": { promptPer1k: 0.015, completionPer1k: 0.06 },
  "openai/gpt-4o": { promptPer1k: 0.50, completionPer1k: 1.50 }
};

export interface CostTrackerOptions {
  /** Hard budget in cents. Throws / refuses when exceeded. */
  budgetCents: number;
  /** Model identifier for pricing lookup. Defaults to sonnet-4. */
  model?: string;
  /** Override pricing entirely (useful for tests / custom gateways). */
  pricing?: ModelPricing;
}

export interface CostTrackerSnapshot {
  budgetCents: number;
  promptTokens: number;
  completionTokens: number;
  spentCents: number;
  turns: number;
}

export interface CostRecord {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Approximate token count when the provider didn't supply usage.
 * 1 token ≈ 4 chars for English/Portuguese mix.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  if (text.length <= 4) return text.length > 0 ? 1 : 0;
  return Math.ceil(text.length / 4);
}

export class CostTracker {
  readonly budgetCents: number;
  readonly pricing: ModelPricing;

  private promptTokens = 0;
  private completionTokens = 0;
  private _turnCount = 0;

  constructor(opts: CostTrackerOptions) {
    if (typeof opts.budgetCents !== "number" || opts.budgetCents < 0) {
      throw new Error("cost_tracker: budgetCents must be a non-negative number");
    }
    this.budgetCents = opts.budgetCents;
    if (opts.pricing) {
      this.pricing = opts.pricing;
    } else {
      const model = opts.model ?? "anthropic/claude-sonnet-4";
      this.pricing = PRICING[model] ?? PRICING["anthropic/claude-sonnet-4"];
    }
  }

  get totalPromptTokens(): number {
    return this.promptTokens;
  }

  get totalCompletionTokens(): number {
    return this.completionTokens;
  }

  get turnCount(): number {
    return this._turnCount;
  }

  record(record: CostRecord): void {
    this.promptTokens += record.promptTokens;
    this.completionTokens += record.completionTokens;
    this._turnCount += 1;
  }

  totalCents(): number {
    const promptCents = (this.promptTokens / 1000) * this.pricing.promptPer1k;
    const completionCents = (this.completionTokens / 1000) * this.pricing.completionPer1k;
    return Number((promptCents + completionCents).toFixed(6));
  }

  remainingCents(): number {
    return Math.max(0, this.budgetCents - this.totalCents());
  }

  canAfford(estimatedNextCents: number): boolean {
    return this.totalCents() + estimatedNextCents <= this.budgetCents;
  }

  assertWithinBudget(): void {
    if (this.totalCents() > this.budgetCents) {
      throw new Error(
        `cost_tracker: budget_exceeded spent=${this.totalCents().toFixed(4)} budget=${this.budgetCents}`
      );
    }
  }

  snapshot(): CostTrackerSnapshot {
    return {
      budgetCents: this.budgetCents,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      spentCents: this.totalCents(),
      turns: this._turnCount
    };
  }

  static fromSnapshot(snap: CostTrackerSnapshot): CostTracker {
    const t = new CostTracker({ budgetCents: snap.budgetCents });
    t.promptTokens = snap.promptTokens;
    t.completionTokens = snap.completionTokens;
    t._turnCount = snap.turns;
    return t;
  }
}