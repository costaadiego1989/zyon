/**
 * MERC-C1: StellarConfig value object — injected at module load,
 * validated at startup (OnModuleInit). Replaces raw process.env reads.
 */
export const STELLAR_CONFIG = Symbol("STELLAR_CONFIG");

export interface StellarConfig {
  platformSecretKey: string;
  enabled: boolean;
}

/**
 * Create StellarConfig from env. Returns disabled config when env var missing
 * (graceful degradation instead of runtime crash).
 */
export function createStellarConfig(): StellarConfig {
  const platformSecretKey = process.env["STELLAR_PLATFORM_SECRET"] ?? "";
  return {
    platformSecretKey,
    enabled: platformSecretKey.length > 0,
  };
}
