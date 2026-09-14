/**
 * Stable, weighted experiment assignment shared by storefront and checkout.
 * A zero-weight variant is intentionally excluded; old/missing weights retain
 * the schema default of one so historical experiment rows remain assignable.
 */
export interface WeightedVariant {
  weight?: number | null;
}

function stableHash(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function normalizedWeight(weight: number | null | undefined): number {
  if (weight === null || weight === undefined) return 1;
  if (!Number.isFinite(weight)) return 0;
  return Math.max(0, Math.trunc(weight));
}

export function selectWeightedVariant<T extends WeightedVariant>(key: string, variants: readonly T[]): T | undefined {
  const eligible = variants
    .map((variant) => ({ variant, weight: normalizedWeight(variant.weight) }))
    .filter((entry) => entry.weight > 0);
  const totalWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return undefined;

  let target = stableHash(key) % totalWeight;
  for (const entry of eligible) {
    if (target < entry.weight) return entry.variant;
    target -= entry.weight;
  }

  return eligible[eligible.length - 1]?.variant;
}
