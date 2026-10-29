import { USDC_DECIMALS } from "./evm-crypto.constants.js";

/**
 * Deriva um nonce determinístico de "dust" (0–999 unidades atômicas) a partir
 * do intentId. Some-o ao amountAtomic para amarrar a cobrança a ESTE intent:
 * dois intents do mesmo valor exigem transfers on-chain de valores distintos,
 * impedindo que um `txHash` de outro intent satisfaça este (ADR 0001 #2).
 */
export function intentDustNonce(intentId: string): number {
  let hash = 0;
  const id = intentId.trim();
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 1000;
}

export function quoteUsdcFromBrlCents(
  amountCents: number,
  brlPerUsdc: number,
  intentId?: string
): {
  amountAtomic: string;
  amountDisplay: string;
} {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("crypto_quote_amount_invalid");
  }
  if (!Number.isFinite(brlPerUsdc) || brlPerUsdc <= 0) {
    throw new Error("crypto_brl_per_usdc_required");
  }
  const brlMajor = amountCents / 100;
  const usdcMajor = brlMajor / brlPerUsdc;
  const factor = 10 ** USDC_DECIMALS;
  const base = Math.round(usdcMajor * factor);
  if (base === 0) {
    throw new Error("crypto_quote_too_small");
  }
  // Per-intent discriminant: unique dust offset so a transfer for another intent
  // of the same nominal value cannot match this quote's exact atomic amount.
  const dust = typeof intentId === "string" && intentId.trim() ? intentDustNonce(intentId) : 0;
  const amountAtomic = (base + dust).toString();
  const display = (Number(amountAtomic) / factor).toFixed(USDC_DECIMALS);
  return { amountAtomic, amountDisplay: `${display} USDC` };
}
