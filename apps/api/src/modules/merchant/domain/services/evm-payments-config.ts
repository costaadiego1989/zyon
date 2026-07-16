/**
 * EvmPaymentsConfig value object — injected at module load,
 * validated at startup (OnModuleInit). Replaces raw process.env reads
 * previously consumed from StellarConfig.
 */
export const EVM_PAYMENTS_CONFIG = Symbol("EVM_PAYMENTS_CONFIG");

export interface EvmPaymentsConfig {
  /** Platform hot wallet private key (hex). Required to sponsor gas. */
  platformPrivateKey: `0x${string}`;
  enabled: boolean;
}

/**
 * Create EvmPaymentsConfig from env. Returns disabled config when env var
 * missing (graceful degradation instead of runtime crash).
 */
export function createEvmPaymentsConfig(): EvmPaymentsConfig {
  const raw = process.env["EVM_PLATFORM_PRIVATE_KEY"] ?? "";
  const platformPrivateKey = (
    raw.startsWith("0x") && raw.length === 66
      ? (raw as `0x${string}`)
      : "0x" + "00".repeat(32)
  ) as `0x${string}`;
  return {
    platformPrivateKey,
    enabled: raw.length === 66 && raw.startsWith("0x"),
  };
}
